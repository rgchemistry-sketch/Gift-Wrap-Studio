import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const leadTimesSchema = new mongoose.Schema(
  {
    ready: { type: String, required: true, trim: true, maxlength: 120 },
    custom: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false },
);

const offerSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, required: true },
    eyebrow: { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, required: true, trim: true, maxlength: 300 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    percent: { type: Number, required: true, min: 0, max: 100 },
    maxDiscount: { type: Number, required: true, min: 0, max: 100_000 },
    delaySeconds: { type: Number, required: true, min: 0, max: 60 },
  },
  { _id: false },
);

const shippingSchema = new mongoose.Schema(
  {
    flatFee: { type: Number, required: true, min: 0, max: 10_000 },
    freeThreshold: { type: Number, required: true, min: 0, max: 1_000_000 },
    bulkThreshold: { type: Number, required: true, min: 2, max: 100 },
  },
  { _id: false },
);

const announcementSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, required: true },
    text: { type: String, default: "", trim: true, maxlength: 160 },
    linkLabel: { type: String, default: "", trim: true, maxlength: 40 },
    linkUrl: { type: String, default: "", trim: true, maxlength: 1_000 },
  },
  { _id: false },
);

const contactSchema = new mongoose.Schema(
  {
    email: { type: String, default: "", lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, default: "", trim: true, maxlength: 20 },
    instagram: { type: String, default: "", trim: true, maxlength: 200 },
  },
  { _id: false },
);

const studioSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "studio" },
    leadTimes: { type: leadTimesSchema, required: true },
    offer: { type: offerSchema, required: true },
    shipping: { type: shippingSchema, required: true },
    announcement: { type: announcementSchema, required: true },
    contact: { type: contactSchema, required: true },
    updatedBy: { type: String, default: "", lowercase: true, trim: true, maxlength: 254 },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const StudioSettings =
  mongoose.models.StudioSettings || mongoose.model("StudioSettings", studioSettingsSchema);
