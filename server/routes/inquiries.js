import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requireExpectedUser } from "../middleware/auth.js";
import { DurableRateLimitStore } from "../middleware/durable-rate-limit.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { sendInquiryCreatedEmails } from "../services/email-notifications.js";
import { createCustomInquiry, listBuyerInquiries } from "../services/store.js";
import { customInquirySchema, inboxQuerySchema } from "../validation/schemas.js";

export const inquiriesRouter = Router();

const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: (request) => request.user.id,
  store: new DurableRateLimitStore("inquiries"),
  passOnStoreError: !env.isProduction,
  handler: rateLimitHandler("Too many requests. Please try again later"),
});

inquiriesRouter.get(
  "/mine",
  authenticate,
  validate({ query: inboxQuerySchema }),
  asyncHandler(async (request, response) => {
    const result = await listBuyerInquiries(request.user.id, request.validated.query);
    response.json({
      data: result.items,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
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
    await sendInquiryCreatedEmails(inquiry);
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
