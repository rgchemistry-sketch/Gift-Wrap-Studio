import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const razorpayWebhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, trim: true, maxlength: 160 },
    eventType: { type: String, required: true, trim: true, maxlength: 100 },
    payloadHash: { type: String, required: true, trim: true, maxlength: 64 },
    providerOrderId: { type: String, default: "", trim: true, maxlength: 100 },
    providerPaymentId: { type: String, default: "", trim: true, maxlength: 100 },
    providerRefundId: { type: String, default: "", trim: true, maxlength: 100 },
    providerCreatedAt: { type: Date, default: null },
    outcome: {
      type: String,
      enum: ["processing", "processed", "ignored", "failed"],
      default: "processing",
      index: true,
    },
    resultCode: { type: String, default: "", trim: true, maxlength: 100 },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

razorpayWebhookEventSchema.index(
  { eventId: 1 },
  { name: "uniq_razorpay_webhook_event", unique: true },
);
razorpayWebhookEventSchema.index(
  { outcome: 1, updatedAt: 1 },
  { name: "razorpay_webhook_retry" },
);

export const RazorpayWebhookEvent =
  mongoose.models.RazorpayWebhookEvent ||
  mongoose.model("RazorpayWebhookEvent", razorpayWebhookEventSchema);
