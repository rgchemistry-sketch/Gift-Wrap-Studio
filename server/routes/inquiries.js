import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requireExpectedUser } from "../middleware/auth.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { createCustomInquiry, listBuyerInquiries } from "../services/store.js";
import { customInquirySchema } from "../validation/schemas.js";

export const inquiriesRouter = Router();

const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: rateLimitHandler("Too many requests. Please try again later"),
});

inquiriesRouter.get(
  "/mine",
  authenticate,
  asyncHandler(async (request, response) => {
    response.json({ data: await listBuyerInquiries(request.user.id) });
  }),
);

inquiriesRouter.post(
  "/",
  authenticate,
  requireExpectedUser,
  inquiryLimiter,
  validate({ body: customInquirySchema }),
  asyncHandler(async (request, response) => {
    const inquiry = await createCustomInquiry(request.validated.body, request.user);
    response.status(201).json({
      data: {
        id: inquiry.id,
        status: inquiry.status,
        createdAt: inquiry.createdAt,
        message: "Thank you. We will contact you to discuss your design.",
      },
    });
  }),
);
