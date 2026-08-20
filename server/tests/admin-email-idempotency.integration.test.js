import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "admin-email-idempotency-test-secret";
process.env.ADMIN_EMAIL = "owner@example.test";
process.env.RESEND_API_KEY = "re_admin_email_idempotency";
process.env.AUTH_EMAIL_FROM = "Gift N Wrap <studio@example.test>";
process.env.AUTH_EMAIL_REPLY_TO = "studio@example.test";
process.env.APP_URL = "https://studio.example.test";
delete process.env.MONGODB_URI;

const [{ default: app }, { resetMemoryStore }, email] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../services/email.js"),
]);

let sent;

beforeEach(() => {
  resetMemoryStore();
  sent = [];
  email.resetEmailProviderForTests();
  email.setEmailProviderFetchForTests(async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: `mail-${sent.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

const login = async (role) => {
  const agent = request.agent(app);
  await agent.post("/api/auth/demo").send({ role }).expect(200);
  return agent;
};

test("retrying the same order status transition does not resend its customer email", async () => {
  const buyer = await login("buyer");
  const admin = await login("admin");
  const created = await buyer
    .post("/api/orders")
    .set("Idempotency-Key", "email-idempotency-order-1")
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
      paymentMethod: "manual_confirmation",
    })
    .expect(201);
  sent = [];

  const update = {
    status: "confirmed",
    note: "Final total confirmed. Payment instructions will follow here.",
  };
  const first = await admin
    .patch(`/api/admin/orders/${created.body.data.id}/status`)
    .send(update)
    .expect(200);
  const replay = await admin
    .patch(`/api/admin/orders/${created.body.data.id}/status`)
    .send(update)
    .expect(200);

  assert.equal(sent.length, 1);
  assert.equal(first.body.data.statusHistory.length, replay.body.data.statusHistory.length);
});

test("inquiry and contact replies require a newly supplied nonblank note", async () => {
  const buyer = await login("buyer");
  const admin = await login("admin");

  const inquiry = await buyer
    .post("/api/custom-inquiries")
    .send({
      name: "Mira Shah",
      email: "mira@example.test",
      phone: "+91 98765 43210",
      description: "Preserve flowers from our wedding garland in a keepsake.",
    })
    .expect(201);
  const contact = await buyer
    .post("/api/contact")
    .send({
      name: "Mira Shah",
      email: "mira@example.test",
      phone: "+91 98765 43210",
      subject: "Delivery timing",
      message: "Could you confirm whether delivery next month is possible?",
    })
    .expect(201);
  sent = [];

  const inquiryReply = { status: "quoted", adminNote: "The quote is ₹4,500 delivered." };
  await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.body.data.id}`)
    .send(inquiryReply)
    .expect(200);
  await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.body.data.id}`)
    .send(inquiryReply)
    .expect(200);
  await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.body.data.id}`)
    .send({ ...inquiryReply, adminNote: "The revised quote is ₹4,250 delivered." })
    .expect(200);
  await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.body.data.id}`)
    .send({ status: "accepted" })
    .expect(200);
  await admin
    .patch(`/api/admin/custom-inquiries/${inquiry.body.data.id}`)
    .send({ status: "quoted" })
    .expect(200);

  const contactReply = { status: "replied", adminNote: "Yes, next-month delivery is available." };
  await admin
    .patch(`/api/admin/contacts/${contact.body.data.id}`)
    .send(contactReply)
    .expect(200);
  await admin
    .patch(`/api/admin/contacts/${contact.body.data.id}`)
    .send(contactReply)
    .expect(200);
  await admin
    .patch(`/api/admin/contacts/${contact.body.data.id}`)
    .send({ status: "read" })
    .expect(200);
  await admin
    .patch(`/api/admin/contacts/${contact.body.data.id}`)
    .send({ status: "replied", adminNote: "   " })
    .expect(200);

  assert.equal(sent.length, 3);
  assert.equal(sent.filter((message) => /quote/i.test(message.subject)).length, 2);
  assert.equal(sent.filter((message) => /^Re:/.test(message.subject)).length, 1);
});
