import assert from "node:assert/strict";
import test from "node:test";
import { DurableRateLimitStore } from "../middleware/durable-rate-limit.js";
import { RateLimitCounter } from "../models/RateLimitCounter.js";

test("MongoDB rate-limit increments opt in to Mongoose pipeline updates", async () => {
  let captured;
  const resetTime = new Date(Date.now() + 60_000);
  const counterModel = {
    findOneAndUpdate(filter, update, options) {
      const query = RateLimitCounter.findOneAndUpdate(filter, update, options);
      captured = { filter, update, options, query };
      return {
        lean: async () => ({ totalHits: 1, resetTime }),
      };
    },
  };
  const store = new DurableRateLimitStore("api", {
    connect: async () => "mongodb",
    counterModel,
  });
  store.init({ windowMs: 60_000 });

  const result = await store.increment("203.0.113.9");

  assert.equal(captured.options.updatePipeline, true);
  assert.equal(captured.query.mongooseOptions().updatePipeline, true);
  assert.equal(captured.options.upsert, true);
  assert.equal(captured.options.returnDocument, "after");
  assert.ok(Array.isArray(captured.update));
  assert.ok(Array.isArray(captured.query.getUpdate()));
  assert.match(captured.filter._id, /^gnw:api:/);
  assert.doesNotMatch(captured.filter._id, /203\.0\.113\.9/);
  assert.deepEqual(result, { totalHits: 1, resetTime });
});
