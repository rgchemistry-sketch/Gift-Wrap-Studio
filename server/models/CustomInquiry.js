import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const customInquirySchema = new mongoose.Schema(
  {
    userId: { type: String, default: "", index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    productId: { type: String, default: "", trim: true },
    category: { type: String, default: "", trim: true, maxlength: 80 },
    occasion: { type: String, default: "", trim: true, maxlength: 100 },
    palette: { type: String, default: "", trim: true, maxlength: 200 },
    idea: { type: String, required: true, trim: true, maxlength: 3_000 },
    customization: { type: String, default: "", trim: true, maxlength: 2_000 },
    budget: { type: String, default: "", trim: true, maxlength: 80 },
    neededBy: { type: Date, default: null },
    contactPreference: { type: String, default: "", trim: true, maxlength: 50 },
    // Inspiration links are untrusted outbound references. Keep them separate from
    // grant-backed images so no renderer can mistake an arbitrary link for owned media.
    referenceUrl: { type: String, default: "", trim: true, maxlength: 1_000 },
    referenceImages: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["new", "contacted", "quoted", "accepted", "closed"],
      default: "new",
      index: true,
    },
    adminNote: { type: String, default: "", maxlength: 2_000 },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

customInquirySchema.index({ createdAt: 1 }, { name: "custom_inquiries_created_at" });

export const CustomInquiry =
  mongoose.models.CustomInquiry || mongoose.model("CustomInquiry", customInquirySchema);
