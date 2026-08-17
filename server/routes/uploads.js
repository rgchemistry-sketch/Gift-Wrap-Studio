import { randomUUID } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { configurationError } from "../lib/errors.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { reserveUploadGrant } from "../services/store.js";
import {
  cleanupUploadAssetForUser,
  scheduleExpiredUploadGrantSweep,
  waitForUploadCleanupBudget,
} from "../services/upload-cleanup.js";
import { uploadAssetDeleteSchema, uploadSignatureSchema } from "../validation/schemas.js";

export {
  resetUploadAssetDestroyerForTests,
  setUploadAssetDestroyerForTests,
} from "../services/upload-cleanup.js";

export const uploadsRouter = Router();

let cloudinaryPromise;

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

const uploadSignatureLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: env.uploadSignaturesPerHour,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: (request) => request.user.id,
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
    await waitForUploadCleanupBudget(scheduleExpiredUploadGrantSweep());

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
          maxBytes: 8 * 1_024 * 1_024,
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
      allowConsumedProductCleanup:
        request.user.role === "admin" && request.user.email === env.adminEmail,
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
