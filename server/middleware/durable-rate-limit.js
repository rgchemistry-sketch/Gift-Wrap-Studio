import { createHash } from "node:crypto";
import { MemoryStore } from "express-rate-limit";
import { connectDatabase } from "../config/database.js";
import { RateLimitCounter } from "../models/RateLimitCounter.js";

const counterId = (prefix, key) =>
  `${prefix}:${createHash("sha256").update(String(key)).digest("base64url")}`;

export class DurableRateLimitStore {
  constructor(prefix) {
    this.prefix = `gnw:${prefix}`;
    this.localKeys = false;
    this.memory = new MemoryStore();
    this.windowMs = 60_000;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async increment(key) {
    const mode = await connectDatabase({ allowFallback: true });
    if (mode !== "mongodb") return this.memory.increment(key);
    const now = new Date();
    const nextReset = new Date(now.getTime() + this.windowMs);
    const record = await RateLimitCounter.findOneAndUpdate(
      { _id: counterId(this.prefix, key) },
      [
        {
          $set: {
            totalHits: {
              $cond: [
                { $gt: ["$resetTime", now] },
                { $add: [{ $ifNull: ["$totalHits", 0] }, 1] },
                1,
              ],
            },
            resetTime: {
              $cond: [{ $gt: ["$resetTime", now] }, "$resetTime", nextReset],
            },
          },
        },
      ],
      { upsert: true, new: true },
    ).lean();
    return { totalHits: record.totalHits, resetTime: record.resetTime };
  }

  async get(key) {
    const mode = await connectDatabase({ allowFallback: true });
    if (mode !== "mongodb") return this.memory.get(key);
    const record = await RateLimitCounter.findById(counterId(this.prefix, key)).lean();
    if (!record || record.resetTime <= new Date()) return undefined;
    return { totalHits: record.totalHits, resetTime: record.resetTime };
  }

  async decrement(key) {
    const mode = await connectDatabase({ allowFallback: true });
    if (mode !== "mongodb") return this.memory.decrement(key);
    await RateLimitCounter.updateOne(
      { _id: counterId(this.prefix, key), totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } },
    );
  }

  async resetKey(key) {
    const mode = await connectDatabase({ allowFallback: true });
    if (mode !== "mongodb") return this.memory.resetKey(key);
    await RateLimitCounter.deleteOne({ _id: counterId(this.prefix, key) });
  }

  shutdown() {
    this.memory.shutdown();
  }
}
