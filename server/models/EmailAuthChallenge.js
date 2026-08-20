import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const emailAuthChallengeSchema = new mongoose.Schema(
  {
    challengeHash: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, default: "", trim: true, maxlength: 100 },
    intent: { type: String, required: true, enum: ["login", "signup"] },
    codeHash: { type: String, required: true },
    cooldownToken: { type: String, default: "", trim: true, maxlength: 64 },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    expiresAt: { type: Date, required: true, expires: 0 },
    consumedAt: { type: Date },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const EmailAuthChallenge =
  mongoose.models.EmailAuthChallenge ||
  mongoose.model("EmailAuthChallenge", emailAuthChallengeSchema);

const emailAuthCooldownSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    reservationToken: { type: String, required: true, trim: true, maxlength: 64 },
    nextAllowedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const EmailAuthCooldown =
  mongoose.models.EmailAuthCooldown ||
  mongoose.model("EmailAuthCooldown", emailAuthCooldownSchema);
