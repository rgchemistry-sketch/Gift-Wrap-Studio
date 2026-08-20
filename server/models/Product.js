import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, default: "", trim: true },
    alt: { type: String, default: "", trim: true, maxlength: 160 },
  },
  { _id: false },
);

const variantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    sku: { type: String, default: "", trim: true, uppercase: true, maxlength: 80 },
    price: { type: Number, default: null, min: 0 },
    inventory: { type: Number, default: null, min: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    category: { type: String, required: true, index: true, trim: true, maxlength: 80 },
    // Drives the storefront's occasion navigation (/shop?occasion=Wedding) and filters.
    occasion: { type: String, default: "", index: true, trim: true, maxlength: 80 },
    shortDescription: { type: String, required: true, trim: true, maxlength: 240 },
    description: { type: String, default: "", trim: true, maxlength: 4_000 },
    sku: { type: String, default: "", trim: true, uppercase: true, maxlength: 80, index: true },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: null, min: 0 },
    images: { type: [imageSchema], default: [] },
    tags: { type: [String], default: [] },
    customizationOptions: { type: [String], default: [] },
    customizationAvailable: {
      type: Boolean,
      // Match the storefront's historical behavior for records and callers
      // that predate this explicit control.
      default() {
        return this.madeToOrder !== false;
      },
    },
    variants: { type: [variantSchema], default: [] },
    featured: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },
    madeToOrder: { type: Boolean, default: true },
    leadTimeDays: { type: Number, default: 7, min: 1, max: 60 },
    inventory: { type: Number, default: null, min: 0 },
    orderReservationVersion: { type: Number, default: 0, min: 0, select: false },
    sortOrder: { type: Number, default: 0, index: true },
    archivedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

productSchema.index({ name: "text", shortDescription: "text", tags: "text" });

export const Product = mongoose.models.Product || mongoose.model("Product", productSchema);
