import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "razorpay-test-session-secret-that-is-long-enough";
process.env.ADMIN_EMAIL = "owner@example.test";
process.env.RAZORPAY_MODE = "test";
process.env.RAZORPAY_KEY_ID = "rzp_test_publiccheckoutkey";
process.env.RAZORPAY_KEY_SECRET = "razorpay-test-key-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "razorpay-test-webhook-secret";
process.env.CRON_SECRET = "razorpay-test-cron-secret";
delete process.env.MONGODB_URI;

const [
  { default: app },
  { memoryStore, resetMemoryStore },
  { resetRazorpayFetchForTests, setRazorpayFetchForTests },
] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../services/razorpay.js"),
]);

const provider = {
  orderSequence: 0,
  refundSequence: 0,
  createOrderCalls: 0,
  orders: new Map(),
  payments: new Map(),
  refunds: new Map(),
  refundStatus: "processed",
  orderResponsePatch: null,
  createOrderAmbiguousPaid: false,
};

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json" },
});

const fakeProviderFetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || "GET";
  const path = url.pathname;
  if (method === "POST" && path === "/v1/orders") {
    provider.createOrderCalls += 1;
    const body = JSON.parse(init.body);
    const record = {
      id: `order_TEST${++provider.orderSequence}`,
      amount: body.amount,
      currency: body.currency,
      receipt: body.receipt,
      status: "created",
    };
    provider.orders.set(record.id, record);
    if (provider.createOrderAmbiguousPaid) {
      record.status = "paid";
      const payment = {
        id: `pay_RECOVERED${provider.orderSequence}`,
        order_id: record.id,
        amount: record.amount,
        currency: record.currency,
        status: "captured",
        captured: true,
      };
      provider.payments.set(payment.id, payment);
      throw new Error("simulated response loss");
    }
    return jsonResponse({ ...record, ...(provider.orderResponsePatch || {}) });
  }
  if (method === "GET" && path === "/v1/orders") {
    const receipt = url.searchParams.get("receipt");
    return jsonResponse({
      items: [...provider.orders.values()].filter((order) => order.receipt === receipt),
    });
  }
  const orderPayments = path.match(/^\/v1\/orders\/(order_[A-Za-z0-9]+)\/payments$/);
  if (method === "GET" && orderPayments) {
    return jsonResponse({
      items: [...provider.payments.values()].filter(
        (payment) => payment.order_id === orderPayments[1],
      ),
    });
  }
  const paymentFetch = path.match(/^\/v1\/payments\/(pay_[A-Za-z0-9]+)$/);
  if (method === "GET" && paymentFetch) {
    const payment = provider.payments.get(paymentFetch[1]);
    return payment ? jsonResponse(payment) : jsonResponse({ error: { code: "BAD_REQUEST_ERROR" } }, 404);
  }
  const refundCreate = path.match(/^\/v1\/payments\/(pay_[A-Za-z0-9]+)\/refund$/);
  if (method === "POST" && refundCreate) {
    const body = JSON.parse(init.body);
    const record = {
      id: `rfnd_TEST${++provider.refundSequence}`,
      payment_id: refundCreate[1],
      amount: body.amount,
      currency: "INR",
      receipt: body.receipt,
      status: provider.refundStatus,
    };
    provider.refunds.set(record.id, record);
    return jsonResponse(record);
  }
  const refundFetch = path.match(/^\/v1\/refunds\/(rfnd_[A-Za-z0-9]+)$/);
  if (method === "GET" && refundFetch) {
    const refund = provider.refunds.get(refundFetch[1]);
    return refund ? jsonResponse(refund) : jsonResponse({ error: { code: "BAD_REQUEST_ERROR" } }, 404);
  }
  return jsonResponse({ error: { code: "NOT_IMPLEMENTED" } }, 501);
};

beforeEach(() => {
  resetMemoryStore();
  resetRazorpayFetchForTests();
  provider.orderSequence = 0;
  provider.refundSequence = 0;
  provider.createOrderCalls = 0;
  provider.orders.clear();
  provider.payments.clear();
  provider.refunds.clear();
  provider.refundStatus = "processed";
  provider.orderResponsePatch = null;
  provider.createOrderAmbiguousPaid = false;
  setRazorpayFetchForTests(fakeProviderFetch);
});

const login = async (role) => {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/demo").send({ role }).expect(200);
  return { agent, user: response.body.data.user };
};

const createConfirmedQuotedOrder = async (amountPaise = 12_500) => {
  const buyer = await login("buyer");
  const admin = await login("admin");
  const created = await buyer.agent
    .post("/api/orders")
    .set("Idempotency-Key", `order-request-${Date.now()}-${Math.random()}`)
    .send({
      items: [{ slug: "pressed-flower-name-plaque", quantity: 1, customization: "Name: Mira" }],
      shippingAddress: {
        recipientName: "Mira Shah",
        phone: "+91 98765 43210",
        line1: "12 Garden Road",
        city: "Jaipur",
        state: "Rajasthan",
        postalCode: "302001",
      },
      paymentMethod: "manual_confirmation",
      policyConsent: { accepted: true, version: "2026-08-21" },
    })
    .expect(201);
  const orderId = created.body.data.id;
  await admin.agent
    .patch(`/api/admin/orders/${orderId}/status`)
    .send({ status: "confirmed", expectedStatus: "placed", note: "Studio accepted" })
    .expect(200);
  const quote = await admin.agent
    .post(`/api/admin/orders/${orderId}/payment-quote`)
    .send({ amountPaise, note: "Final studio quote" })
    .expect(200);
  assert.equal(quote.body.meta.quoteChanged, true);
  assert.equal(quote.body.data.order.paymentQuote.amountPaise, amountPaise);
  return { buyer, admin, orderId, orderNumber: created.body.data.orderNumber, amountPaise };
};

const createSession = ({ buyer, orderId }, key = "checkout-session-key-001") => buyer.agent
  .post(`/api/payments/razorpay/orders/${orderId}/session`)
  .set("Idempotency-Key", key)
  .set("X-Expected-User-Id", buyer.user.id)
  .send({ policyConsent: { accepted: true, version: "2026-08-21" } });

const callbackSignature = (orderId, paymentId) => createHmac(
  "sha256",
  process.env.RAZORPAY_KEY_SECRET,
).update(`${orderId}|${paymentId}`).digest("hex");

const webhookSignature = (raw) => createHmac(
  "sha256",
  process.env.RAZORPAY_WEBHOOK_SECRET,
).update(raw).digest("hex");

const confirm = ({ buyer, orderId }, razorpayOrderId, razorpayPaymentId, signature) => buyer.agent
  .post("/api/payments/razorpay/confirm")
  .set("X-Expected-User-Id", buyer.user.id)
  .send({
    orderId,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature: signature,
  });

test("sessions use only the confirmed stored quote, require payment consent, and replay safely", async () => {
  const context = await createConfirmedQuotedOrder();
  await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/payment-quote`)
    .send({ amountPaise: context.amountPaise, note: "" })
    .expect(400);
  const forbiddenOrder = memoryStore.create("orders", {
    ...memoryStore.get("orders", context.orderId),
    id: undefined,
    orderNumber: "GNW-WRONG-BUYER",
    buyerId: "another-buyer",
  });
  await createSession({ ...context, orderId: forbiddenOrder.id }, "wrong-buyer-key-001").expect(403);

  await context.buyer.agent
    .post(`/api/payments/razorpay/orders/${context.orderId}/session`)
    .set("Idempotency-Key", "invalid-consent-key")
    .send({ policyConsent: { accepted: false, version: "2026-08-21" } })
    .expect(422);

  const created = await createSession(context).expect(201);
  assert.deepEqual(
    Object.keys(created.body.data).sort(),
    [
      "amountPaise", "currency", "description", "keyId", "name", "order", "payment",
      "prefill", "razorpayOrderId", "testMode",
    ].sort(),
  );
  assert.equal(created.body.data.amountPaise, context.amountPaise);
  assert.equal(created.body.data.currency, "INR");
  assert.equal(created.body.data.testMode, true);
  assert.equal(created.body.data.payment.policyConsent.accepted, true);
  assert.equal("acceptedAt" in created.body.data.payment.policyConsent, false);
  assert.equal(JSON.stringify(created.body).includes(process.env.RAZORPAY_KEY_SECRET), false);

  const replay = await createSession(context).expect(200);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  assert.equal(replay.body.data.razorpayOrderId, created.body.data.razorpayOrderId);
  assert.equal(provider.createOrderCalls, 1);

  await context.admin.agent
    .patch(`/api/admin/orders/${context.orderId}/status`)
    .send({ status: "cancelled", expectedStatus: "confirmed", note: "Customer cancelled" })
    .expect(200);
  const latePaymentId = "pay_TESTLATECANCEL1";
  provider.payments.set(latePaymentId, {
    id: latePaymentId,
    order_id: created.body.data.razorpayOrderId,
    amount: context.amountPaise,
    currency: "INR",
    status: "captured",
    captured: true,
  });
  const lateCapture = await confirm(
    context,
    created.body.data.razorpayOrderId,
    latePaymentId,
    callbackSignature(created.body.data.razorpayOrderId, latePaymentId),
  ).expect(202);
  assert.equal(lateCapture.body.data.payment.state, "review_required");
  assert.equal(lateCapture.body.data.payment.attentionReason, "captured_after_cancellation");
  assert.equal(lateCapture.body.meta.becamePaid, false);
  const returned = await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/refunds`)
    .set("Idempotency-Key", "late_capture_refund_001")
    .send({ reason: "Return late payment for cancelled order" })
    .expect(201);
  assert.equal(returned.body.data.order.paymentStatus, "refunded");
  const returnedReplay = await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/refunds`)
    .set("Idempotency-Key", "late_capture_refund_001")
    .send({ reason: "Return late payment for cancelled order" })
    .expect(200);
  assert.equal(returnedReplay.body.meta.refundCreated, false);
  assert.equal(returnedReplay.body.data.refund.state, "processed");
});

test("callback confirmation verifies the stored order, HMAC, captured flag, amount and currency", async () => {
  const context = await createConfirmedQuotedOrder();
  const session = await createSession(context).expect(201);
  const razorpayOrderId = session.body.data.razorpayOrderId;
  const paymentId = "pay_TESTAUTH1";
  provider.payments.set(paymentId, {
    id: paymentId,
    order_id: razorpayOrderId,
    amount: context.amountPaise,
    currency: "INR",
    status: "authorized",
    captured: false,
  });

  await confirm(context, razorpayOrderId, paymentId, "0".repeat(64)).expect(400);
  const signature = callbackSignature(razorpayOrderId, paymentId);
  const authorized = await confirm(context, razorpayOrderId, paymentId, signature).expect(202);
  assert.equal(authorized.body.data.payment.state, "authorized");
  assert.equal(authorized.body.meta.becamePaid, false);
  await context.admin.agent
    .patch(`/api/admin/orders/${context.orderId}/status`)
    .send({ status: "cancelled", expectedStatus: "confirmed", note: "Unsafe cancellation" })
    .expect(409);

  provider.payments.set(paymentId, {
    ...provider.payments.get(paymentId),
    status: "captured",
    captured: true,
  });
  const captured = await confirm(context, razorpayOrderId, paymentId, signature).expect(200);
  assert.equal(captured.body.data.payment.state, "paid");
  assert.equal(captured.body.data.order.paymentStatus, "paid");
  assert.equal(captured.body.meta.becamePaid, true);
  const replay = await confirm(context, razorpayOrderId, paymentId, signature).expect(200);
  assert.equal(replay.body.meta.becamePaid, false);

  const mismatchContext = await createConfirmedQuotedOrder(9_900);
  const mismatchSession = await createSession(mismatchContext, "checkout-mismatch-key-1").expect(201);
  const mismatchOrderId = mismatchSession.body.data.razorpayOrderId;
  const mismatchPaymentId = "pay_TESTBADAMOUNT1";
  provider.payments.set(mismatchPaymentId, {
    id: mismatchPaymentId,
    order_id: mismatchOrderId,
    amount: 9_899,
    currency: "INR",
    status: "captured",
    captured: true,
  });
  await confirm(
    mismatchContext,
    mismatchOrderId,
    mismatchPaymentId,
    callbackSignature(mismatchOrderId, mismatchPaymentId),
  ).expect(409);
  const reviewed = await mismatchContext.buyer.agent
    .get(`/api/payments/orders/${mismatchContext.orderId}`)
    .expect(200);
  assert.equal(reviewed.body.data.payment.state, "review_required");
  assert.equal(reviewed.body.data.payment.attentionRequired, true);
  assert.equal(reviewed.body.data.order.paymentStatus, "review_required");
});

test("malformed provider orders fail closed and recovered paid orders never reopen Checkout", async () => {
  const malformedContext = await createConfirmedQuotedOrder();
  provider.orderResponsePatch = { id: "malformed-provider-order" };
  await createSession(malformedContext, "malformed-order-key-001").expect(409);
  const malformedState = await malformedContext.buyer.agent
    .get(`/api/payments/orders/${malformedContext.orderId}`)
    .expect(200);
  assert.equal(malformedState.body.data.payment.state, "review_required");
  assert.equal(malformedState.body.data.payment.attentionReason, "provider_order_mismatch");

  provider.orderResponsePatch = null;
  provider.createOrderAmbiguousPaid = true;
  const recoveredContext = await createConfirmedQuotedOrder();
  await createSession(recoveredContext, "recovered-paid-order-key-001").expect(409);
  const pendingReconciliation = await recoveredContext.buyer.agent
    .get(`/api/payments/orders/${recoveredContext.orderId}`)
    .expect(200);
  assert.equal(pendingReconciliation.body.data.payment.state, "unknown");
  assert.equal(pendingReconciliation.body.data.payment.razorpayOrderId.startsWith("order_"), true);
  await request(app)
    .get("/api/maintenance/payments/reconcile")
    .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
    .expect(200);
  const reconciled = await recoveredContext.buyer.agent
    .get(`/api/payments/orders/${recoveredContext.orderId}`)
    .expect(200);
  assert.equal(reconciled.body.data.payment.state, "paid");
});

test("the raw signed webhook is idempotent, monotonic, and records disputes", async () => {
  const context = await createConfirmedQuotedOrder();
  const session = await createSession(context).expect(201);
  const razorpayOrderId = session.body.data.razorpayOrderId;
  const payment = {
    id: "pay_TESTWEBHOOK1",
    order_id: razorpayOrderId,
    amount: context.amountPaise,
    currency: "INR",
    status: "captured",
    captured: true,
  };
  const capturedPayload = { event: "payment.captured", payload: { payment: { entity: payment } } };
  const capturedRaw = JSON.stringify(capturedPayload);
  await request(app)
    .post("/api/payments/razorpay/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Event-Id", "event-captured-001")
    .set("X-Razorpay-Signature", "0".repeat(64))
    .send(capturedRaw)
    .expect(401);
  const first = await request(app)
    .post("/api/payments/razorpay/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Event-Id", "event-captured-001")
    .set("X-Razorpay-Signature", webhookSignature(capturedRaw))
    .send(capturedRaw)
    .expect(200);
  assert.equal(first.body.data.becamePaid, true);
  const duplicate = await request(app)
    .post("/api/payments/razorpay/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Event-Id", "event-captured-001")
    .set("X-Razorpay-Signature", webhookSignature(capturedRaw))
    .send(capturedRaw)
    .expect(200);
  assert.equal(duplicate.body.data.duplicate, true);
  assert.equal(duplicate.body.data.becamePaid, false);

  const failedRaw = JSON.stringify({
    event: "payment.failed",
    payload: { payment: { entity: { ...payment, status: "failed", captured: false } } },
  });
  await request(app)
    .post("/api/payments/razorpay/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Event-Id", "event-failed-late-001")
    .set("X-Razorpay-Signature", webhookSignature(failedRaw))
    .send(failedRaw)
    .expect(200);

  const disputeRaw = JSON.stringify({
    event: "payment.dispute.created",
    payload: { dispute: { entity: { id: "disp_TEST1", payment_id: payment.id } } },
  });
  const dispute = await request(app)
    .post("/api/payments/razorpay/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Event-Id", "event-dispute-001")
    .set("X-Razorpay-Signature", webhookSignature(disputeRaw))
    .send(disputeRaw)
    .expect(200);
  assert.equal(dispute.body.data.disputed, true);
  const state = await context.buyer.agent.get(`/api/payments/orders/${context.orderId}`).expect(200);
  assert.equal(state.body.data.payment.state, "disputed");
  assert.equal(state.body.data.order.paymentStatus, "disputed");
  assert.equal(state.body.data.payment.attentionReason, "payment_disputed");

  const recoveredRaw = JSON.stringify({ event: "unsupported.recovery.test", payload: {} });
  memoryStore.create("razorpayWebhookEvents", {
    eventId: "event-stale-lease-001",
    eventType: "unsupported.recovery.test",
    payloadHash: createHash("sha256").update(recoveredRaw).digest("hex"),
    outcome: "processing",
    updatedAt: new Date(Date.now() - 120_000),
  });
  await request(app)
    .post("/api/payments/razorpay/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Event-Id", "event-stale-lease-001")
    .set("X-Razorpay-Signature", webhookSignature(recoveredRaw))
    .send(recoveredRaw)
    .expect(200);
  const recoveredEvent = memoryStore.findOne(
    "razorpayWebhookEvents",
    (event) => event.eventId === "event-stale-lease-001",
  );
  assert.equal(recoveredEvent.outcome, "ignored");
});

test("refunds reserve balance, replay by idempotency key, and never regress processed state", async () => {
  const context = await createConfirmedQuotedOrder();
  const session = await createSession(context).expect(201);
  const razorpayOrderId = session.body.data.razorpayOrderId;
  const paymentId = "pay_TESTREFUND1";
  provider.payments.set(paymentId, {
    id: paymentId,
    order_id: razorpayOrderId,
    amount: context.amountPaise,
    currency: "INR",
    status: "captured",
    captured: true,
  });
  await confirm(
    context,
    razorpayOrderId,
    paymentId,
    callbackSignature(razorpayOrderId, paymentId),
  ).expect(200);

  const first = await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/refunds`)
    .set("Idempotency-Key", "refund_test_key_001")
    .send({ amountPaise: 4_000, reason: "Customer approved partial refund" })
    .expect(201);
  assert.equal(first.body.meta.refundCreated, true);
  assert.equal(first.body.meta.refundBecameProcessed, true);
  assert.equal(first.body.data.order.paymentStatus, "partially_refunded");
  const replay = await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/refunds`)
    .set("Idempotency-Key", "refund_test_key_001")
    .send({ amountPaise: 4_000, reason: "Customer approved partial refund" })
    .expect(200);
  assert.equal(replay.body.meta.refundCreated, false);
  assert.equal(replay.body.meta.refundBecameProcessed, false);
  await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/refunds`)
    .set("Idempotency-Key", "refund_test_key_002")
    .send({ amountPaise: 8_501, reason: "Invalid excess refund" })
    .expect(400);

  const refund = first.body.data.refund;
  const lateFailureRaw = JSON.stringify({
    event: "refund.failed",
    payload: {
      refund: {
        entity: {
          id: refund.razorpayRefundId,
          payment_id: paymentId,
          amount: 4_000,
          currency: "INR",
          status: "failed",
        },
      },
    },
  });
  await request(app)
    .post("/api/payments/razorpay/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Event-Id", "event-refund-failed-late-001")
    .set("X-Razorpay-Signature", webhookSignature(lateFailureRaw))
    .send(lateFailureRaw)
    .expect(200);
  const state = await context.buyer.agent.get(`/api/payments/orders/${context.orderId}`).expect(200);
  assert.equal(state.body.data.refunds[0].state, "processed");
  assert.equal(state.body.data.order.paymentStatus, "partially_refunded");

  provider.refundStatus = "pending";
  const concurrentRequests = ["refund_race_key_001", "refund_race_key_002"].map(
    (idempotencyKey) => context.admin.agent
      .post(`/api/admin/orders/${context.orderId}/refunds`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ amountPaise: 5_000, reason: "Concurrent refund reservation check" }),
  );
  const concurrentResponses = await Promise.all(concurrentRequests);
  assert.equal(concurrentResponses.filter((response) => response.status === 201).length, 1);
  assert.equal(
    concurrentResponses.filter((response) => [400, 409].includes(response.status)).length,
    1,
  );
  const storedAttempt = memoryStore.findOne(
    "paymentAttempts",
    (attempt) => attempt.orderId === context.orderId,
  );
  assert.ok(storedAttempt.refundReservedAmountPaise <= storedAttempt.amountPaise);

  provider.refundStatus = "failed";
  const failedRefund = await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/refunds`)
    .set("Idempotency-Key", "refund_failed_key_001")
    .send({ amountPaise: 1_000, reason: "Provider rejection contract" })
    .expect(409);
  assert.equal(failedRefund.body.error.code, "REFUND_FAILED");
  const failedReplay = await context.admin.agent
    .post(`/api/admin/orders/${context.orderId}/refunds`)
    .set("Idempotency-Key", "refund_failed_key_001")
    .send({ amountPaise: 1_000, reason: "Provider rejection contract" })
    .expect(409);
  assert.equal(failedReplay.body.error.code, "CONFLICT");
});

test("maintenance reconciliation is cron-protected and converges captured payments", async () => {
  const context = await createConfirmedQuotedOrder();
  const session = await createSession(context).expect(201);
  const payment = {
    id: "pay_TESTRECONCILE1",
    order_id: session.body.data.razorpayOrderId,
    amount: context.amountPaise,
    currency: "INR",
    status: "captured",
    captured: true,
  };
  provider.payments.set(payment.id, payment);
  await request(app)
    .get("/api/maintenance/payments/reconcile")
    .set("Authorization", "Bearer wrong-secret")
    .expect(401);
  const reconciled = await request(app)
    .get("/api/maintenance/payments/reconcile")
    .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
    .expect(200);
  assert.equal(reconciled.body.data.paymentAttempts.checked, 1);
  assert.equal(reconciled.body.data.paymentAttempts.becamePaid, 1);
  const state = await context.buyer.agent.get(`/api/payments/orders/${context.orderId}`).expect(200);
  assert.equal(state.body.data.payment.state, "paid");
});
