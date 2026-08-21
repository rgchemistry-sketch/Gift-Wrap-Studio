import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    image: { type: String, default: "" },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    customization: { type: String, default: "", maxlength: 1_000 },
  },
  { _id: false },
);

const addressSchema = new mongoose.Schema(
  {
    recipientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, default: "India", trim: true },
  },
  { _id: false },
);

const inventoryReservationSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const policyConsentSchema = new mongoose.Schema(
  {
    accepted: { type: Boolean, required: true },
    version: { type: String, required: true, trim: true, maxlength: 20 },
    acceptedAt: { type: Date, required: true },
  },
  { _id: false },
);

const paymentQuoteSchema = new mongoose.Schema(
  {
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ["INR"], default: "INR" },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    quotedAt: { type: Date, required: true },
    quotedBy: { type: String, required: true, trim: true, maxlength: 100 },
    version: { type: Number, default: 1, min: 1 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    buyerId: { type: String, required: true, index: true },
    idempotencyKey: { type: String, trim: true, maxlength: 100, select: false },
    idempotencyHash: { type: String, trim: true, maxlength: 64, select: false },
    buyerEmail: { type: String, required: true, lowercase: true, trim: true },
    buyerName: { type: String, required: true, trim: true },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: [(items) => items.length > 0, "An order needs at least one item"],
    },
    shippingAddress: { type: addressSchema, required: true },
    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    couponCode: { type: String, default: "", uppercase: true, trim: true },
    welcomeOfferClaimed: { type: Boolean, default: false },
    isFirstOrder: { type: Boolean, default: false },
    neededBy: { type: Date, default: null },
    contactPreference: { type: String, default: "", trim: true, maxlength: 50 },
    note: { type: String, default: "", maxlength: 1_000 },
    status: {
      type: String,
      enum: ["placed", "confirmed", "in_progress", "ready", "shipped", "delivered", "cancelled"],
      default: "placed",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["manual_confirmation", "razorpay"],
      default: "manual_confirmation",
    },
    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "authorized",
        "paid",
        "partially_refunded",
        "refunded",
        "review_required",
        "disputed",
        "failed",
      ],
      default: "pending",
      index: true,
    },
    paymentReviewCode: { type: String, default: "", trim: true, maxlength: 80 },
    paymentQuote: { type: paymentQuoteSchema, default: null },
    refundedAmountPaise: { type: Number, default: 0, min: 0 },
    paymentCapturedAt: { type: Date, default: null },
    policyConsent: { type: policyConsentSchema, default: null },
    statusHistory: {
      type: [
        new mongoose.Schema(
          {
            status: { type: String, required: true },
            at: { type: Date, required: true },
            note: { type: String, default: "" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    inventoryReservations: {
      type: [inventoryReservationSchema],
      default: [],
      select: false,
    },
    inventoryReleasedAt: { type: Date, default: null, select: false },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

orderSchema.index(
  { buyerId: 1, idempotencyKey: 1 },
  {
    name: "uniq_buyer_idempotency",
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true } },
  },
);
orderSchema.index({ createdAt: 1 }, { name: "orders_created_at" });
orderSchema.index(
  { buyerId: 1, welcomeOfferClaimed: 1 },
  {
    name: "uniq_buyer_welcome_offer",
    unique: true,
    partialFilterExpression: { welcomeOfferClaimed: true },
  },
);
orderSchema.index(
  { buyerId: 1, isFirstOrder: 1 },
  {
    name: "uniq_buyer_first_order",
    unique: true,
    partialFilterExpression: { isFirstOrder: true },
  },
);

export const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
