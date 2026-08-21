import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError, badRequest } from "../lib/errors.js";
import { authenticate, requireExpectedUser } from "../middleware/auth.js";
import { DurableRateLimitStore } from "../middleware/durable-rate-limit.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  confirmBuyerRazorpayPayment,
  createBuyerRazorpaySession,
  getBuyerPaymentState,
  processRazorpayWebhook,
} from "../services/payments.js";
import { sendPaymentCapturedEmails } from "../services/email-notifications.js";
import {
  idParamsSchema,
  razorpayConfirmSchema,
  razorpaySessionSchema,
} from "../validation/schemas.js";
import {
  verifyRazorpayWebhookSignature,
} from "../services/razorpay.js";

const paymentRateLimit = (prefix, limit) =>
  rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.isTest,
    store: new DurableRateLimitStore(prefix),
    passOnStoreError: !env.isProduction,
    handler: rateLimitHandler("Too many payment attempts. Please wait before trying again"),
  });

const sessionLimiter = paymentRateLimit("razorpay-session", 12);
const confirmLimiter = paymentRateLimit("razorpay-confirm", 30);

const requiredIdempotencyKey = (request) => {
  const key = request.get("idempotency-key")?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) {
    throw badRequest("Idempotency-Key is required and must contain 8-100 safe characters");
  }
  return key;
};

export const razorpayWebhookHandler = asyncHandler(async (request, response) => {
  const rawBody = request.body;
  if (!Buffer.isBuffer(rawBody)) throw badRequest("Razorpay webhook requires a raw JSON body");
  const signature = request.get("x-razorpay-signature")?.trim() || "";
  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    throw new AppError(401, "WEBHOOK_SIGNATURE_INVALID", "Webhook signature verification failed");
  }
  const eventId = request.get("x-razorpay-event-id")?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{6,160}$/.test(eventId)) {
    throw badRequest("Razorpay webhook event identifier is missing or invalid");
  }
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw badRequest("Razorpay webhook body is not valid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw badRequest("Razorpay webhook body must be an object");
  }
  const result = await processRazorpayWebhook({ eventId, rawBody, payload });
  response.setHeader("Cache-Control", "no-store");
  response.json({ data: { received: true, ...result } });
});

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

paymentsRouter.post(
  "/razorpay/orders/:id/session",
  sessionLimiter,
  requireExpectedUser,
  validate({ params: idParamsSchema, body: razorpaySessionSchema }),
  asyncHandler(async (request, response) => {
    const result = await createBuyerRazorpaySession(
      request.user,
      request.validated.params.id,
      requiredIdempotencyKey(request),
      request.validated.body.policyConsent,
    );
    if (result.replayed) response.setHeader("Idempotency-Replayed", "true");
    response.setHeader("Cache-Control", "no-store");
    response.status(result.replayed ? 200 : 201).json({
      data: result.data,
      meta: { replayed: result.replayed },
    });
  }),
);

paymentsRouter.post(
  "/razorpay/confirm",
  confirmLimiter,
  requireExpectedUser,
  validate({ body: razorpayConfirmSchema }),
  asyncHandler(async (request, response) => {
    const result = await confirmBuyerRazorpayPayment(request.user, request.validated.body);
    if (result.becamePaid) await sendPaymentCapturedEmails(result.order);
    response.setHeader("Cache-Control", "no-store");
    response.status(result.payment?.state === "paid" ? 200 : 202).json({
      data: { order: result.order, payment: result.payment },
      meta: { becamePaid: result.becamePaid },
    });
  }),
);

paymentsRouter.get(
  "/orders/:id",
  validate({ params: idParamsSchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await getBuyerPaymentState(request.user, request.validated.params.id) });
  }),
);
