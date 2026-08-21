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
  assert.match(customer.html, /Gift N Wrap/);
  assert.match(customer.html, /Resin Art Studio/);
  assert.match(customer.html, />G<span[^>]*>·<\/span>W</);
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

test("a frozen Razorpay quote sends a credential-safe payment invitation", async () => {
  const quoted = order();
  quoted.status = "confirmed";
  quoted.paymentMethod = "razorpay";
  quoted.paymentStatus = "pending";
  quoted.paymentQuote = {
    amountPaise: 352_501,
    currency: "INR",
    note: "Includes the approved gold lettering and insured delivery.",
  };

  await notifications.sendPaymentQuoteReadyEmail(quoted);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /secure payment is ready/i);
  assert.match(sent[0].text, /₹3,525\.01/);
  assert.match(sent[0].text, /approved gold lettering/);
  assert.match(sent[0].text, /account\?tab=orders/);
  assert.match(sent[0].text, /never ask for your card number, CVV, UPI PIN/i);
});

test("a captured payment sends one customer receipt and one studio alert", async () => {
  const paid = order();
  paid.paymentMethod = "razorpay";
  paid.paymentStatus = "paid";
  paid.paymentQuote = { amountPaise: 341_800, currency: "INR" };

  await notifications.sendPaymentCapturedEmails(paid);
  assert.equal(sent.length, 2);
  const customer = sent.find((message) => message.to.includes("mira@example.test"));
  const owner = sent.find((message) => message.to.includes("owner@example.test"));
  assert.match(customer.subject, /payment received/i);
  assert.match(customer.text, /verified and matched securely/i);
  assert.match(customer.text, /₹3,418/);
  assert.match(owner.subject, /payment captured/i);
});

test("refund mail distinguishes initiation from final processing", async () => {
  const paid = order();
  paid.paymentMethod = "razorpay";
  paid.paymentStatus = "paid";

  await notifications.sendRefundUpdateEmail(paid, {
    amountPaise: 100_000,
    state: "pending",
    reason: "Customer cancellation before production",
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /refund initiated/i);
  assert.match(sent[0].text, /original payment method/i);

  sent = [];
  await notifications.sendRefundUpdateEmail(paid, {
    amountPaise: 100_000,
    state: "processed",
    reason: "Customer cancellation before production",
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /refund processed/i);
  assert.match(sent[0].text, /5–7 working days/i);
});

test("delivered order mail invites a verified product review in the customer account", async () => {
  const updated = order();
  updated.status = "delivered";
  updated.statusHistory.push({
    status: "delivered",
    note: "Delivered safely at the front desk.",
  });

  await notifications.sendOrderStatusEmail(updated);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /has arrived/i);
  assert.match(sent[0].text, /verified-purchase review/i);
  assert.match(sent[0].text, /helps our small studio improve/i);
  assert.match(
    sent[0].html,
    /href="https:\/\/studio\.example\.test\/account\?tab=reviews"[^>]*>Rate your delivered piece<\/a>/,
  );
  assert.match(
    sent[0].text,
    /Rate your delivered piece: https:\/\/studio\.example\.test\/account\?tab=reviews/,
  );
  assert.match(sent[0].html, /Gift N Wrap/);
  assert.match(sent[0].html, /Resin Art Studio/);
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
