import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const userSchema = new mongoose.Schema(
  {
    googleSub: { type: String, required: true, unique: true, index: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    avatar: { type: String, default: "", trim: true },
    role: { type: String, enum: ["buyer", "admin"], default: "buyer", index: true },
    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
