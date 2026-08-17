import assert from "node:assert/strict";
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
delete process.env.MONGODB_URI;

const [{ default: app }, { resetMemoryStore }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
]);

beforeEach(() => resetMemoryStore());

const adminAgent = async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/demo").send({ role: "admin" }).expect(200);
  return agent;
};

test("the catalogue default page is large enough to serve the whole storefront", async () => {
  // The storefront filters and sorts in the browser. A small default silently hid every
  // product past the first page from search, filters and the shop grid.
  const list = await request(app).get("/api/products").expect(200);
  assert.equal(list.body.meta.limit, 50);
  assert.equal(list.body.meta.totalPages, 1);
  assert.equal(list.body.data.length, list.body.meta.total);
});

test("products carry an occasion and /products filters on it", async () => {
  const all = await request(app).get("/api/products").expect(200);
  assert.ok(
    all.body.data.every((product) => typeof product.occasion === "string"),
    "every catalogue product exposes an occasion field",
  );

  const weddings = await request(app).get("/api/products?occasion=Wedding").expect(200);
  assert.ok(weddings.body.data.length > 0, "the Wedding occasion link returns real pieces");
  assert.ok(weddings.body.data.every((product) => product.occasion === "Wedding"));
  assert.equal(weddings.body.meta.total, weddings.body.data.length);

  const unmatched = await request(app).get("/api/products?occasion=NotAnOccasion").expect(200);
  assert.equal(unmatched.body.data.length, 0);
});

test("an unknown occasion filter never falls back to the whole catalogue", async () => {
  const all = await request(app).get("/api/products").expect(200);
  const filtered = await request(app).get("/api/products?occasion=Memorial").expect(200);
  assert.ok(filtered.body.meta.total < all.body.meta.total);
});

test("an administrator can set and clear a product occasion", async () => {
  const admin = await adminAgent();
  const created = await admin
    .post("/api/admin/products")
    .send({
      name: "Anniversary Wave Frame",
      slug: "anniversary-wave-frame",
      category: "Personalized gifts",
      occasion: "Anniversary",
      shortDescription: "A layered resin frame finished for anniversaries.",
      price: 2_400,
      images: [{ url: "/assets/personalized-plaque.webp" }],
    })
    .expect(201);
  assert.equal(created.body.data.occasion, "Anniversary");

  const listed = await request(app).get("/api/products?occasion=Anniversary").expect(200);
  assert.ok(listed.body.data.some((product) => product.slug === "anniversary-wave-frame"));

  const cleared = await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ occasion: "" })
    .expect(200);
  assert.equal(cleared.body.data.occasion, "");

  const afterClear = await request(app).get("/api/products?occasion=Anniversary").expect(200);
  assert.ok(!afterClear.body.data.some((product) => product.slug === "anniversary-wave-frame"));
});
