import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-only-session-secret-that-is-long-enough";
process.env.ADMIN_EMAIL = "owner@example.test";
delete process.env.MONGODB_URI;

// Import the same module Vercel executes, rather than importing the admin router or
// server/app.js directly. This catches missing exports and deployment-entry wiring.
const [{ default: vercelApi }, { memoryStore, resetMemoryStore }] = await Promise.all([
  import("../../api/index.js"),
  import("../lib/memory-store.js"),
]);

const parseBinary = (incoming, callback) => {
  const chunks = [];
  incoming.on("data", (chunk) => chunks.push(chunk));
  incoming.on("end", () => callback(null, Buffer.concat(chunks)));
};

test("Vercel rewrites every API subpath to the Express function before the SPA fallback", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(config.rewrites.slice(0, 2), [
    { source: "/api/(.*)", destination: "/api" },
    { source: "/(.*)", destination: "/index.html" },
  ]);
  assert.ok(
    config.crons.some(({ path, schedule }) =>
      path === "/api/maintenance/payments/reconcile" && schedule === "47 2 * * *"),
    "the production deployment must schedule payment reconciliation",
  );

  const contentSecurityPolicy = config.headers
    .flatMap(({ headers = [] }) => headers)
    .find(({ key }) => key.toLowerCase() === "content-security-policy")?.value || "";
  assert.match(contentSecurityPolicy, /script-src[^;]*https:\/\/checkout\.razorpay\.com/);
  assert.match(contentSecurityPolicy, /frame-src[^;]*https:\/\/api\.razorpay\.com/);
  assert.match(contentSecurityPolicy, /connect-src[^;]*https:\/\/api\.razorpay\.com/);
});

test("the Vercel API entry exposes order detail, sales analysis and Excel export", async () => {
  resetMemoryStore();
  const apiRoot = await request(vercelApi).get("/api").expect(200);
  assert.match(
    apiRoot.headers["content-security-policy"],
    /script-src[^;]*https:\/\/checkout\.razorpay\.com/,
  );
  assert.match(
    apiRoot.headers["content-security-policy"],
    /frame-src[^;]*https:\/\/api\.razorpay\.com/,
  );
  const order = memoryStore.create(
    "orders",
    {
      orderNumber: "GNW-RUNTIME-SMOKE",
      buyerId: "runtime-customer",
      buyerName: "Runtime Customer",
      buyerEmail: "runtime@example.test",
      createdAt: "2024-01-10T06:30:00.000Z",
      updatedAt: "2024-01-10T06:30:00.000Z",
      status: "placed",
      paymentStatus: "pending",
      subtotal: 1_250,
      shippingFee: 0,
      discount: 0,
      total: 1_250,
      shippingAddress: {
        recipientName: "Runtime Customer",
        phone: "+919876543210",
        line1: "12 Studio Road",
        city: "Jaipur",
        state: "Rajasthan",
        postalCode: "302001",
        country: "India",
      },
      items: [
        {
          productId: "runtime-product",
          slug: "runtime-product",
          name: "Runtime product",
          unitPrice: 1_250,
          quantity: 1,
          customization: { name: "Aarav", finish: "Gold" },
        },
      ],
    },
    "runtime-order",
  );

  const query = { range: "day", from: "2024-01-10", to: "2024-01-10" };

  await request(vercelApi).get(`/api/admin/orders/${order.id}`).expect(401);
  await request(vercelApi).get("/api/admin/analytics").query(query).expect(401);
  await request(vercelApi).get("/api/admin/analytics/export.xlsx").query(query).expect(401);

  const admin = request.agent(vercelApi);
  await admin.post("/api/auth/demo").send({ role: "admin" }).expect(200);

  const detail = await admin
    .get(`/api/admin/orders/${order.id}`)
    .expect(200)
    .expect("Cache-Control", /no-store/);
  assert.equal(detail.body.data.orderNumber, "GNW-RUNTIME-SMOKE");
  assert.equal(detail.body.data.shippingAddress.phone, "+919876543210");
  assert.equal(detail.body.data.items[0].customization.name, "Aarav");

  const analytics = await admin
    .get("/api/admin/analytics")
    .query(query)
    .expect(200)
    .expect("Cache-Control", /no-store/);
  assert.equal(analytics.body.data.kpis.bookedSales, 1_250);
  assert.equal(analytics.body.data.products[0].productId, "runtime-product");

  const workbook = await admin
    .get("/api/admin/analytics/export.xlsx")
    .query(query)
    .buffer(true)
    .parse(parseBinary)
    .expect(200)
    .expect("Cache-Control", /no-store/)
    .expect(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  assert.match(
    workbook.headers["content-disposition"],
    /attachment; filename="gift-n-wrap-sales-2024-01-10-to-2024-01-10\.xlsx"/,
  );
  assert.equal(Buffer.isBuffer(workbook.body), true);
  assert.equal(workbook.body.subarray(0, 2).toString(), "PK");
});
