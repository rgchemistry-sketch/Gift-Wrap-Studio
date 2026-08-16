import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-upload-owner-session-secret-long-enough";
process.env.ADMIN_EMAIL = "upload-owner@example.test";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-api-key";
process.env.CLOUDINARY_API_SECRET = "test-cloudinary-secret-long-enough";
process.env.CLOUDINARY_UPLOAD_PRESET = "test-locked-preset";
delete process.env.MONGODB_URI;

const [
  { default: app },
  { memoryStore, resetMemoryStore },
  uploadRoutes,
  store,
  { AppError },
] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../routes/uploads.js"),
  import("../services/store.js"),
  import("../lib/errors.js"),
]);

let destroyedPublicIds;

beforeEach(() => {
  resetMemoryStore();
  store.resetUploadGrantConsumptionHookForTests();
  store.resetUploadGrantReservationConflictHookForTests();
  destroyedPublicIds = [];
  uploadRoutes.resetUploadAssetDestroyerForTests();
  uploadRoutes.setUploadAssetDestroyerForTests(async (publicId) => {
    destroyedPublicIds.push(publicId);
    return { result: "ok" };
  });
});

const login = async (role) => {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/demo").send({ role }).expect(200);
  return { agent, user: response.body.data.user };
};

const baseProduct = (slug) => ({
  name: `Ownership ${slug}`,
  slug,
  category: "Test products",
  shortDescription: "A valid product description for upload ownership testing.",
  price: 1299,
});

const deliveryUrl = (publicId, suffix = ".jpg") =>
  `https://res.cloudinary.com/test-cloud/image/upload/v123/${publicId}${suffix}`;

const requestProductGrant = async (admin) => {
  const response = await admin
    .post("/api/uploads/signature")
    .send({ purpose: "products" })
    .expect(200);
  const { folder, public_id: assetId, fullPublicId } = response.body.data;
  assert.equal(fullPublicId, `${folder}/${assetId}`);
  assert.match(
    fullPublicId,
    /^gift-n-wrap\/products\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/,
  );
  return {
    publicId: fullPublicId,
    url: deliveryUrl(fullPublicId),
    alt: "Reserved product image",
  };
};

const requestOrderGrant = async (buyer) => {
  const response = await buyer
    .post("/api/uploads/signature")
    .send({ purpose: "orders" })
    .expect(200);
  return {
    name: "customization-reference.jpg",
    publicId: response.body.data.fullPublicId,
    url: deliveryUrl(response.body.data.fullPublicId),
  };
};

const orderPayload = (media, slug = "pressed-flower-name-plaque") => ({
  items: [
    {
      slug,
      quantity: 1,
      customization: JSON.stringify({ name: "Mira", colour: "Forest", media }),
    },
  ],
  shippingAddress: {
    recipientName: "Mira Shah",
    phone: "+91 98765 43210",
    line1: "12 Garden Road",
    city: "Jaipur",
    state: "Rajasthan",
    postalCode: "302001",
  },
});

test("upload signatures expose a seven-day cart lifetime and a two-hour admin lifetime", async () => {
  const { agent: admin } = await login("admin");
  const { agent: buyer } = await login("buyer");
  const before = Date.now();

  const productGrant = await admin
    .post("/api/uploads/signature")
    .send({ purpose: "products" })
    .expect(200);
  const orderGrant = await buyer
    .post("/api/uploads/signature")
    .send({ purpose: "orders" })
    .expect(200);

  assert.equal(productGrant.body.data.expiresInSeconds, 2 * 60 * 60);
  assert.equal(orderGrant.body.data.expiresInSeconds, 7 * 24 * 60 * 60);
  assert.ok(Date.parse(productGrant.body.data.expiresAt) >= before + 2 * 60 * 60 * 1_000);
  assert.ok(Date.parse(orderGrant.body.data.expiresAt) >= before + 7 * 24 * 60 * 60 * 1_000);
});

test("new product images reject missing, expired, and other-user grants", async () => {
  const { agent: admin } = await login("admin");
  const { user: buyer } = await login("buyer");

  const missingPublicId = `gift-n-wrap/products/${buyer.id}/${randomUUID()}`;
  await admin
    .post("/api/admin/products")
    .send({
      ...baseProduct("missing-grant"),
      images: [{ url: deliveryUrl(missingPublicId), publicId: missingPublicId }],
    })
    .expect(409);

  const otherPublicId = `gift-n-wrap/products/${buyer.id}/${randomUUID()}`;
  await store.reserveUploadGrant({
    userId: buyer.id,
    purpose: "products",
    publicId: otherPublicId,
  });
  await admin
    .post("/api/admin/products")
    .send({
      ...baseProduct("other-owner-grant"),
      images: [{ url: deliveryUrl(otherPublicId), publicId: otherPublicId }],
    })
    .expect(409);

  const expiredImage = await requestProductGrant(admin);
  memoryStore.update("uploadGrants", expiredImage.publicId, {
    expiresAt: new Date(Date.now() - 1_000),
  });
  await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("expired-grant"), images: [expiredImage] })
    .expect(409);

  const wrongPurpose = await admin
    .post("/api/uploads/signature")
    .send({ purpose: "orders" })
    .expect(200);
  await admin
    .post("/api/admin/products")
    .send({
      ...baseProduct("wrong-purpose-grant"),
      images: [
        {
          url: deliveryUrl(wrongPurpose.body.data.fullPublicId),
          publicId: wrongPurpose.body.data.fullPublicId,
        },
      ],
    })
    .expect(409);
});

test("Cloudinary delivery URL and reserved full public ID must match exactly", async () => {
  const { agent: admin } = await login("admin");
  const image = await requestProductGrant(admin);
  const differentPublicId = `${image.publicId.slice(0, -1)}${image.publicId.endsWith("f") ? "e" : "f"}`;

  const mismatch = await admin
    .post("/api/admin/products")
    .send({
      ...baseProduct("url-public-id-mismatch"),
      images: [{ ...image, url: deliveryUrl(differentPublicId) }],
    })
    .expect(400);
  assert.match(mismatch.body.error.message, /does not match/i);

  await admin
    .post("/api/admin/products")
    .send({
      ...baseProduct("wrong-cloud"),
      images: [
        {
          ...image,
          url: image.url.replace("res.cloudinary.com/test-cloud", "res.cloudinary.com/other-cloud"),
        },
      ],
    })
    .expect(400);

  await admin
    .post("/api/admin/products")
    .send({
      ...baseProduct("extra-cloudinary-folder"),
      images: [{ ...image, url: deliveryUrl(`unreserved-folder/${image.publicId}`) }],
    })
    .expect(400);
});

test("a consumed grant cannot be reused by another product", async () => {
  const { agent: admin } = await login("admin");
  const image = await requestProductGrant(admin);
  await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("first-grant-use"), images: [image] })
    .expect(201);
  const retainedGrant = memoryStore.get("uploadGrants", image.publicId);
  assert.ok(retainedGrant.consumedAt);
  assert.equal(retainedGrant.expiresAt, undefined);

  const reused = await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("second-grant-use"), images: [image] })
    .expect(409);
  assert.match(reused.body.error.message, /unused grant/i);
});

test("updates retain attached public IDs while requiring a grant for every new image", async () => {
  const { agent: admin } = await login("admin");
  const retained = await requestProductGrant(admin);
  const created = await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("retained-image"), images: [retained] })
    .expect(201);

  const kept = await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ images: [{ ...retained, alt: "Updated alternative text" }] })
    .expect(200);
  assert.equal(kept.body.data.images[0].publicId, retained.publicId);
  assert.equal(kept.body.data.images[0].alt, "Updated alternative text");

  const ungrantedPublicId = `gift-n-wrap/products/${created.body.data.id}/${randomUUID()}`;
  await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({
      images: [
        kept.body.data.images[0],
        { url: deliveryUrl(ungrantedPublicId), publicId: ungrantedPublicId },
      ],
    })
    .expect(409);

  const added = await requestProductGrant(admin);
  const updated = await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ images: [kept.body.data.images[0], added] })
    .expect(200);
  assert.equal(updated.body.data.images.length, 2);
});

test("a product write failure releases its grant for a safe retry", async () => {
  const { agent: admin } = await login("admin");
  await admin
    .post("/api/admin/products")
    .send(baseProduct("duplicate-write"))
    .expect(201);
  const image = await requestProductGrant(admin);

  await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("duplicate-write"), images: [image] })
    .expect(409);
  const grantAfterFailure = memoryStore.get("uploadGrants", image.publicId);
  assert.equal(grantAfterFailure.consumedAt, undefined);
  assert.equal(grantAfterFailure.reservationToken, "");

  await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("retry-after-write-failure"), images: [image] })
    .expect(201);
});

test("product create and update roll back exactly when grant consumption fails", async () => {
  const { agent: admin } = await login("admin");
  const createImage = await requestProductGrant(admin);
  store.setUploadGrantConsumptionHookForTests(({ reservationKind }) => {
    if (reservationKind === "product-write") {
      throw new AppError(409, "SIMULATED_FINALIZE_FAILURE", "Simulated grant failure");
    }
  });

  await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("failed-consumption-create"), images: [createImage] })
    .expect(409);
  assert.equal(
    memoryStore.findOne("products", (product) => product.slug === "failed-consumption-create"),
    undefined,
  );
  assert.equal(memoryStore.get("uploadGrants", createImage.publicId).reservationToken, "");
  assert.equal(memoryStore.get("uploadGrants", createImage.publicId).consumedAt, undefined);

  store.resetUploadGrantConsumptionHookForTests();
  const created = await admin
    .post("/api/admin/products")
    .send(baseProduct("failed-consumption-update"))
    .expect(201);
  const beforeUpdate = memoryStore.get("products", created.body.data.id);
  const updateImage = await requestProductGrant(admin);
  store.setUploadGrantConsumptionHookForTests(() => {
    throw new AppError(409, "SIMULATED_FINALIZE_FAILURE", "Simulated grant failure");
  });

  await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ name: "This mutation must roll back", images: [updateImage] })
    .expect(409);
  assert.deepEqual(memoryStore.get("products", created.body.data.id), beforeUpdate);
  assert.equal(memoryStore.get("uploadGrants", updateImage.publicId).reservationToken, "");
  assert.equal(memoryStore.get("uploadGrants", updateImage.publicId).consumedAt, undefined);

  store.resetUploadGrantConsumptionHookForTests();
  const retried = await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ name: "Committed after retry", images: [updateImage] })
    .expect(200);
  assert.equal(retried.body.data.name, "Committed after retry");
});

test("orders reject missing, foreign, wrong-purpose, and expired customization grants", async () => {
  const { agent: buyer, user } = await login("buyer");
  const { agent: otherOwner } = await login("admin");
  const missingPublicId = `gift-n-wrap/orders/${user.id}/${randomUUID()}`;
  await buyer
    .post("/api/orders")
    .send(
      orderPayload({
        name: "missing.jpg",
        publicId: missingPublicId,
        url: deliveryUrl(missingPublicId),
      }),
    )
    .expect(409);

  const foreign = await requestOrderGrant(otherOwner);
  await buyer.post("/api/orders").send(orderPayload(foreign)).expect(409);

  const wrongPurposePublicId = `gift-n-wrap/orders/${user.id}/${randomUUID()}`;
  await store.reserveUploadGrant({
    userId: user.id,
    purpose: "products",
    publicId: wrongPurposePublicId,
  });
  await buyer
    .post("/api/orders")
    .send(
      orderPayload({
        name: "wrong-purpose.jpg",
        publicId: wrongPurposePublicId,
        url: deliveryUrl(wrongPurposePublicId),
      }),
    )
    .expect(409);

  const expired = await requestOrderGrant(buyer);
  memoryStore.update("uploadGrants", expired.publicId, {
    expiresAt: new Date(Date.now() - 1_000),
  });
  await buyer.post("/api/orders").send(orderPayload(expired)).expect(409);
  assert.equal(memoryStore.count("orders"), 0);
});

test("orders reject mismatched customization URLs without consuming the grant", async () => {
  const { agent: buyer } = await login("buyer");
  const image = await requestOrderGrant(buyer);
  const differentPublicId = `${image.publicId.slice(0, -1)}${image.publicId.endsWith("f") ? "e" : "f"}`;
  const mismatch = await buyer
    .post("/api/orders")
    .send(orderPayload({ ...image, url: deliveryUrl(differentPublicId) }))
    .expect(400);
  assert.match(mismatch.body.error.message, /does not match/i);
  const grant = memoryStore.get("uploadGrants", image.publicId);
  assert.equal(grant.consumedAt, undefined);
  assert.equal(grant.reservationToken, "");
});

test("saved order customization grants are consumed once, replay safely, and resist cleanup", async () => {
  const { agent: buyer } = await login("buyer");
  const image = await requestOrderGrant(buyer);
  const payload = orderPayload(image);
  const created = await buyer
    .post("/api/orders")
    .set("Idempotency-Key", "customization-image-order-0001")
    .send(payload)
    .expect(201);
  assert.equal(created.body.data.items[0].customization, payload.items[0].customization);

  const replay = await buyer
    .post("/api/orders")
    .set("Idempotency-Key", "customization-image-order-0001")
    .send(payload)
    .expect(200);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  assert.equal(replay.body.data.id, created.body.data.id);

  const grant = memoryStore.get("uploadGrants", image.publicId);
  assert.ok(grant.consumedAt);
  assert.equal(grant.orderId, created.body.data.id);
  assert.equal(grant.expiresAt, undefined);
  await buyer.delete("/api/uploads/asset").send({ publicId: image.publicId }).expect(409);
  assert.deepEqual(destroyedPublicIds, []);
  await buyer.post("/api/orders").send(payload).expect(409);
  assert.equal(memoryStore.count("orders"), 1);
});

test("concurrent idempotent order requests replay after a media grant reservation conflict", async () => {
  const { agent: buyer } = await login("buyer");
  const image = await requestOrderGrant(buyer);
  const payload = orderPayload(image);
  let releaseFinalization;
  let notifyFinalizationStarted;
  let notifyReservationConflict;
  const finalizationStarted = new Promise((resolve) => {
    notifyFinalizationStarted = resolve;
  });
  const reservationConflict = new Promise((resolve) => {
    notifyReservationConflict = resolve;
  });
  const allowFinalization = new Promise((resolve) => {
    releaseFinalization = resolve;
  });

  store.setUploadGrantConsumptionHookForTests(async ({ reservationKind }) => {
    if (reservationKind !== "order-write") return;
    notifyFinalizationStarted();
    await allowFinalization;
  });
  store.setUploadGrantReservationConflictHookForTests(({ reservationKind }) => {
    if (reservationKind === "order-write") notifyReservationConflict();
  });

  const idempotencyKey = "concurrent-customization-order-0001";
  const firstPromise = buyer
    .post("/api/orders")
    .set("Idempotency-Key", idempotencyKey)
    .send(payload)
    .then((response) => response);
  await finalizationStarted;
  const secondPromise = buyer
    .post("/api/orders")
    .set("Idempotency-Key", idempotencyKey)
    .send(payload)
    .then((response) => response);
  await reservationConflict;
  releaseFinalization();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.headers["idempotency-replayed"], "true");
  assert.equal(second.body.data.id, first.body.data.id);
  assert.equal(memoryStore.count("orders"), 1);
  assert.equal(memoryStore.get("uploadGrants", image.publicId).orderId, first.body.data.id);
});

test("order and inventory writes roll back when customization grant consumption fails", async () => {
  const { agent: buyer } = await login("buyer");
  const image = await requestOrderGrant(buyer);
  const payload = orderPayload(image, "malachite-serving-tray");
  await request(app).get("/api/products/malachite-serving-tray").expect(200);
  const productBefore = memoryStore.findOne(
    "products",
    (product) => product.slug === "malachite-serving-tray",
  );
  store.setUploadGrantConsumptionHookForTests(({ reservationKind }) => {
    if (reservationKind === "order-write") {
      throw new AppError(409, "SIMULATED_FINALIZE_FAILURE", "Simulated grant failure");
    }
  });

  await buyer.post("/api/orders").send(payload).expect(409);
  assert.equal(memoryStore.count("orders"), 0);
  assert.deepEqual(
    memoryStore.findOne("products", (product) => product.slug === "malachite-serving-tray"),
    productBefore,
  );
  const grantAfterFailure = memoryStore.get("uploadGrants", image.publicId);
  assert.equal(grantAfterFailure.consumedAt, undefined);
  assert.equal(grantAfterFailure.reservationToken, "");

  store.resetUploadGrantConsumptionHookForTests();
  await buyer.post("/api/orders").send(payload).expect(201);
  assert.equal(
    memoryStore.findOne("products", (product) => product.slug === "malachite-serving-tray")
      .inventory,
    productBefore.inventory - 1,
  );
});

test("only an unconsumed grant owner can destroy and remove an uploaded asset", async () => {
  const { agent: admin } = await login("admin");
  const { agent: buyer } = await login("buyer");
  const image = await requestProductGrant(admin);

  await request(app)
    .delete("/api/uploads/asset")
    .send({ publicId: image.publicId })
    .expect(401);
  await buyer
    .delete("/api/uploads/asset")
    .send({ publicId: image.publicId })
    .expect(403);
  assert.deepEqual(destroyedPublicIds, []);

  const removed = await admin
    .delete("/api/uploads/asset")
    .send({ publicId: image.publicId })
    .expect(200);
  assert.equal(removed.body.data.success, true);
  assert.deepEqual(destroyedPublicIds, [image.publicId]);
  assert.equal(memoryStore.get("uploadGrants", image.publicId), undefined);
  await admin
    .delete("/api/uploads/asset")
    .send({ publicId: image.publicId })
    .expect(404);
  assert.deepEqual(destroyedPublicIds, [image.publicId]);
});

test("logout removes every unconsumed user upload while preserving saved order assets", async () => {
  const { agent: buyer } = await login("buyer");
  const savedMedia = await requestOrderGrant(buyer);
  await buyer.post("/api/orders").send(orderPayload(savedMedia)).expect(201);

  const abandonedOrderMedia = await requestOrderGrant(buyer);
  const abandonedInquiry = await buyer
    .post("/api/uploads/signature")
    .send({ purpose: "custom-inquiries" })
    .expect(200);
  const abandonedInquiryPublicId = abandonedInquiry.body.data.fullPublicId;

  const logout = await buyer.post("/api/auth/logout").expect(200);
  assert.equal(logout.body.data.success, true);
  assert.equal(logout.body.data.sessionsRevoked, true);
  assert.deepEqual(logout.body.data.uploadCleanup, {
    attempted: 2,
    removed: 2,
    failed: 0,
  });
  assert.deepEqual(
    new Set(destroyedPublicIds),
    new Set([abandonedOrderMedia.publicId, abandonedInquiryPublicId]),
  );
  assert.equal(destroyedPublicIds.includes(savedMedia.publicId), false);
  assert.equal(memoryStore.get("uploadGrants", abandonedOrderMedia.publicId), undefined);
  assert.equal(memoryStore.get("uploadGrants", abandonedInquiryPublicId), undefined);
  assert.ok(memoryStore.get("uploadGrants", savedMedia.publicId).consumedAt);
  await buyer.get("/api/auth/me").expect(401);
});

test("logout preserves consumed product assets while cleaning abandoned admin uploads", async () => {
  const { agent: admin } = await login("admin");
  const savedImage = await requestProductGrant(admin);
  await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("logout-retained-product"), images: [savedImage] })
    .expect(201);
  const abandonedImage = await requestProductGrant(admin);

  const logout = await admin.post("/api/auth/logout").expect(200);
  assert.deepEqual(logout.body.data.uploadCleanup, {
    attempted: 1,
    removed: 1,
    failed: 0,
  });
  assert.deepEqual(destroyedPublicIds, [abandonedImage.publicId]);
  assert.ok(memoryStore.get("uploadGrants", savedImage.publicId).consumedAt);
  assert.equal(memoryStore.get("uploadGrants", abandonedImage.publicId), undefined);
});

test("upload provider failures never prevent logout or leave cleanup claims locked", async () => {
  const { agent: buyer } = await login("buyer");
  const abandonedMedia = await requestOrderGrant(buyer);
  uploadRoutes.setUploadAssetDestroyerForTests(async () => {
    throw new Error("simulated logout cleanup outage");
  });

  const logout = await buyer.post("/api/auth/logout").expect(200);
  assert.equal(logout.body.data.success, true);
  assert.equal(logout.body.data.sessionsRevoked, true);
  assert.deepEqual(logout.body.data.uploadCleanup, {
    attempted: 1,
    removed: 0,
    failed: 1,
  });
  const retainedGrant = memoryStore.get("uploadGrants", abandonedMedia.publicId);
  assert.ok(retainedGrant);
  assert.equal(retainedGrant.consumedAt, undefined);
  assert.equal(retainedGrant.reservationToken, "");
  await buyer.get("/api/auth/me").expect(401);
});

test("an admin can retire only removed consumed product images while provenance is retained", async () => {
  const { agent: admin, user: adminUser } = await login("admin");
  const { agent: buyer } = await login("buyer");
  const removedImage = await requestProductGrant(admin);
  const retainedImage = await requestProductGrant(admin);
  const created = await admin
    .post("/api/admin/products")
    .send({
      ...baseProduct("retire-removed-image"),
      images: [removedImage, retainedImage],
    })
    .expect(201);

  await admin
    .delete("/api/uploads/asset")
    .send({ publicId: removedImage.publicId })
    .expect(409);
  assert.deepEqual(destroyedPublicIds, []);

  await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ images: [retainedImage] })
    .expect(200);
  await buyer
    .delete("/api/uploads/asset")
    .send({ publicId: removedImage.publicId })
    .expect(403);
  await admin
    .delete("/api/uploads/asset")
    .send({ publicId: retainedImage.publicId })
    .expect(409);

  uploadRoutes.setUploadAssetDestroyerForTests(async () => {
    throw new Error("simulated provider outage for a retired product image");
  });
  await admin
    .delete("/api/uploads/asset")
    .send({ publicId: removedImage.publicId })
    .expect(502);
  assert.equal(memoryStore.get("uploadGrants", removedImage.publicId).reservationToken, "");
  uploadRoutes.setUploadAssetDestroyerForTests(async (publicId) => {
    destroyedPublicIds.push(publicId);
    return { result: "ok" };
  });

  const removed = await admin
    .delete("/api/uploads/asset")
    .send({ publicId: removedImage.publicId })
    .expect(200);
  assert.equal(removed.body.data.provenanceRetained, true);
  assert.deepEqual(destroyedPublicIds, [removedImage.publicId]);

  const provenance = memoryStore.get("uploadGrants", removedImage.publicId);
  assert.ok(provenance.consumedAt);
  assert.ok(provenance.deletedAt);
  assert.equal(provenance.deletedByUserId, adminUser.id);
  assert.equal(provenance.productId, created.body.data.id);
  assert.equal(provenance.expiresAt, undefined);
  assert.ok(memoryStore.get("uploadGrants", retainedImage.publicId).consumedAt);
});

test("cleanup refuses consumed grants and releases a claim when Cloudinary fails", async () => {
  const { agent: admin } = await login("admin");
  const consumed = await requestProductGrant(admin);
  await admin
    .post("/api/admin/products")
    .send({ ...baseProduct("cleanup-consumed"), images: [consumed] })
    .expect(201);
  await admin
    .delete("/api/uploads/asset")
    .send({ publicId: consumed.publicId })
    .expect(409);
  assert.deepEqual(destroyedPublicIds, []);

  const retryable = await requestProductGrant(admin);
  uploadRoutes.setUploadAssetDestroyerForTests(async () => {
    throw new Error("simulated provider outage");
  });
  await admin
    .delete("/api/uploads/asset")
    .send({ publicId: retryable.publicId })
    .expect(502);
  assert.equal(memoryStore.get("uploadGrants", retryable.publicId).reservationToken, "");

  uploadRoutes.setUploadAssetDestroyerForTests(async (publicId) => {
    destroyedPublicIds.push(publicId);
    return { result: "not found" };
  });
  await admin
    .delete("/api/uploads/asset")
    .send({ publicId: retryable.publicId })
    .expect(200);
});
