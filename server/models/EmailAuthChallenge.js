import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const emailAuthChallengeSchema = new mongoose.Schema(
  {
    challengeHash: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, default: "", trim: true, maxlength: 100 },
    intent: { type: String, required: true, enum: ["login", "signup"] },
    codeHash: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    expiresAt: { type: Date, required: true, expires: 0 },
    consumedAt: { type: Date },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const EmailAuthChallenge =
  mongoose.models.EmailAuthChallenge ||
  mongoose.model("EmailAuthChallenge", emailAuthChallengeSchema);
