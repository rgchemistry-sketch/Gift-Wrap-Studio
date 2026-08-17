import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const contactSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, default: "", trim: true, maxlength: 20 },
    subject: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 3_000 },
    status: { type: String, enum: ["new", "read", "replied", "archived"], default: "new", index: true },
    adminNote: { type: String, default: "", maxlength: 2_000 },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema);
