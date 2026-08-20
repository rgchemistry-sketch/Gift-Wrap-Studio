import { randomUUID } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError, configurationError } from "../lib/errors.js";
import { authenticate, hasAdminAccess, requireAdmin } from "../middleware/auth.js";
import { DurableRateLimitStore } from "../middleware/durable-rate-limit.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  claimUploadGrantForVerification,
  finalizeUploadGrantVerification,
  rejectUploadGrantVerification,
  releaseUploadGrantReservation,
  reserveUploadGrant,
} from "../services/store.js";
import { cleanupUploadAssetForUser } from "../services/upload-cleanup.js";
import {
  uploadAssetDeleteSchema,
  uploadCompleteSchema,
  uploadSignatureSchema,
} from "../validation/schemas.js";

export {
  resetUploadAssetDestroyerForTests,
  setUploadAssetDestroyerForTests,
} from "../services/upload-cleanup.js";

export const uploadsRouter = Router();

let cloudinaryPromise;
let uploadPresetVerificationPromise;
const defaultUploadPresetLoader = (cloudinary) =>
  cloudinary.api.upload_preset(env.cloudinaryUploadPreset);
let uploadPresetLoader = defaultUploadPresetLoader;
const defaultUploadResourceLoader = (cloudinary, publicId) =>
  cloudinary.api.resource(publicId, { resource_type: "image", type: "upload" });
const defaultRejectedUploadDestroyer = (cloudinary, publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
let uploadResourceLoader = defaultUploadResourceLoader;
let rejectedUploadDestroyer = defaultRejectedUploadDestroyer;

export const setUploadPresetLoaderForTests = (loader) => {
  if (!env.isTest) throw new Error("Upload preset test doubles are test-only");
  uploadPresetLoader = loader;
  uploadPresetVerificationPromise = undefined;
};

export const resetUploadPresetVerificationForTests = () => {
  if (!env.isTest) throw new Error("Upload preset verification resets are test-only");
  uploadPresetLoader = defaultUploadPresetLoader;
  uploadPresetVerificationPromise = undefined;
};

export const setUploadResourceLoaderForTests = (loader) => {
  if (!env.isTest) throw new Error("Upload resource test doubles are test-only");
  uploadResourceLoader = loader;
};

export const resetUploadResourceLoaderForTests = () => {
  if (!env.isTest) throw new Error("Upload resource resets are test-only");
  uploadResourceLoader = defaultUploadResourceLoader;
};

export const setRejectedUploadDestroyerForTests = (destroyer) => {
  if (!env.isTest) throw new Error("Rejected upload test doubles are test-only");
  rejectedUploadDestroyer = destroyer;
};

export const resetRejectedUploadDestroyerForTests = () => {
  if (!env.isTest) throw new Error("Rejected upload resets are test-only");
  rejectedUploadDestroyer = defaultRejectedUploadDestroyer;
};

const getCloudinary = () => {
  if (!cloudinaryPromise) {
    cloudinaryPromise = import("cloudinary")
      .then(({ v2 }) => v2)
      .catch((error) => {
        cloudinaryPromise = undefined;
        throw error;
      });
  }
  return cloudinaryPromise;
};

const requireCloudinaryConfig = ({ uploadPreset = true } = {}) => {
  const missing = [
    ["CLOUDINARY_CLOUD_NAME", env.cloudinaryCloudName],
    ["CLOUDINARY_API_KEY", env.cloudinaryApiKey],
    ["CLOUDINARY_API_SECRET", env.cloudinaryApiSecret],
    ...(uploadPreset ? [["CLOUDINARY_UPLOAD_PRESET", env.cloudinaryUploadPreset]] : []),
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw configurationError(missing);
};

const configureCloudinary = (cloudinary) => {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
};

const hasIncomingTransformation = (value) => {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
};

const verifyUploadPreset = async (cloudinary) => {
  if (!env.verifyCloudinaryUploadPreset) return;
  if (!uploadPresetVerificationPromise) {
    uploadPresetVerificationPromise = (async () => {
      configureCloudinary(cloudinary);
      let preset;
      try {
        preset = await uploadPresetLoader(cloudinary);
      } catch (error) {
        throw new AppError(
          503,
          "UPLOAD_PRESET_UNVERIFIED",
          "The image upload policy could not be verified",
          { providerStatus: error?.http_code || error?.status || 0 },
        );
      }
      if (preset?.unsigned !== false) {
        throw configurationError(["CLOUDINARY_UPLOAD_PRESET signed mode"]);
      }
      const incomingTransformation =
        preset?.settings?.transformation ?? preset?.transformation;
      if (hasIncomingTransformation(incomingTransformation)) {
        throw configurationError([
          "CLOUDINARY_UPLOAD_PRESET without an incoming transformation",
        ]);
      }
    })().catch((error) => {
      // Cache only a successful verification. A transient Admin API outage or a
      // corrected preset must be recoverable without recycling the server instance.
      uploadPresetVerificationPromise = undefined;
      throw error;
    });
  }
  return uploadPresetVerificationPromise;
};

const providerTimeoutMs = 8_000;
const maxUploadDimension = 12_000;
const maxUploadPixels = 50_000_000;

const withProviderTimeout = async (operation) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Cloudinary request timed out")), providerTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const secureUrlMatchesUpload = (value, publicId) => {
  let url;
  let decodedPath;
  try {
    url = new URL(value);
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "res.cloudinary.com") {
    return false;
  }
  const uploadPrefix = `/${env.cloudinaryCloudName}/image/upload/`;
  if (!decodedPath.startsWith(uploadPrefix)) return false;
  const deliveryPath = decodedPath.slice(uploadPrefix.length);
  const versionMarker = /(?:^|\/)v\d+\//g;
  let versionMatch;
  let latestVersionMatch;
  while ((versionMatch = versionMarker.exec(deliveryPath))) latestVersionMatch = versionMatch;
  const deliveredAsset = latestVersionMatch
    ? deliveryPath.slice(latestVersionMatch.index + latestVersionMatch[0].length)
    : deliveryPath;
  return new RegExp(`^${escapeRegExp(publicId)}(?:\\.[A-Za-z0-9]+)?$`).test(deliveredAsset);
};

const inspectUploadedAsset = (asset, expectedPublicId) => {
  const bytes = Number(asset?.bytes);
  const width = Number(asset?.width);
  const height = Number(asset?.height);
  const format = String(asset?.format || "").trim().toLowerCase();
  const secureUrl = String(asset?.secure_url || "").trim();
  const version = Number(asset?.version);
  const identityIsValid =
    asset?.public_id === expectedPublicId &&
    asset?.resource_type === "image" &&
    asset?.type === "upload";
  const bytesAreValid = Number.isSafeInteger(bytes) && bytes > 0;
  const dimensionsAreValid =
    Number.isSafeInteger(width) &&
    width > 0 &&
    width <= maxUploadDimension &&
    Number.isSafeInteger(height) &&
    height > 0 &&
    height <= maxUploadDimension &&
    width * height <= maxUploadPixels;
  const formatIsValid = ["jpg", "jpeg", "png", "webp"].includes(format);
  const secureUrlIsValid = secureUrlMatchesUpload(secureUrl, expectedPublicId);

  if (
    !identityIsValid ||
    !bytesAreValid ||
    !dimensionsAreValid ||
    !formatIsValid ||
    !secureUrlIsValid ||
    bytes > env.uploadMaxBytes
  ) {
    return {
      error:
        bytesAreValid && bytes > env.uploadMaxBytes
          ? new AppError(
              413,
              "UPLOAD_TOO_LARGE",
              `Images must be ${Math.floor(env.uploadMaxBytes / (1_024 * 1_024))} MB or smaller`,
            )
          : new AppError(
              422,
              "UPLOAD_INVALID",
              "The image provider returned an upload that does not match the studio policy",
            ),
    };
  }

  return {
    value: {
      bytes,
      width,
      height,
      format,
      version: Number.isSafeInteger(version) && version >= 0 ? version : 0,
      assetId: String(asset?.asset_id || "").trim(),
      secureUrl,
    },
  };
};

const uploadCompletionData = (grant) => ({
  publicId: grant.publicId,
  url: grant.verifiedSecureUrl,
  secureUrl: grant.verifiedSecureUrl,
  bytes: grant.verifiedBytes,
  width: grant.verifiedWidth,
  height: grant.verifiedHeight,
  format: grant.verifiedFormat,
  verifiedAt: new Date(grant.verifiedAt).toISOString(),
});

const uploadSignatureLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: env.uploadSignaturesPerHour,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: (request) => request.user.id,
  store: new DurableRateLimitStore("upload-signatures"),
  passOnStoreError: !env.isProduction,
  handler: rateLimitHandler("Too many upload requests. Please try again later"),
});

const uploadCompletionLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: Math.max(30, env.uploadSignaturesPerHour * 3),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: (request) => request.user.id,
  store: new DurableRateLimitStore("upload-completions"),
  passOnStoreError: !env.isProduction,
  handler: rateLimitHandler("Too many upload verification requests. Please try again later"),
});

const protectProductUploads = (request, response, next) =>
  request.validated.body.purpose === "products"
    ? requireAdmin(request, response, next)
    : next();

uploadsRouter.post(
  "/signature",
  authenticate,
  uploadSignatureLimiter,
  validate({ body: uploadSignatureSchema }),
  protectProductUploads,
  asyncHandler(async (request, response) => {
    requireCloudinaryConfig();
    const cloudinary = await getCloudinary();
    await verifyUploadPreset(cloudinary);

    const timestamp = Math.floor(Date.now() / 1_000);
    const folder = `gift-n-wrap/${request.validated.body.purpose}/${request.user.id}`;
    const assetId = randomUUID();
    const fullPublicId = `${folder}/${assetId}`;
    const grant = await reserveUploadGrant({
      userId: request.user.id,
      purpose: request.validated.body.purpose,
      publicId: fullPublicId,
    });
    const params = {
      timestamp,
      folder,
      public_id: assetId,
      overwrite: false,
      upload_preset: env.cloudinaryUploadPreset,
      allowed_formats: "jpg,jpeg,png,webp",
    };
    const signature = cloudinary.utils.api_sign_request(params, env.cloudinaryApiSecret);
    response.json({
      data: {
        ...params,
        fullPublicId,
        reservedPublicId: fullPublicId,
        expiresAt: new Date(grant.expiresAt).toISOString(),
        expiresInSeconds: grant.expiresInSeconds,
        signature,
        cloudName: env.cloudinaryCloudName,
        apiKey: env.cloudinaryApiKey,
        uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`,
        constraints: {
          maxBytes: env.uploadMaxBytes,
          maxDimension: maxUploadDimension,
          maxPixels: maxUploadPixels,
          allowedFormats: ["jpg", "jpeg", "png", "webp"],
        },
      },
    });
  }),
);

uploadsRouter.post(
  "/complete",
  authenticate,
  uploadCompletionLimiter,
  validate({ body: uploadCompleteSchema }),
  asyncHandler(async (request, response) => {
    requireCloudinaryConfig({ uploadPreset: false });
    const { publicId } = request.validated.body;
    const claim = await claimUploadGrantForVerification({
      userId: request.user.id,
      publicId,
      allowProductUploads: hasAdminAccess(request.user),
    });

    if (claim.alreadyVerified) {
      response.json({ data: uploadCompletionData(claim.grant) });
      return;
    }

    const cloudinary = await getCloudinary();
    configureCloudinary(cloudinary);
    let providerAsset;
    try {
      providerAsset = await withProviderTimeout(() =>
        uploadResourceLoader(cloudinary, publicId),
      );
    } catch (error) {
      await releaseUploadGrantReservation(claim.reservationToken).catch(() => {});
      throw new AppError(
        502,
        "UPLOAD_VERIFICATION_FAILED",
        "The image provider could not verify this upload. Please try again",
        { providerStatus: error?.http_code || error?.status || 0 },
      );
    }

    const inspected = inspectUploadedAsset(providerAsset, publicId);
    if (inspected.error) {
      try {
        const destroyResult = await withProviderTimeout(() =>
          rejectedUploadDestroyer(cloudinary, publicId),
        );
        if (!["ok", "not found"].includes(destroyResult?.result)) {
          throw new Error("Cloudinary did not confirm rejected upload cleanup");
        }
        await rejectUploadGrantVerification({
          userId: request.user.id,
          publicId,
          reservationToken: claim.reservationToken,
        });
      } catch {
        await releaseUploadGrantReservation(claim.reservationToken).catch(() => {});
        throw new AppError(
          502,
          "UPLOAD_REJECTION_CLEANUP_FAILED",
          "The unsafe upload was rejected but could not be removed. Please try again",
        );
      }
      throw inspected.error;
    }

    let grant;
    try {
      grant = await finalizeUploadGrantVerification({
        userId: request.user.id,
        publicId,
        reservationToken: claim.reservationToken,
        ...inspected.value,
      });
    } catch (error) {
      await releaseUploadGrantReservation(claim.reservationToken).catch(() => {});
      throw error;
    }
    response.json({ data: uploadCompletionData(grant) });
  }),
);

uploadsRouter.delete(
  "/asset",
  authenticate,
  validate({ body: uploadAssetDeleteSchema }),
  asyncHandler(async (request, response) => {
    const { publicId } = request.validated.body;
    const finalized = await cleanupUploadAssetForUser({
      userId: request.user.id,
      publicId,
      allowConsumedProductCleanup: hasAdminAccess(request.user),
    });
    response.json({
      data: {
        success: true,
        publicId,
        provenanceRetained: finalized.provenanceRetained,
      },
    });
  }),
);
