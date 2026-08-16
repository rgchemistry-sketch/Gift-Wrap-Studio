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

const [{ default: app }, { memoryStore, resetMemoryStore }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
]);

beforeEach(() => resetMemoryStore());

const adminAgent = async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/demo").send({ role: "admin" }).expect(200);
  return agent;
};

const buyerAgent = async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/demo").send({ role: "buyer" }).expect(200);
  return agent;
};

const productImageGrant = async (admin, alt = "Product image") => {
  const signature = await admin
    .post("/api/uploads/signature")
    .send({ purpose: "products" })
    .expect(200);
  const publicId = signature.body.data.fullPublicId;
  return {
    url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${publicId}.jpg`,
    publicId,
    alt,
  };
};

test("admins can create, edit, publish and archive complete products", async () => {
  const admin = await adminAgent();
  const productImage = await productImageGrant(admin, "Forest keepsake box");
  const created = await admin
    .post("/api/admin/products")
    .send({
      name: "Forest Keepsake Box",
      slug: "forest-keepsake-box",
      category: "Personalized gifts",
      shortDescription: "A handcrafted resin keepsake box with botanical details.",
      description: "Created to preserve small memories, jewellery, and handwritten notes.",
      sku: "GNW-BOX-01",
      price: 1799,
      compareAtPrice: 1999,
      inventory: 4,
      images: [productImage],
      variants: [
        { name: "Large", sku: "GNW-BOX-01-L", price: 2299, inventory: 2, active: true },
      ],
      active: false,
    })
    .expect(201);

  assert.equal(created.body.data.sku, "GNW-BOX-01");
  assert.equal(created.body.data.variants[0].price, 2299);
  assert.equal(created.body.data.active, false);

  const emptyGalleryUpdate = await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ images: [] })
    .expect(422);
  assert.equal(
    emptyGalleryUpdate.body.error.details.some((issue) => issue.field === "images"),
    true,
  );

  const publicDraft = await request(app).get("/api/products/forest-keepsake-box").expect(404);
  assert.equal(publicDraft.body.error.code, "NOT_FOUND");

  const updated = await admin
    .patch(`/api/admin/products/${created.body.data.id}`)
    .send({ active: true, featured: true, price: 1899, compareAtPrice: 2199 })
    .expect(200);
  assert.equal(updated.body.data.active, true);
  assert.equal(updated.body.data.featured, true);

  await request(app).get("/api/products/forest-keepsake-box").expect(200);
  const archived = await admin.delete(`/api/admin/products/${created.body.data.id}`).expect(200);
  assert.ok(archived.body.data.archivedAt);
  await request(app).get("/api/products/forest-keepsake-box").expect(404);
});

test("product management validates pricing, SKUs and image ownership", async () => {
  const admin = await adminAgent();
  const base = {
    name: "Validation Piece",
    slug: "validation-piece",
    category: "Home decor",
    shortDescription: "A sufficiently descriptive product catalogue summary.",
    price: 1000,
  };

  const emptyGalleryCreate = await admin
    .post("/api/admin/products")
    .send({ ...base, images: [] })
    .expect(422);
  assert.equal(
    emptyGalleryCreate.body.error.details.some((issue) => issue.field === "images"),
    true,
  );

  await admin
    .post("/api/admin/products")
    .send({ ...base, compareAtPrice: 900 })
    .expect(422);
  await admin
    .post("/api/admin/products")
    .send({
      ...base,
      sku: "SAME-SKU",
      variants: [{ name: "Large", sku: "SAME-SKU", price: 1200, inventory: 1 }],
    })
    .expect(422);
  await admin
    .post("/api/admin/products")
    .send({
      ...base,
      images: [
        {
          url: "https://example.com/not-cloudinary.jpg",
          publicId: "gift-n-wrap/products/fake",
        },
      ],
    })
    .expect(422);
});

test("saved studio settings drive the public popup and checkout totals", async () => {
  const admin = await adminAgent();
  const saved = await admin
    .put("/api/admin/settings")
    .send({
      leadTimes: { ready: "2–4 business days", custom: "7–12 business days" },
      offer: {
        enabled: true,
        eyebrow: "Studio welcome",
        title: "A thoughtful first order",
        body: "Use the studio welcome code on an eligible first order.",
        code: "HELLO15",
        percent: 15,
        maxDiscount: 300,
        delaySeconds: 2,
      },
      shipping: { flatFee: 149, freeThreshold: 5000, bulkThreshold: 8 },
      announcement: {
        enabled: true,
        text: "Festive commissions are open.",
        linkLabel: "Plan a gift",
        linkUrl: "/personalized",
      },
      contact: {
        email: "hello@example.test",
        phone: "+91 98765 43210",
        instagram: "https://instagram.com/GiftNWrapStudio/?igsh=share",
        facebook: "@GiftNWrapStudio",
      },
    })
    .expect(200);
  assert.equal(saved.body.data.offer.code, "HELLO15");

  const publicSettings = await request(app).get("/api/settings").expect(200);
  assert.equal(publicSettings.body.data.shipping.flatFee, 149);
  assert.equal(publicSettings.body.data.contact.phone, "+919876543210");
  assert.equal(
    publicSettings.body.data.contact.instagramUrl,
    "https://www.instagram.com/giftnwrapstudio/",
  );
  assert.equal(publicSettings.body.data.contact.instagramHandle, "@giftnwrapstudio");
  assert.equal(
    publicSettings.body.data.contact.facebookUrl,
    "https://www.facebook.com/giftnwrapstudio/",
  );
  assert.equal(publicSettings.body.data.contact.facebookLabel, "@giftnwrapstudio");

  const offer = await request(app).get("/api/offers/welcome").expect(200);
  assert.equal(offer.body.data.code, "HELLO15");
  assert.equal(offer.body.data.popup.title, "A thoughtful first order");

  const buyer = await buyerAgent();
  const order = await buyer
    .post("/api/orders")
    .send({
      items: [{ slug: "pressed-flower-name-plaque", quantity: 1 }],
      shippingAddress: {
        recipientName: "Mira Shah",
        phone: "+91 98765 43210",
        line1: "12 Garden Road",
        city: "Jaipur",
        state: "Rajasthan",
        postalCode: "302001",
      },
      couponCode: "HELLO15",
    })
    .expect(201);
  assert.equal(order.body.data.shippingFee, 149);
  assert.equal(order.body.data.discount, 285);
  assert.equal(order.body.data.total, 1763);
});

test("studio social settings reject content links and preserve explicit blanks", async () => {
  const admin = await adminAgent();

  const invalidInstagram = await admin
    .put("/api/admin/settings")
    .send({ contact: { instagram: "https://www.instagram.com/reel/example/" } })
    .expect(422);
  assert.equal(
    invalidInstagram.body.error.details.some((issue) => issue.field === "contact.instagram"),
    true,
  );

  const invalidFacebook = await admin
    .put("/api/admin/settings")
    .send({ contact: { facebook: "https://www.facebook.com/groups/example/" } })
    .expect(422);
  assert.equal(
    invalidFacebook.body.error.details.some((issue) => issue.field === "contact.facebook"),
    true,
  );

  const cleared = await admin
    .put("/api/admin/settings")
    .send({ contact: { email: "", phone: "", instagram: "", facebook: "" } })
    .expect(200);
  assert.deepEqual(
    {
      email: cleared.body.data.contact.email,
      phone: cleared.body.data.contact.phone,
      instagramUrl: cleared.body.data.contact.instagramUrl,
      facebookUrl: cleared.body.data.contact.facebookUrl,
    },
    { email: "", phone: "", instagramUrl: "", facebookUrl: "" },
  );

  const publicSettings = await request(app).get("/api/settings").expect(200);
  assert.equal(publicSettings.body.data.contact.instagramUrl, "");
  assert.equal(publicSettings.body.data.contact.facebookUrl, "");
});

test("registered-user administration is protected, paged and privacy-conscious", async () => {
  const buyer = await buyerAgent();
  await buyer.get("/api/admin/users").expect(403);

  const admin = await adminAgent();
  const list = await admin.get("/api/admin/users?limit=10").expect(200);
  assert.equal(list.body.meta.total, 2);
  assert.equal(list.body.meta.metrics.total, 2);
  assert.equal(list.body.metrics.newThisMonth, 2);
  assert.equal(list.body.pagination.pages, 1);
  assert.ok(list.body.data.every((user) => !("googleSub" in user)));
  assert.ok(list.body.data.every((user) => user.phone === "" || user.phone.includes("••••••")));

  const buyerRecord = list.body.data.find((user) => user.role === "buyer");
  const detail = await admin.get(`/api/admin/users/${buyerRecord.id}`).expect(200);
  assert.deepEqual(detail.body.data.metrics, {
    totalOrders: 0,
    lifetimeValue: 0,
    customInquiries: 0,
  });

  ["placed", "confirmed", "in_progress", "ready", "shipped", "delivered", "cancelled"].forEach(
    (status) => memoryStore.create("orders", { buyerId: "dashboard-test", status }),
  );

  const dashboard = await admin.get("/api/admin/dashboard").expect(200);
  assert.equal(dashboard.body.data.users, 2);
  assert.equal(dashboard.body.data.registeredUsers, 1);
  assert.equal(dashboard.body.data.newUsersThisMonth, 2);
  assert.equal(dashboard.body.data.orders, 7);
  assert.equal(dashboard.body.data.ordersPending, 5);
});

test("only the exact configured admin can request product image upload grants", async () => {
  const buyer = await buyerAgent();
  await buyer.post("/api/uploads/signature").send({ purpose: "products" }).expect(403);

  const admin = await adminAgent();
  const signature = await admin
    .post("/api/uploads/signature")
    .send({ purpose: "products" })
    .expect(200);
  assert.match(signature.body.data.folder, /gift-n-wrap\/products\//);
  assert.equal(
    signature.body.data.fullPublicId,
    `${signature.body.data.folder}/${signature.body.data.public_id}`,
  );
});
