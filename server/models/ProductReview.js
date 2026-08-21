import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const productSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, trim: true, maxlength: 160 },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    image: { type: String, default: "", trim: true, maxlength: 1_000 },
    href: { type: String, required: true, trim: true, maxlength: 220 },
  },
  { _id: false },
);

const productReviewSchema = new mongoose.Schema(
  {
    buyerId: { type: String, required: true, index: true, trim: true, maxlength: 100 },
    productId: { type: String, required: true, index: true, trim: true, maxlength: 100 },
    deliveredOrderId: { type: String, required: true, trim: true, maxlength: 100, select: false },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, minlength: 10, maxlength: 1_000 },
    authorName: { type: String, required: true, trim: true, maxlength: 100 },
    product: { type: productSnapshotSchema, required: true },
    verifiedPurchase: { type: Boolean, required: true, default: true, immutable: true },
    purchaseVerifiedAt: { type: Date, required: true, default: Date.now, select: false },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

productReviewSchema.index(
  { buyerId: 1, productId: 1 },
  { name: "uniq_buyer_product_review", unique: true },
);
productReviewSchema.index({ createdAt: -1 }, { name: "reviews_recent" });

export const ProductReview =
  mongoose.models.ProductReview || mongoose.model("ProductReview", productReviewSchema);
