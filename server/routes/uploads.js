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
import { reserveUploadGrant } from "../services/store.js";
import { cleanupUploadAssetForUser } from "../services/upload-cleanup.js";
import { uploadAssetDeleteSchema, uploadSignatureSchema } from "../validation/schemas.js";

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

const verifyUploadPreset = async (cloudinary) => {
  if (!env.verifyCloudinaryUploadPreset) return;
  if (!uploadPresetVerificationPromise) {
    uploadPresetVerificationPromise = (async () => {
      cloudinary.config({
        cloud_name: env.cloudinaryCloudName,
        api_key: env.cloudinaryApiKey,
        api_secret: env.cloudinaryApiSecret,
        secure: true,
      });
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
      const maxFileSize = Number(
        preset?.settings?.max_file_size ?? preset?.max_file_size,
      );
      if (!Number.isFinite(maxFileSize) || maxFileSize > env.uploadMaxBytes) {
        throw configurationError([
          `CLOUDINARY_UPLOAD_PRESET max_file_size <= ${env.uploadMaxBytes}`,
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
      transformation: "c_limit,w_2400,h_2400",
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
          allowedFormats: ["jpg", "jpeg", "png", "webp"],
        },
      },
    });
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
