import { randomUUID } from "node:crypto";
import { Router } from "express";
import { v2 as cloudinary } from "cloudinary";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { configurationError } from "../lib/errors.js";
import { authenticate } from "../middleware/auth.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { reserveUploadGrant } from "../services/store.js";
import { uploadSignatureSchema } from "../validation/schemas.js";

export const uploadsRouter = Router();

const uploadSignatureLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: env.uploadSignaturesPerHour,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: (request) => request.user.id,
  handler: rateLimitHandler("Too many upload requests. Please try again later"),
});

uploadsRouter.post(
  "/signature",
  authenticate,
  uploadSignatureLimiter,
  validate({ body: uploadSignatureSchema }),
  asyncHandler(async (request, response) => {
    const missing = [
      ["CLOUDINARY_CLOUD_NAME", env.cloudinaryCloudName],
      ["CLOUDINARY_API_KEY", env.cloudinaryApiKey],
      ["CLOUDINARY_API_SECRET", env.cloudinaryApiSecret],
      ["CLOUDINARY_UPLOAD_PRESET", env.cloudinaryUploadPreset],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length) throw configurationError(missing);

    const timestamp = Math.floor(Date.now() / 1_000);
    const folder = `gift-n-wrap/${request.validated.body.purpose}/${request.user.id}`;
    const publicId = randomUUID();
    await reserveUploadGrant({
      userId: request.user.id,
      purpose: request.validated.body.purpose,
      publicId,
    });
    const params = {
      timestamp,
      folder,
      public_id: publicId,
      overwrite: false,
      upload_preset: env.cloudinaryUploadPreset,
      allowed_formats: "jpg,jpeg,png,webp",
      transformation: "c_limit,w_2400,h_2400",
    };
    const signature = cloudinary.utils.api_sign_request(params, env.cloudinaryApiSecret);
    response.json({
      data: {
        ...params,
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
