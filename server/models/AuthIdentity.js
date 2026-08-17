import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const authIdentitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 50,
      index: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 512 },
    providerEmail: { type: String, default: "", lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

authIdentitySchema.index({ provider: 1, subject: 1 }, { unique: true });

export const AuthIdentity =
  mongoose.models.AuthIdentity || mongoose.model("AuthIdentity", authIdentitySchema);
