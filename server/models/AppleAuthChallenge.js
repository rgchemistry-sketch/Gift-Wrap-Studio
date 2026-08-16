import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const appleAuthChallengeSchema = new mongoose.Schema(
  {
    challengeHash: { type: String, required: true, unique: true, index: true },
    nonceHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    consumedAt: { type: Date },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const AppleAuthChallenge =
  mongoose.models.AppleAuthChallenge ||
  mongoose.model("AppleAuthChallenge", appleAuthChallengeSchema);
