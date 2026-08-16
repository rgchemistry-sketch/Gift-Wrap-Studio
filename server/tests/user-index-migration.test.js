import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";

const { User, isLegacyGoogleSubIndex, removeLegacyUserIdentityIndexes } = await import(
  "../models/User.js"
);

test("legacy Google-only identity index is replaced safely for multi-provider accounts", async () => {
  const googleIndex = User.schema
    .indexes()
    .find(([keys]) => Object.keys(keys).length === 1 && keys.googleSub === 1);
  assert.ok(googleIndex);
  assert.equal(googleIndex[1].unique, true);
  assert.equal(googleIndex[1].sparse, true);

  assert.equal(
    isLegacyGoogleSubIndex({
      name: "googleSub_1",
      key: { googleSub: 1 },
      unique: true,
    }),
    true,
  );
  assert.equal(
    isLegacyGoogleSubIndex({
      name: "googleSub_1",
      key: { googleSub: 1 },
      unique: true,
      sparse: true,
    }),
    false,
  );

  const dropped = [];
  const collection = {
    indexes: async () => [
      { name: "_id_", key: { _id: 1 } },
      { name: "googleSub_1", key: { googleSub: 1 }, unique: true },
      { name: "email_1", key: { email: 1 }, unique: true },
    ],
    dropIndex: async (name) => dropped.push(name),
  };

  const removed = await removeLegacyUserIdentityIndexes(collection);
  assert.deepEqual(removed, ["googleSub_1"]);
  assert.deepEqual(dropped, ["googleSub_1"]);
});
