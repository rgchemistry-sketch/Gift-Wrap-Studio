import mongoose from "mongoose";

const rateLimitCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    totalHits: { type: Number, required: true, min: 0, default: 0 },
    resetTime: { type: Date, required: true, expires: 0 },
  },
  { versionKey: false },
);

export const RateLimitCounter =
  mongoose.models.RateLimitCounter ||
  mongoose.model("RateLimitCounter", rateLimitCounterSchema);
