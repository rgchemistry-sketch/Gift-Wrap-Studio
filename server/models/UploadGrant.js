import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const uploadGrantSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    purpose: { type: String, required: true, enum: ["custom-inquiries", "orders", "profiles"] },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

const uploadQuotaSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    count: { type: Number, required: true, min: 0 },
    windowStartedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const UploadGrant =
  mongoose.models.UploadGrant || mongoose.model("UploadGrant", uploadGrantSchema);
export const UploadQuota =
  mongoose.models.UploadQuota || mongoose.model("UploadQuota", uploadQuotaSchema);
