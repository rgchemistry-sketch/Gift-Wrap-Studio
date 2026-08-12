import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-only-session-secret-that-is-long-enough";
process.env.ADMIN_EMAIL = "owner@example.test";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-api-key";
process.env.CLOUDINARY_API_SECRET = process.env.JWT_SECRET;
process.env.CLOUDINARY_UPLOAD_PRESET = "test-locked-preset";
process.env.UPLOAD_SIGNATURES_PER_HOUR = "20";
delete process.env.MONGODB_URI;

const [{ default: app }, { resetMemoryStore }, { createWebApp }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../web-app.js"),
]);

beforeEach(() => resetMemoryStore());

test("the single-process web app serves the SPA without swallowing API 404s", async (context) => {
  const clientDirectory = await mkdtemp(path.join(tmpdir(), "gift-n-wrap-client-"));
  context.after(() => rm(clientDirectory, { recursive: true, force: true }));
  await mkdir(path.join(clientDirectory, "assets"));
  await writeFile(
    path.join(clientDirectory, "index.html"),
    '<!doctype html><html><body><div id="root">Gift N Wrap</div></body></html>',
  );
  await writeFile(path.join(clientDirectory, "assets", "app.js"), "export default true;");

  const webApp = createWebApp({ apiApp: app, clientDirectory });
  const root = await request(webApp).get("/").expect(200).expect("Content-Type", /html/);
  assert.match(root.text, /Gift N Wrap/);

  const clientRoute = await request(webApp)
    .get("/shop")
    .expect(200)
    .expect("Cache-Control", "no-cache");
  assert.equal(clientRoute.text, root.text);

  await request(webApp)
    .get("/assets/app.js")
    .expect(200)
    .expect("Cache-Control", /max-age=31536000, immutable/);

  const missingApiRoute = await request(webApp).get("/api/does-not-exist").expect(404);
  assert.equal(missingApiRoute.body.error.code, "ROUTE_NOT_FOUND");
  assert.ok(missingApiRoute.body.error.requestId);
});

test("health reports the non-durable demo fallback without Atlas", async () => {
  const response = await request(app).get("/api/health").expect(200);
  assert.equal(response.body.data.status, "ok");
  assert.equal(response.body.data.persistence.mode, "memory");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("catalog seeds demo products and supports detail lookup", async () => {
  const list = await request(app).get("/api/products?featured=true&limit=2").expect(200);
  assert.equal(list.body.data.length, 2);
  assert.ok(list.body.meta.total >= 4);
  assert.ok(list.body.data.every((product) => product.featured));

  const detail = await request(app)
    .get(`/api/products/${list.body.data[0].slug}`)
    .expect(200);
  assert.equal(detail.body.data.id, list.body.data[0].id);
});

test("validation errors use the stable API error envelope", async () => {
  const response = await request(app)
    .post("/api/contact")
    .send({ name: "A", email: "not-an-email", subject: "Hi", message: "short" })
    .expect(422);

  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(response.body.error.details));
  assert.ok(response.body.error.requestId);
});

test("the storefront inquiry payload is normalized and accepted", async () => {
  const response = await request(app)
    .post("/api/custom-inquiries")
    .send({
      name: "Aarav Sharma",
      email: "aarav@example.com",
      phone: "+91 98765 43210",
      productType: "Wedding keepsake",
      occasion: "Wedding",
      description: "Preserve flowers from our wedding garland in a ring tray.",
      personalization: "Add our initials and wedding date.",
      palette: "Ivory and gold",
      contactPreference: "WhatsApp",
      referenceUrl: "https://example.com/reference.jpg",
    })
    .expect(201);

  assert.equal(response.body.data.status, "new");
  assert.ok(response.body.data.id);
});

test("demo buyer auth, server-priced first order, and one-time offer work together", async () => {
  const buyer = request.agent(app);
  const login = await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  assert.equal(login.body.data.user.role, "buyer");
  assert.match(login.headers["set-cookie"][0], /HttpOnly/i);

  const orderPayload = {
    items: [{ slug: "pressed-flower-name-plaque", quantity: 1, customization: "Name: Mira" }],
    shippingAddress: {
      recipientName: "Mira Shah",
      phone: "+91 98765 43210",
      line1: "12 Garden Road",
      city: "Jaipur",
      state: "Rajasthan",
      postalCode: "302001",
    },
    couponCode: "FIRST10",
    paymentMethod: "manual_confirmation",
  };

  const idempotencyKey = "test-first-order-0001";
  const created = await buyer
    .post("/api/orders")
    .set("Idempotency-Key", idempotencyKey)
    .send(orderPayload)
    .expect(201);
  assert.equal(created.body.data.subtotal, 1899);
  assert.equal(created.body.data.shippingFee, 99);
  assert.equal(created.body.data.discount, 190);
  assert.equal(created.body.data.total, 1808);
  assert.equal(created.body.data.status, "placed");
  assert.equal(created.body.data.paymentMethod, "manual_confirmation");

  const replay = await buyer
    .post("/api/orders")
    .set("Idempotency-Key", idempotencyKey)
    .send(orderPayload)
    .expect(200);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  assert.equal(replay.body.data.id, created.body.data.id);
  assert.equal("idempotencyHash" in replay.body.data, false);
  await buyer
    .post("/api/orders")
    .set("Idempotency-Key", idempotencyKey)
    .send({ ...orderPayload, note: "A different order attempt" })
    .expect(409);

  const mine = await buyer.get("/api/orders/my").expect(200);
  assert.equal(mine.body.meta.total, 1);
  assert.equal(mine.body.data[0].id, created.body.data.id);

  const repeated = await buyer.post("/api/orders").send(orderPayload).expect(409);
  assert.equal(repeated.body.error.code, "CONFLICT");
});

test("only the configured admin identity can access admin APIs", async () => {
  const buyer = request.agent(app);
  await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  await buyer.get("/api/admin/dashboard").expect(403);

  const admin = request.agent(app);
  const login = await admin.post("/api/auth/demo").send({ role: "admin" }).expect(200);
  assert.equal(login.body.data.user.email, "owner@example.test");
  assert.equal(login.body.data.user.role, "admin");

  const dashboard = await admin.get("/api/admin/dashboard").expect(200);
  assert.equal(dashboard.body.data.products, 10);

  const products = await admin.get("/api/admin/products").expect(200);
  const original = products.body.data[0];
  const changed = await admin
    .patch(`/api/admin/products/${original.id}`)
    .send({ name: `${original.name} Updated` })
    .expect(200);
  assert.equal(changed.body.data.name, `${original.name} Updated`);
  assert.deepEqual(changed.body.data.images, original.images);
  assert.deepEqual(changed.body.data.customizationOptions, original.customizationOptions);
  assert.equal(changed.body.data.featured, original.featured);

  await admin.patch(`/api/admin/products/${original.id}`).send({}).expect(422);
});

test("FIRST10 cannot be applied to corporate or split bulk quantities", async () => {
  const buyer = request.agent(app);
  await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  const address = {
    recipientName: "Dev Mehta",
    phone: "+91 98765 43210",
    line1: "40 Market Road",
    city: "Pune",
    state: "Maharashtra",
    postalCode: "411001",
  };

  const corporate = await buyer
    .post("/api/orders")
    .send({
      items: [{ slug: "golden-hour-desk-plaque", quantity: 1 }],
      shippingAddress: address,
      couponCode: "FIRST10",
    })
    .expect(400);
  assert.equal(corporate.body.error.code, "BAD_REQUEST");

  const splitBulk = await buyer
    .post("/api/orders")
    .send({
      items: [
        { slug: "pressed-flower-name-plaque", quantity: 5, customization: "Set A" },
        { slug: "pressed-flower-name-plaque", quantity: 5, customization: "Set B" },
      ],
      shippingAddress: address,
      couponCode: "FIRST10",
    })
    .expect(400);
  assert.equal(splitBulk.body.error.code, "BAD_REQUEST");
});

test("finite inventory is reserved once across idempotent order retries", async () => {
  const buyer = request.agent(app);
  await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  const payload = {
    items: [{ slug: "malachite-serving-tray", quantity: 2 }],
    shippingAddress: {
      recipientName: "Riya Jain",
      phone: "9876543210",
      line1: "18 Lake View Road",
      city: "Udaipur",
      state: "Rajasthan",
      postalCode: "313001",
    },
  };

  const placed = await buyer
    .post("/api/orders")
    .set("Idempotency-Key", "inventory-check-0001")
    .send(payload)
    .expect(201);
  await buyer
    .post("/api/orders")
    .set("Idempotency-Key", "inventory-check-0001")
    .send(payload)
    .expect(200);

  const product = await request(app).get("/api/products/malachite-serving-tray").expect(200);
  assert.equal(product.body.data.inventory, 6);

  const admin = request.agent(app);
  await admin.post("/api/auth/demo").send({ role: "admin" }).expect(200);
  await admin
    .patch(`/api/admin/orders/${placed.body.data.id}/status`)
    .send({ status: "cancelled", note: "Customer changed their mind" })
    .expect(200);
  const restored = await request(app).get("/api/products/malachite-serving-tray").expect(200);
  assert.equal(restored.body.data.inventory, 8);
  await admin
    .patch(`/api/admin/orders/${placed.body.data.id}/status`)
    .send({ status: "confirmed" })
    .expect(409);
});

test("expired optional auth is cleared and public routes remain usable", async () => {
  const offer = await request(app)
    .get("/api/offers/welcome")
    .set("Cookie", "gnw_session=not-a-valid-token")
    .expect(200);
  assert.equal(offer.body.data.code, "FIRST10");
  assert.match(offer.headers["set-cookie"][0], /gnw_session=;/);
});

test("buyer inquiry history never exposes the administrator note", async () => {
  const buyer = request.agent(app);
  await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  const created = await buyer
    .post("/api/custom-inquiries")
    .send({
      name: "Anaya Gupta",
      email: "anaya@example.com",
      phone: "9876543210",
      description: "I would like a custom anniversary photo keepsake.",
    })
    .expect(201);

  const admin = request.agent(app);
  await admin.post("/api/auth/demo").send({ role: "admin" }).expect(200);
  await admin
    .patch(`/api/admin/custom-inquiries/${created.body.data.id}`)
    .send({ status: "contacted", adminNote: "Internal pricing discussion" })
    .expect(200);
  await admin
    .patch(`/api/admin/custom-inquiries/${created.body.data.id}`)
    .send({ status: "quoted" })
    .expect(200);
  const adminInbox = await admin.get("/api/admin/custom-inquiries").expect(200);
  assert.equal(adminInbox.body.data[0].adminNote, "Internal pricing discussion");

  const mine = await buyer.get("/api/custom-inquiries/mine").expect(200);
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.data[0].status, "quoted");
  assert.equal("adminNote" in mine.body.data[0], false);
});

test("strict India contact, PIN, numeric, and URL validation rejects ambiguous input", async () => {
  await request(app)
    .post("/api/contact")
    .send({
      name: "Test User",
      email: "test@example.com",
      phone: "1------2",
      subject: "A valid subject",
      message: "This message is long enough to otherwise pass validation.",
    })
    .expect(422);

  await request(app)
    .post("/api/custom-inquiries")
    .send({
      name: "Test User",
      email: "test@example.com",
      phone: "9876543210",
      description: "A sufficiently detailed custom resin gift request.",
      referenceUrl: "javascript:alert(1)",
    })
    .expect(422);

  const admin = request.agent(app);
  await admin.post("/api/auth/demo").send({ role: "admin" }).expect(200);
  await admin
    .post("/api/admin/products")
    .send({
      slug: "boolean-price",
      name: "Boolean Price",
      category: "Test products",
      shortDescription: "This valid description must not make a boolean price valid.",
      price: true,
    })
    .expect(422);
});

test("Cloudinary signatures are constrained to a single non-overwritable public ID", async () => {
  const buyer = request.agent(app);
  await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  const response = await buyer
    .post("/api/uploads/signature")
    .send({ purpose: "custom-inquiries" })
    .expect(200);
  assert.match(response.body.data.public_id, /^[0-9a-f-]{36}$/);
  assert.equal(response.body.data.overwrite, false);
  assert.equal(response.body.data.upload_preset, "test-locked-preset");
  assert.equal(response.body.data.allowed_formats, "jpg,jpeg,png,webp");
  assert.equal(response.body.data.transformation, "c_limit,w_2400,h_2400");
  assert.equal(JSON.stringify(response.body).includes("apiSecret"), false);
  assert.equal(JSON.stringify(response.body).includes(process.env.CLOUDINARY_API_SECRET), false);
});

test("the shared upload grant bucket enforces the per-buyer hourly quota", async () => {
  const buyer = request.agent(app);
  await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  for (let index = 0; index < 20; index += 1) {
    await buyer.post("/api/uploads/signature").send({ purpose: "orders" }).expect(200);
  }
  const limited = await buyer
    .post("/api/uploads/signature")
    .send({ purpose: "orders" })
    .expect(429);
  assert.equal(limited.body.error.code, "RATE_LIMITED");
});
