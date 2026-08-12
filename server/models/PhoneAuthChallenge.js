import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const phoneAuthChallengeSchema = new mongoose.Schema(
  {
    challengeHash: { type: String, required: true, unique: true, index: true },
    googleSub: { type: String, required: true, index: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    avatar: { type: String, default: "", trim: true },
    phone: { type: String, required: true, index: true, trim: true },
    intent: { type: String, required: true, enum: ["login", "signup"] },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    expiresAt: { type: Date, required: true, expires: 0 },
    consumedAt: { type: Date },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const PhoneAuthChallenge =
  mongoose.models.PhoneAuthChallenge ||
  mongoose.model("PhoneAuthChallenge", phoneAuthChallengeSchema);
