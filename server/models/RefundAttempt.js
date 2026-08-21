import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const refundAttemptSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, trim: true, maxlength: 100 },
    paymentAttemptId: { type: String, required: true, trim: true, maxlength: 100 },
    buyerId: { type: String, required: true, trim: true, maxlength: 100 },
    createdBy: { type: String, required: true, trim: true, maxlength: 100 },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 100, select: false },
    requestHash: { type: String, required: true, trim: true, maxlength: 64, select: false },
    receipt: { type: String, required: true, trim: true, maxlength: 40 },
    providerPaymentId: { type: String, required: true, trim: true, maxlength: 100 },
    providerRefundId: { type: String, default: "", trim: true, maxlength: 100 },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ["INR"], default: "INR" },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    state: {
      type: String,
      enum: ["creating", "pending", "processed", "failed", "unknown"],
      default: "creating",
      index: true,
    },
    providerStatus: { type: String, default: "", trim: true, maxlength: 40 },
    processedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    reservationReleasedAt: { type: Date, default: null },
    lastProviderCheckAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

refundAttemptSchema.index(
  { orderId: 1, idempotencyKey: 1 },
  { name: "uniq_refund_attempt_idempotency", unique: true },
);
refundAttemptSchema.index({ receipt: 1 }, { name: "uniq_refund_attempt_receipt", unique: true });
refundAttemptSchema.index(
  { providerRefundId: 1 },
  {
    name: "uniq_refund_attempt_provider_refund",
    unique: true,
    partialFilterExpression: { providerRefundId: { $gt: "" } },
  },
);
refundAttemptSchema.index(
  { state: 1, lastProviderCheckAt: 1, createdAt: 1 },
  { name: "refund_attempt_reconciliation" },
);

export const RefundAttempt =
  mongoose.models.RefundAttempt || mongoose.model("RefundAttempt", refundAttemptSchema);
