import { env } from "../config/env.js";
import { AppError, configurationError } from "../lib/errors.js";
import {
  claimNextExpiredUploadGrantForCleanup,
  claimUnconsumedUploadGrantsForCleanup,
  claimUploadGrantForCleanup,
  deleteClaimedUploadGrant,
  finalizeExpiredUploadGrantCleanup,
  releaseExpiredUploadGrantCleanup,
  releaseUploadGrantReservation,
} from "./store.js";

const destroyTimeoutMs = 8_000;

let configuredCloudinaryPromise;

const getConfiguredCloudinary = () => {
  if (!configuredCloudinaryPromise) {
    configuredCloudinaryPromise = import("cloudinary")
      .then(({ v2 }) => {
        v2.config({
          cloud_name: env.cloudinaryCloudName,
          api_key: env.cloudinaryApiKey,
          api_secret: env.cloudinaryApiSecret,
          secure: true,
        });
        return v2;
      })
      .catch((error) => {
        configuredCloudinaryPromise = undefined;
        throw error;
      });
  }
  return configuredCloudinaryPromise;
};

const defaultDestroyCloudinaryAsset = async (publicId) => {
  const cloudinary = await getConfiguredCloudinary();
  return cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
};

let destroyCloudinaryAsset = defaultDestroyCloudinaryAsset;

export const setUploadAssetDestroyerForTests = (destroyer) => {
  if (!env.isTest) throw new Error("Upload cleanup test doubles are test-only");
  destroyCloudinaryAsset = destroyer;
};

export const resetUploadAssetDestroyerForTests = () => {
  if (!env.isTest) throw new Error("Upload cleanup reset is test-only");
  destroyCloudinaryAsset = defaultDestroyCloudinaryAsset;
};

const requireCloudinaryCleanupConfig = () => {
  const missing = [
    ["CLOUDINARY_CLOUD_NAME", env.cloudinaryCloudName],
    ["CLOUDINARY_API_KEY", env.cloudinaryApiKey],
    ["CLOUDINARY_API_SECRET", env.cloudinaryApiSecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw configurationError(missing);
};

const withTimeout = async (operation, timeoutMs = destroyTimeoutMs) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Cloudinary cleanup timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const destroyClaimedAsset = async ({ userId, publicId, reservationToken }) => {
  const result = await withTimeout(() => destroyCloudinaryAsset(publicId));
  if (!["ok", "not found"].includes(result?.result)) {
    throw new AppError(
      502,
      "UPLOAD_CLEANUP_FAILED",
      "The uploaded image could not be removed. Please try again",
    );
  }
  return deleteClaimedUploadGrant({ userId, publicId, reservationToken });
};

export const cleanupUploadAssetForUser = async ({
  userId,
  publicId,
  allowConsumedProductCleanup = false,
}) => {
  requireCloudinaryCleanupConfig();
  const claim = await claimUploadGrantForCleanup({
    userId,
    publicId,
    allowConsumedProductCleanup,
  });
  try {
    return await destroyClaimedAsset({
      userId,
      publicId,
      reservationToken: claim.reservationToken,
    });
  } catch (error) {
    await releaseUploadGrantReservation(claim.reservationToken).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "UPLOAD_CLEANUP_FAILED",
      "The uploaded image could not be removed. Please try again",
    );
  }
};

export const cleanupUnconsumedUploadsForUser = async (userId) => {
  const claim = await claimUnconsumedUploadGrantsForCleanup({ userId });
  if (!claim.grants.length) return { attempted: 0, removed: 0, failed: 0 };

  try {
    requireCloudinaryCleanupConfig();
    const results = await Promise.allSettled(
      claim.grants.map(({ publicId }) =>
        destroyClaimedAsset({
          userId,
          publicId,
          reservationToken: claim.reservationToken,
        }),
      ),
    );
    const removed = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - removed;
    if (failed) {
      await releaseUploadGrantReservation(claim.reservationToken).catch(() => {});
    }
    return { attempted: results.length, removed, failed };
  } catch (error) {
    await releaseUploadGrantReservation(claim.reservationToken).catch(() => {});
    throw error;
  }
};

const expiredCleanupRetryDelayMs = (attempt) =>
  Math.min(
    6 * 60 * 60 * 1_000,
    5 * 60 * 1_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6),
  );

let expiredUploadSweepPromise;
let lastExpiredUploadSweepStartedAt = 0;

export const runExpiredUploadGrantSweep = ({
  limit = 4,
  now,
  cleanupTimeoutMs = 5_000,
  retryDelayMs,
} = {}) => {
  if (expiredUploadSweepPromise) return expiredUploadSweepPromise;
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 1, 20));
  const currentTime = () => new Date(typeof now === "function" ? now() : now ?? Date.now());

  expiredUploadSweepPromise = (async () => {
    requireCloudinaryCleanupConfig();
    const result = { claimed: 0, deleted: 0, failed: 0 };

    for (let index = 0; index < boundedLimit; index += 1) {
      const claimedAt = currentTime();
      const grant = await claimNextExpiredUploadGrantForCleanup({ now: claimedAt });
      if (!grant) break;
      result.claimed += 1;

      try {
        const providerResult = await withTimeout(
          () => destroyCloudinaryAsset(grant.publicId),
          cleanupTimeoutMs,
        );
        if (!["ok", "not found"].includes(providerResult?.result)) {
          throw new Error("Cloudinary did not confirm expired upload cleanup");
        }
        const finalized = await finalizeExpiredUploadGrantCleanup({
          publicId: grant.publicId,
          reservationToken: grant.reservationToken,
        });
        if (!finalized) throw new Error("Expired upload cleanup claim changed before finalization");
        result.deleted += 1;
      } catch {
        const delay =
          retryDelayMs ??
          expiredCleanupRetryDelayMs(Math.max(Number(grant.cleanupAttempts) || 1, 1));
        await releaseExpiredUploadGrantCleanup({
          publicId: grant.publicId,
          reservationToken: grant.reservationToken,
          retryAt: new Date(claimedAt.getTime() + delay),
        }).catch(() => {});
        result.failed += 1;
      }
    }
    return result;
  })().finally(() => {
    expiredUploadSweepPromise = undefined;
  });

  return expiredUploadSweepPromise;
};

export const scheduleExpiredUploadGrantSweep = () => {
  if (env.isTest || expiredUploadSweepPromise) return expiredUploadSweepPromise;
  const now = Date.now();
  if (now - lastExpiredUploadSweepStartedAt < 60_000) return undefined;
  lastExpiredUploadSweepStartedAt = now;
  const sweep = runExpiredUploadGrantSweep();
  void sweep.catch((error) => {
    console.warn(`[uploads] Expired upload cleanup deferred (${error.name}).`);
  });
  return sweep;
};

export const waitForUploadCleanupBudget = async (sweep, budgetMs = 250) => {
  if (!sweep) return;
  let timer;
  try {
    await Promise.race([
      sweep.catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
