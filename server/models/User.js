import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const userSchema = new mongoose.Schema(
  {
    // Retained for lazy migration of accounts created before generic identities existed.
    googleSub: { type: String, unique: true, sparse: true, index: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    emailVerifiedAt: { type: Date },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    avatar: { type: String, default: "", trim: true },
    phone: { type: String, sparse: true, unique: true, index: true, trim: true },
    phoneVerifiedAt: { type: Date },
    role: { type: String, enum: ["buyer", "admin"], default: "buyer", index: true },
    providers: {
      type: [{ type: String, enum: ["email", "google", "facebook", "apple"] }],
      default: [],
    },
    sessionVersion: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
