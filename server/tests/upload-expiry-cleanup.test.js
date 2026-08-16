import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-expired-upload-cleanup-secret-long-enough";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-api-key";
process.env.CLOUDINARY_API_SECRET = "test-cloudinary-secret-long-enough";
process.env.CLOUDINARY_UPLOAD_PRESET = "test-locked-preset";
delete process.env.MONGODB_URI;

const [
  { memoryStore, resetMemoryStore },
  store,
  uploadCleanup,
  { UploadGrant, isLegacyUploadGrantTtlIndex, removeLegacyUploadGrantTtlIndexes },
] = await Promise.all([
  import("../lib/memory-store.js"),
  import("../services/store.js"),
  import("../services/upload-cleanup.js"),
  import("../models/UploadGrant.js"),
]);

beforeEach(() => {
  resetMemoryStore();
  uploadCleanup.resetUploadAssetDestroyerForTests();
});

const createGrant = async ({ userId = "cleanup-owner", purpose = "products" } = {}) => {
  const publicId = `gift-n-wrap/${purpose}/${userId}/${randomUUID()}`;
  await store.reserveUploadGrant({ userId, purpose, publicId });
  return publicId;
};

test("expired cleanup removes only unused assets and preserves active provenance", async () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const expired = await createGrant();
  const staleReservation = await createGrant();
  const fresh = await createGrant();
  const consumed = await createGrant();
  const tombstoned = await createGrant();
  const activeReservation = await createGrant();

  memoryStore.update("uploadGrants", expired, {
    expiresAt: new Date(now.getTime() - 60_000),
  });
  memoryStore.update("uploadGrants", staleReservation, {
    expiresAt: new Date(now.getTime() - 50_000),
    reservationToken: "abandoned-write",
    reservationKind: "product-write",
    reservedAt: new Date(now.getTime() - 16 * 60_000),
  });
  memoryStore.update("uploadGrants", consumed, {
    consumedAt: new Date(now.getTime() - 30_000),
    productId: "saved-product",
    expiresAt: undefined,
  });
  memoryStore.update("uploadGrants", tombstoned, {
    consumedAt: new Date(now.getTime() - 30_000),
    deletedAt: new Date(now.getTime() - 20_000),
    productId: "retired-product",
    expiresAt: undefined,
  });
  memoryStore.update("uploadGrants", activeReservation, {
    expiresAt: new Date(now.getTime() - 10_000),
    reservationToken: "active-write",
    reservationKind: "product-write",
    reservedAt: new Date(now.getTime() - 60_000),
  });

  const destroyed = [];
  uploadCleanup.setUploadAssetDestroyerForTests(async (publicId) => {
    destroyed.push(publicId);
    return { result: "ok" };
  });
  const result = await uploadCleanup.runExpiredUploadGrantSweep({ limit: 10, now });

  assert.deepEqual(result, { claimed: 2, deleted: 2, failed: 0 });
  assert.deepEqual(destroyed, [expired, staleReservation]);
  assert.equal(memoryStore.get("uploadGrants", expired), undefined);
  assert.equal(memoryStore.get("uploadGrants", staleReservation), undefined);
  assert.ok(memoryStore.get("uploadGrants", fresh));
  assert.ok(memoryStore.get("uploadGrants", consumed)?.consumedAt);
  assert.ok(memoryStore.get("uploadGrants", tombstoned)?.deletedAt);
  assert.equal(
    memoryStore.get("uploadGrants", activeReservation)?.reservationToken,
    "active-write",
  );
});

test("provider failures preserve expired grants and defer a bounded retry", async () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const publicId = await createGrant();
  memoryStore.update("uploadGrants", publicId, {
    expiresAt: new Date(now.getTime() - 1_000),
  });

  uploadCleanup.setUploadAssetDestroyerForTests(async () => {
    throw new Error("simulated provider outage");
  });
  const failed = await uploadCleanup.runExpiredUploadGrantSweep({
    limit: 1,
    now,
    retryDelayMs: 60_000,
  });
  assert.deepEqual(failed, { claimed: 1, deleted: 0, failed: 1 });

  const retained = memoryStore.get("uploadGrants", publicId);
  assert.ok(retained);
  assert.equal(retained.reservationToken, "");
  assert.equal(retained.cleanupAttempts, 1);
  assert.equal(new Date(retained.cleanupNotBefore).getTime(), now.getTime() + 60_000);

  uploadCleanup.setUploadAssetDestroyerForTests(async () => ({ result: "not found" }));
  const tooEarly = await uploadCleanup.runExpiredUploadGrantSweep({ limit: 1, now });
  assert.deepEqual(tooEarly, { claimed: 0, deleted: 0, failed: 0 });
  assert.ok(memoryStore.get("uploadGrants", publicId));

  const retried = await uploadCleanup.runExpiredUploadGrantSweep({
    limit: 1,
    now: new Date(now.getTime() + 60_001),
  });
  assert.deepEqual(retried, { claimed: 1, deleted: 1, failed: 0 });
  assert.equal(memoryStore.get("uploadGrants", publicId), undefined);
});

test("each expired upload sweep obeys its batch bound", async () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const publicIds = await Promise.all([createGrant(), createGrant(), createGrant()]);
  publicIds.forEach((publicId, index) => {
    memoryStore.update("uploadGrants", publicId, {
      expiresAt: new Date(now.getTime() - (3 - index) * 1_000),
    });
  });

  const destroyed = [];
  uploadCleanup.setUploadAssetDestroyerForTests(async (publicId) => {
    destroyed.push(publicId);
    return { result: "ok" };
  });
  const result = await uploadCleanup.runExpiredUploadGrantSweep({ limit: 2, now });

  assert.deepEqual(result, { claimed: 2, deleted: 2, failed: 0 });
  assert.deepEqual(destroyed, publicIds.slice(0, 2));
  assert.ok(memoryStore.get("uploadGrants", publicIds[2]));
});

test("UploadGrant expiry is non-TTL and legacy Mongo TTL indexes are removed safely", async () => {
  const expiryIndex = UploadGrant.schema
    .indexes()
    .find(([keys]) => Object.keys(keys).length === 1 && keys.expiresAt === 1);
  assert.ok(expiryIndex);
  assert.equal(expiryIndex[1].expireAfterSeconds, undefined);
  assert.equal(
    isLegacyUploadGrantTtlIndex({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    true,
  );
  assert.equal(isLegacyUploadGrantTtlIndex({ key: { expiresAt: 1 } }), false);

  const dropped = [];
  const collection = {
    indexes: async () => [
      { name: "_id_", key: { _id: 1 } },
      { name: "expiresAt_1", key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      { name: "normal_expiry", key: { expiresAt: 1 } },
      { name: "unrelated_ttl", key: { cleanupNotBefore: 1 }, expireAfterSeconds: 0 },
    ],
    dropIndex: async (name) => dropped.push(name),
  };
  const removed = await removeLegacyUploadGrantTtlIndexes(collection);
  assert.deepEqual(removed, ["expiresAt_1"]);
  assert.deepEqual(dropped, ["expiresAt_1"]);
});
