import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

export const paymentAttemptStates = [
  "creating",
  "created",
  "authorized",
  "paid",
  "partially_refunded",
  "refunded",
  "review_required",
  "disputed",
  "failed",
  "unknown",
];

const providerFailureSchema = new mongoose.Schema(
  {
    code: { type: String, default: "", trim: true, maxlength: 100 },
    source: { type: String, default: "", trim: true, maxlength: 100 },
    step: { type: String, default: "", trim: true, maxlength: 100 },
    reason: { type: String, default: "", trim: true, maxlength: 160 },
    at: { type: Date, default: null },
  },
  { _id: false },
);

const paymentPolicyConsentSchema = new mongoose.Schema(
  {
    accepted: { type: Boolean, required: true },
    version: { type: String, required: true, trim: true, maxlength: 20 },
    acceptedAt: { type: Date, required: true },
  },
  { _id: false },
);

const paymentAttemptSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, trim: true, maxlength: 100 },
    orderNumber: { type: String, required: true, trim: true, maxlength: 80 },
    buyerId: { type: String, required: true, trim: true, maxlength: 100 },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 100, select: false },
    requestHash: { type: String, required: true, trim: true, maxlength: 64, select: false },
    receipt: { type: String, required: true, trim: true, maxlength: 40 },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ["INR"], default: "INR" },
    policyConsent: { type: paymentPolicyConsentSchema, required: true },
    state: { type: String, enum: paymentAttemptStates, default: "creating", index: true },
    attentionReason: { type: String, default: "", trim: true, maxlength: 80 },
    providerOrderId: { type: String, default: "", trim: true, maxlength: 100 },
    providerOrderStatus: { type: String, default: "", trim: true, maxlength: 40 },
    providerPaymentId: { type: String, default: "", trim: true, maxlength: 100 },
    providerPaymentStatus: { type: String, default: "", trim: true, maxlength: 40 },
    lastFailedPaymentId: { type: String, default: "", trim: true, maxlength: 100 },
    failedAttempts: { type: Number, default: 0, min: 0 },
    lastFailure: { type: providerFailureSchema, default: null, select: false },
    refundedAmountPaise: { type: Number, default: 0, min: 0 },
    refundReservedAmountPaise: { type: Number, default: 0, min: 0 },
    signatureVerifiedAt: { type: Date, default: null, select: false },
    authorizedAt: { type: Date, default: null },
    capturedAt: { type: Date, default: null },
    lastProviderCheckAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

paymentAttemptSchema.index({ orderId: 1 }, { name: "uniq_payment_attempt_order", unique: true });
paymentAttemptSchema.index(
  { buyerId: 1, idempotencyKey: 1 },
  { name: "uniq_payment_attempt_idempotency", unique: true },
);
paymentAttemptSchema.index({ receipt: 1 }, { name: "uniq_payment_attempt_receipt", unique: true });
paymentAttemptSchema.index(
  { providerOrderId: 1 },
  {
    name: "uniq_payment_attempt_provider_order",
    unique: true,
    partialFilterExpression: { providerOrderId: { $gt: "" } },
  },
);
paymentAttemptSchema.index(
  { providerPaymentId: 1 },
  {
    name: "uniq_payment_attempt_provider_payment",
    unique: true,
    partialFilterExpression: { providerPaymentId: { $gt: "" } },
  },
);
paymentAttemptSchema.index(
  { state: 1, lastProviderCheckAt: 1, createdAt: 1 },
  { name: "payment_attempt_reconciliation" },
);

export const PaymentAttempt =
  mongoose.models.PaymentAttempt || mongoose.model("PaymentAttempt", paymentAttemptSchema);
