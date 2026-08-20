import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "re_transactional_test_key";
process.env.AUTH_EMAIL_FROM = "Gift N Wrap <studio@example.test>";
process.env.AUTH_EMAIL_REPLY_TO = "studio@example.test";
process.env.ADMIN_EMAIL = "owner@example.test";
process.env.APP_URL = "https://studio.example.test";
delete process.env.MONGODB_URI;

const [{ resetMemoryStore }, email, notifications] = await Promise.all([
  import("../lib/memory-store.js"),
  import("../services/email.js"),
  import("../services/email-notifications.js"),
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

const order = () => ({
  id: "order-1",
  orderNumber: "GNW-260820-ABC123",
  buyerName: "Mira Shah",
  buyerEmail: "mira@example.test",
  status: "placed",
  items: [
    {
      name: "Pressed flower plaque",
      quantity: 2,
      unitPrice: 1_899,
      customization: "Names: Mira & Dev",
    },
  ],
  subtotal: 3_798,
  shippingFee: 0,
  discount: 380,
  total: 3_418,
  note: "Please call before dispatch.",
  shippingAddress: {
    recipientName: "Mira Shah",
    phone: "+919876543210",
    line1: "12 Garden Road",
    city: "Jaipur",
    state: "Rajasthan",
    postalCode: "302001",
    country: "India",
  },
  statusHistory: [{ status: "placed", note: "Order received" }],
});

test("new orders send one customer confirmation and one actionable studio alert", async () => {
  await notifications.sendOrderCreatedEmails(order());
  assert.equal(sent.length, 2);

  const customer = sent.find((message) => message.to.includes("mira@example.test"));
  const owner = sent.find((message) => message.to.includes("owner@example.test"));
  assert.match(customer.subject, /GNW-260820-ABC123/);
  assert.match(customer.text, /No payment has been taken/);
  assert.match(customer.text, /12 Garden Road/);
  assert.match(customer.html, /Names: Mira &amp; Dev/);
  assert.equal(customer.reply_to, "info@giftnwrapstudio.com");

  assert.match(owner.subject, /New order/);
  assert.match(owner.text, /admin\?section=orders/);
  assert.equal(owner.reply_to, "mira@example.test");
});

test("order status mail carries the administrator note", async () => {
  const updated = order();
  updated.status = "confirmed";
  updated.statusHistory.push({
    status: "confirmed",
    note: "Final total confirmed. UPI details: studio@upi",
  });

  await notifications.sendOrderStatusEmail(updated);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Confirmed/);
  assert.match(sent[0].text, /UPI details: studio@upi/);
});

test("admin inquiry replies restate the original brief", async () => {
  await notifications.sendInquiryReplyEmail({
    id: "inquiry-1",
    name: "Anaya Gupta",
    email: "anaya@example.test",
    phone: "+919876543210",
    category: "Wedding keepsake",
    idea: "Preserve flowers from our wedding garland.",
    status: "quoted",
    adminNote: "We can create this for ₹4,500 including delivery.",
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /quote/i);
  assert.match(sent[0].text, /₹4,500/);
  assert.match(sent[0].text, /wedding garland/);
});
