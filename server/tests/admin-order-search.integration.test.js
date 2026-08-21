import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-only-session-secret-that-is-long-enough";
process.env.ADMIN_EMAIL = "owner@example.test";
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

const seedOrder = ({ orderNumber, buyerName, buyerEmail, status, itemName }) => memoryStore.create("orders", {
  orderNumber,
  buyerId: `buyer-${orderNumber}`,
  buyerName,
  buyerEmail,
  status,
  items: [{ productId: "p1", slug: "piece", name: itemName, category: "Gifts", unitPrice: 1_000, quantity: 1 }],
  subtotal: 1_000,
  shippingFee: 0,
  discount: 0,
  total: 1_000,
  statusHistory: [{ status, note: "Seeded for administration tests", at: new Date().toISOString() }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

test("admin order search and status filters run across the full collection before pagination", async () => {
  const admin = await adminAgent();
  for (let index = 0; index < 24; index += 1) {
    seedOrder({
      orderNumber: `GNW-20260821-${String(index).padStart(3, "0")}`,
      buyerName: `Buyer ${index}`,
      buyerEmail: `buyer${index}@example.test`,
      status: index === 17 ? "ready" : "placed",
      itemName: index === 17 ? "Hidden Forest Clock" : "Resin Keepsake",
    });
  }

  const firstPage = await admin.get("/api/admin/orders").query({ page: 1, limit: 5 }).expect(200);
  assert.equal(firstPage.body.meta.total, 24);
  assert.equal(firstPage.body.data.length, 5);

  const exact = await admin
    .get("/api/admin/orders")
    .query({ q: "GNW-20260821-017", page: 1, limit: 5 })
    .expect(200);
  assert.equal(exact.body.meta.total, 1);
  assert.equal(exact.body.data[0].buyerEmail, "buyer17@example.test");

  const byProductAndStatus = await admin
    .get("/api/admin/orders")
    .query({ q: "forest clock", status: "ready", page: 1, limit: 5 })
    .expect(200);
  assert.equal(byProductAndStatus.body.meta.total, 1);
  assert.equal(byProductAndStatus.body.data[0].status, "ready");

  await admin.get("/api/admin/orders").query({ q: "x".repeat(121) }).expect(422);
  await admin.get("/api/admin/orders").query({ search: "legacy" }).expect(422);
});

test("order Undo is limited to the exact low-risk status produced by the original action", async () => {
  const admin = await adminAgent();
  const order = seedOrder({
    orderNumber: "GNW-20260821-UNDO",
    buyerName: "Undo Guard",
    buyerEmail: "undo@example.test",
    status: "placed",
    itemName: "Guarded Keepsake",
  });

  await admin
    .patch(`/api/admin/orders/${order.id}/status`)
    .send({ status: "in_progress" })
    .expect(200);

  const restored = await admin
    .patch(`/api/admin/orders/${order.id}/status`)
    .send({ status: "placed", expectedStatus: "in_progress", undo: true })
    .expect(200);
  assert.equal(restored.body.data.status, "placed");

  await admin
    .patch(`/api/admin/orders/${order.id}/status`)
    .send({ status: "ready" })
    .expect(200);

  const staleUndo = await admin
    .patch(`/api/admin/orders/${order.id}/status`)
    .send({ status: "placed", expectedStatus: "in_progress", undo: true })
    .expect(409);
  assert.match(staleUndo.body.error.message, /changed after this action/i);

  const current = await admin
    .get("/api/admin/orders")
    .query({ q: order.orderNumber })
    .expect(200);
  assert.equal(current.body.data[0].status, "ready");
});

test("forward order status changes reject a stale admin snapshot without Undo wording", async () => {
  const admin = await adminAgent();
  const order = seedOrder({
    orderNumber: "GNW-20260821-CAS",
    buyerName: "Concurrent Admin",
    buyerEmail: "cas@example.test",
    status: "placed",
    itemName: "Snapshot Keepsake",
  });

  await admin
    .patch(`/api/admin/orders/${order.id}/status`)
    .send({ status: "in_progress", expectedStatus: "placed" })
    .expect(200);

  const staleForward = await admin
    .patch(`/api/admin/orders/${order.id}/status`)
    .send({ status: "ready", expectedStatus: "placed" })
    .expect(409);

  assert.match(staleForward.body.error.message, /status changed/i);
  assert.match(staleForward.body.error.message, /refresh/i);
  assert.doesNotMatch(staleForward.body.error.message, /undo/i);
  assert.equal(memoryStore.get("orders", order.id).status, "in_progress");
});

test("inbox Undo uses the exact status produced by the original action", async () => {
  const admin = await adminAgent();
  const contact = memoryStore.create("contacts", {
    userId: "buyer-contact",
    name: "Contact Undo",
    email: "contact-undo@example.test",
    phone: "",
    subject: "Delivery question",
    message: "Could you confirm the delivery date?",
    status: "new",
    adminNote: "Existing customer reply",
  });
  const inquiry = memoryStore.create("customInquiries", {
    userId: "buyer-inquiry",
    name: "Inquiry Undo",
    email: "inquiry-undo@example.test",
    phone: "",
    productType: "Resin keepsake",
    occasion: "Corporate event",
    description: "A bespoke keepsake for the team.",
    status: "new",
    adminNote: "Existing studio quote",
  });

  await admin.patch(`/api/admin/contacts/${contact.id}`).send({ status: "read" }).expect(200);
  const restoredContact = await admin
    .patch(`/api/admin/contacts/${contact.id}`)
    .send({ status: "new", expectedStatus: "read", undo: true })
    .expect(200);
  assert.equal(restoredContact.body.data.status, "new");
  assert.equal(restoredContact.body.data.adminNote, "Existing customer reply");

  await admin.patch(`/api/admin/contacts/${contact.id}`).send({ status: "read" }).expect(200);
  await admin.patch(`/api/admin/contacts/${contact.id}`).send({ status: "replied" }).expect(200);
  const staleContactUndo = await admin
    .patch(`/api/admin/contacts/${contact.id}`)
    .send({ status: "new", expectedStatus: "read", undo: true })
    .expect(409);
  assert.match(staleContactUndo.body.error.message, /changed after this action/i);
  assert.equal(memoryStore.get("contacts", contact.id).status, "replied");
  assert.equal(memoryStore.get("contacts", contact.id).adminNote, "Existing customer reply");

  await admin.patch(`/api/admin/custom-inquiries/${inquiry.id}`).send({ status: "accepted" }).expect(200);
  await admin.patch(`/api/admin/custom-inquiries/${inquiry.id}`).send({ status: "contacted" }).expect(200);
  const staleInquiryUndo = await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.id}`)
    .send({ status: "new", expectedStatus: "accepted", undo: true })
    .expect(409);
  assert.match(staleInquiryUndo.body.error.message, /changed after this action/i);
  assert.equal(memoryStore.get("customInquiries", inquiry.id).status, "contacted");
  assert.equal(memoryStore.get("customInquiries", inquiry.id).adminNote, "Existing studio quote");
});

test("forward inbox changes reject stale snapshots and preserve omitted admin notes", async () => {
  const admin = await adminAgent();
  const contact = memoryStore.create("contacts", {
    userId: "buyer-contact-cas",
    name: "Contact CAS",
    email: "contact-cas@example.test",
    phone: "",
    subject: "Status race",
    message: "Please keep this existing studio response intact.",
    status: "new",
    adminNote: "Existing contact reply",
  });
  const inquiry = memoryStore.create("customInquiries", {
    userId: "buyer-inquiry-cas",
    name: "Inquiry CAS",
    email: "inquiry-cas@example.test",
    phone: "",
    productType: "Resin keepsake",
    occasion: "Anniversary",
    description: "A bespoke keepsake with concurrent admin edits.",
    status: "new",
    adminNote: "Existing inquiry reply",
  });

  await admin
    .patch(`/api/admin/contacts/${contact.id}`)
    .send({ status: "read", expectedStatus: "new" })
    .expect(200);
  const staleContact = await admin
    .patch(`/api/admin/contacts/${contact.id}`)
    .send({ status: "replied", expectedStatus: "new" })
    .expect(409);
  assert.match(staleContact.body.error.message, /refresh/i);
  assert.doesNotMatch(staleContact.body.error.message, /undo/i);
  assert.equal(memoryStore.get("contacts", contact.id).status, "read");
  assert.equal(memoryStore.get("contacts", contact.id).adminNote, "Existing contact reply");

  await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.id}`)
    .send({ status: "accepted", expectedStatus: "new" })
    .expect(200);
  const staleInquiry = await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.id}`)
    .send({ status: "contacted", expectedStatus: "new" })
    .expect(409);
  assert.match(staleInquiry.body.error.message, /refresh/i);
  assert.doesNotMatch(staleInquiry.body.error.message, /undo/i);
  assert.equal(memoryStore.get("customInquiries", inquiry.id).status, "accepted");
  assert.equal(memoryStore.get("customInquiries", inquiry.id).adminNote, "Existing inquiry reply");
});

test("accepted and closed custom-request stages accept the exact admin UI payload", async () => {
  const admin = await adminAgent();
  const inquiry = memoryStore.create("customInquiries", {
    userId: "buyer-stage-regression",
    name: "Stage Regression",
    email: "stage-regression@example.test",
    phone: "+919876543210",
    category: "Personalized gifts",
    idea: "A keepsake with names and a special date.",
    status: "new",
    adminNote: "",
  });

  const accepted = await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.id}`)
    .send({ status: "accepted", expectedStatus: "new" })
    .expect(200);
  assert.equal(accepted.body.data.status, "accepted");

  const closed = await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.id}`)
    .send({
      status: "closed",
      expectedStatus: "accepted",
      adminNote: "",
    })
    .expect(200);
  assert.equal(closed.body.data.status, "closed");
  assert.equal(closed.body.data.adminNote, "");
});

test("admin full-order view returns checkout contact, address and personalization snapshots", async () => {
  const admin = await adminAgent();
  const order = memoryStore.create("orders", {
    orderNumber: "GNW-20260821-FULL",
    buyerId: "buyer-full-order",
    buyerName: "Mira Shah",
    buyerEmail: "mira@example.test",
    status: "placed",
    items: [{
      productId: "piece-full",
      slug: "pressed-flower-name-plaque",
      name: "Pressed Flower Name Plaque",
      category: "Personalized gifts",
      image: "https://res.cloudinary.com/studio/image/upload/plaque.jpg",
      unitPrice: 2_499,
      quantity: 2,
      customization: JSON.stringify({
        name: "Mira & Aarav",
        date: "2026-12-04",
        colour: "Forest & gold",
        finish: "Gold foil",
        message: "Use flowers from the invitation.",
      }),
    }],
    shippingAddress: {
      recipientName: "Mira Shah",
      phone: "+919876543210",
      line1: "12 Garden Road",
      line2: "Near City Palace",
      city: "Jaipur",
      state: "Rajasthan",
      postalCode: "302001",
      country: "India",
    },
    neededBy: new Date("2026-12-04T00:00:00.000Z"),
    contactPreference: "WhatsApp",
    note: "Please call before delivery.",
    subtotal: 4_998,
    shippingFee: 0,
    discount: 500,
    total: 4_498,
    couponCode: "WELCOME10",
    paymentStatus: "pending",
    statusHistory: [{ status: "placed", note: "Order received", at: new Date().toISOString() }],
  });

  const response = await admin.get(`/api/admin/orders/${order.id}`).expect(200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.data.shippingAddress.phone, "+919876543210");
  assert.equal(response.body.data.shippingAddress.line2, "Near City Palace");
  assert.equal(response.body.data.contactPreference, "WhatsApp");
  assert.equal(response.body.data.items[0].quantity, 2);
  assert.match(response.body.data.items[0].customization, /Mira & Aarav/);
  assert.equal(response.body.data.note, "Please call before delivery.");
});
