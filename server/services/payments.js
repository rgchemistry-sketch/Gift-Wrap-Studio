import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { memoryStore } from "../lib/memory-store.js";
import {
  AppError,
  badRequest,
  conflict,
  databaseUnavailable,
  forbidden,
  idempotencyKeyReused,
  notFound,
} from "../lib/errors.js";
import { Order } from "../models/Order.js";
import { PaymentAttempt } from "../models/PaymentAttempt.js";
import { RazorpayWebhookEvent } from "../models/RazorpayWebhookEvent.js";
import { RefundAttempt } from "../models/RefundAttempt.js";
import {
  createRazorpayOrder,
  createRazorpayRefund,
  fetchRazorpayOrderPayments,
  fetchRazorpayOrdersByReceipt,
  fetchRazorpayPayment,
  fetchRazorpayRefund,
  isAmbiguousRazorpayError,
  razorpayCheckoutConfig,
  requireRazorpayApiConfig,
  requireRazorpayPaymentConfig,
  verifyRazorpayPaymentSignature,
} from "./razorpay.js";
import { getOrder } from "./store.js";

const settledPaymentStates = new Set(["paid", "partially_refunded", "refunded"]);
const attentionPaymentStates = new Set(["review_required", "disputed"]);
const finalPaymentStates = new Set([...settledPaymentStates, ...attentionPaymentStates]);
const activeRefundStates = new Set(["creating", "pending", "processed", "unknown"]);
const webhookProcessingLeaseMs = 60_000;

const plain = (record) => {
  if (!record) return record;
  const value = typeof record.toObject === "function" ? record.toObject() : structuredClone(record);
  if (value._id) {
    value.id = String(value._id);
    delete value._id;
  }
  delete value.__v;
  return value;
};

const writableMode = async () => {
  const mode = await connectDatabase();
  if (mode === "memory" && !env.allowMemoryWrites) throw databaseUnavailable();
  return mode;
};

const orderLookup = (id) =>
  mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { orderNumber: id }] } : { orderNumber: id };

const findInternalOrder = async (id, mode, session) => {
  if (mode === "mongodb") return Order.findOne(orderLookup(id)).session(session || null);
  return (
    memoryStore.get("orders", id) ||
    memoryStore.findOne("orders", (order) => order.orderNumber === id)
  );
};

const hashValue = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const duplicateKey = (error) => error?.code === 11_000 || error?.code === 11000;

const assertBuyerOrder = (order, user) => {
  if (!order) throw notFound("Order");
  if (String(order.buyerId) !== String(user?.id) && user?.role !== "admin") throw forbidden();
};

const assertConfirmedForPayment = (order) => {
  if (order.status !== "confirmed") {
    throw conflict("The studio must confirm this order before Razorpay payment can begin");
  }
};

const assertAdjustedQuoteExplained = (order, quote) => {
  const requestedAmountPaise = Math.round(Number(order.total || 0) * 100);
  if (quote.amountPaise !== requestedAmountPaise && !String(quote.note || "").trim()) {
    throw badRequest("Explain the price adjustment in the customer-facing payment note");
  }
};

const publicPayment = (record) => {
  const value = plain(record);
  if (!value) return null;
  return {
    id: value.id,
    orderId: value.orderId,
    state: value.state,
    attentionRequired: attentionPaymentStates.has(value.state),
    attentionReason: attentionPaymentStates.has(value.state) ? value.attentionReason || "manual_review" : "",
    amountPaise: value.amountPaise,
    currency: value.currency,
    testMode: env.razorpayMode === "test",
    razorpayOrderId: value.providerOrderId || "",
    razorpayPaymentId: value.providerPaymentId || "",
    refundedAmountPaise: Number(value.refundedAmountPaise || 0),
    failedAttempts: Number(value.failedAttempts || 0),
    policyConsent: value.policyConsent
      ? { accepted: value.policyConsent.accepted === true, version: value.policyConsent.version }
      : null,
    authorizedAt: value.authorizedAt || null,
    capturedAt: value.capturedAt || null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const publicRefund = (record) => {
  const value = plain(record);
  if (!value) return null;
  return {
    id: value.id,
    orderId: value.orderId,
    amountPaise: value.amountPaise,
    currency: value.currency,
    reason: value.reason,
    state: value.state,
    razorpayRefundId: value.providerRefundId || "",
    processedAt: value.processedAt || null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const attemptForOrder = async (orderId, mode, { includeSecrets = false, session } = {}) => {
  if (mode === "mongodb") {
    let query = PaymentAttempt.findOne({ orderId: String(orderId) }).session(session || null);
    if (includeSecrets) query = query.select("+idempotencyKey +requestHash");
    return query;
  }
  return memoryStore.findOne("paymentAttempts", (attempt) => attempt.orderId === String(orderId));
};

const refundForIdempotency = async (orderId, idempotencyKey, mode, { session } = {}) => {
  if (mode === "mongodb") {
    return RefundAttempt.findOne({ orderId: String(orderId), idempotencyKey })
      .select("+idempotencyKey +requestHash")
      .session(session || null);
  }
  return memoryStore.findOne(
    "refundAttempts",
    (refund) => refund.orderId === String(orderId) && refund.idempotencyKey === idempotencyKey,
  );
};

const refundsForOrder = async (orderId, mode) => {
  if (mode === "mongodb") return RefundAttempt.find({ orderId: String(orderId) }).sort({ createdAt: -1 });
  return memoryStore
    .find("refundAttempts", (refund) => refund.orderId === String(orderId))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
};

const markPaymentAttention = async (attemptId, mode, state, reason) => {
  const nextState = state === "disputed" ? "disputed" : "review_required";
  const safeReason = String(reason || "manual_review").slice(0, 80);
  const now = new Date();
  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const attempt = await PaymentAttempt.findById(attemptId).session(session);
        if (!attempt) throw notFound("Payment attempt");
        const order = await Order.findById(attempt.orderId).session(session);
        if (!order) throw notFound("Order");
        const preserveDispute = attempt.state === "disputed" && nextState !== "disputed";
        if (!preserveDispute) {
          attempt.state = nextState;
          attempt.attentionReason = safeReason;
          attempt.lastProviderCheckAt = now;
          await attempt.save({ session });
          order.paymentStatus = nextState;
          order.paymentReviewCode = safeReason;
          await order.save({ session });
        }
        result = attempt;
      });
    } finally {
      await session.endSession();
    }
    return result;
  }
  const attempt = memoryStore.get("paymentAttempts", attemptId);
  if (!attempt) throw notFound("Payment attempt");
  if (attempt.state === "disputed" && nextState !== "disputed") return attempt;
  const updated = memoryStore.update("paymentAttempts", attempt.id, {
    state: nextState,
    attentionReason: safeReason,
    lastProviderCheckAt: now,
  });
  const order = memoryStore.get("orders", attempt.orderId);
  if (!order) throw notFound("Order");
  memoryStore.update("orders", order.id, {
    paymentStatus: nextState,
    paymentReviewCode: safeReason,
  });
  return updated;
};

export const setPaymentQuote = async (orderId, input, adminUser) => {
  requireRazorpayPaymentConfig();
  const mode = await writableMode();
  const normalized = {
    amountPaise: input.amountPaise,
    currency: "INR",
    note: input.note || "",
  };
  let quoteChanged = false;

  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const order = await findInternalOrder(orderId, mode, session);
        if (!order) throw notFound("Order");
        assertConfirmedForPayment(order);
        assertAdjustedQuoteExplained(order, normalized);
        if ([...finalPaymentStates, "authorized"].includes(order.paymentStatus)) {
          throw conflict("A payment quote cannot change after payment authorization");
        }
        const current = order.paymentQuote;
        if (
          current &&
          current.amountPaise === normalized.amountPaise &&
          current.currency === normalized.currency &&
          String(current.note || "") === normalized.note
        ) return;
        if (await attemptForOrder(order.id, mode, { session })) {
          throw conflict("A Razorpay session already exists for this quote");
        }
        order.paymentQuote = {
          ...normalized,
          quotedAt: new Date(),
          quotedBy: String(adminUser.id),
          version: Number(current?.version || 0) + 1,
        };
        order.paymentMethod = "razorpay";
        order.paymentStatus = "pending";
        order.paymentReviewCode = "";
        order.refundedAmountPaise = 0;
        await order.save({ session });
        quoteChanged = true;
      });
    } finally {
      await session.endSession();
    }
  } else {
    const order = await findInternalOrder(orderId, mode);
    if (!order) throw notFound("Order");
    assertConfirmedForPayment(order);
    assertAdjustedQuoteExplained(order, normalized);
    if ([...finalPaymentStates, "authorized"].includes(order.paymentStatus)) {
      throw conflict("A payment quote cannot change after payment authorization");
    }
    const current = order.paymentQuote;
    if (
      current &&
      current.amountPaise === normalized.amountPaise &&
      current.currency === normalized.currency &&
      String(current.note || "") === normalized.note
    ) {
      return { order: await getOrder(order.id), quoteChanged: false };
    }
    if (await attemptForOrder(order.id, mode)) {
      throw conflict("A Razorpay session already exists for this quote");
    }
    memoryStore.update("orders", order.id, {
      paymentQuote: {
        ...normalized,
        quotedAt: new Date(),
        quotedBy: String(adminUser.id),
        version: Number(current?.version || 0) + 1,
      },
      paymentMethod: "razorpay",
      paymentStatus: "pending",
      paymentReviewCode: "",
      refundedAmountPaise: 0,
    });
    quoteChanged = true;
  }

  return { order: await getOrder(orderId), quoteChanged };
};

const paymentRequestHash = (order) =>
  hashValue({
    orderId: String(order.id || order._id),
    amountPaise: order.paymentQuote.amountPaise,
    currency: order.paymentQuote.currency,
    quoteVersion: Number(order.paymentQuote.version || 1),
  });

const providerOrderMatches = (providerOrder, attempt) =>
  providerOrder &&
  /^order_[A-Za-z0-9]+$/.test(String(providerOrder.id || "")) &&
  String(providerOrder.receipt || "") === attempt.receipt &&
  Number(providerOrder.amount) === Number(attempt.amountPaise) &&
  providerOrder.currency === attempt.currency;

const attachProviderOrder = async (attempt, providerOrder, mode) => {
  if (!providerOrderMatches(providerOrder, attempt)) {
    await markPaymentAttention(
      String(attempt.id || attempt._id),
      mode,
      "review_required",
      "provider_order_mismatch",
    );
    throw new AppError(
      409,
      "PAYMENT_AMOUNT_MISMATCH",
      "The Razorpay order does not match the studio's saved quote",
    );
  }
  const changes = {
    providerOrderId: String(providerOrder.id),
    providerOrderStatus: String(providerOrder.status || "created"),
    state: providerOrder.status === "paid" ? "unknown" : "created",
    lastProviderCheckAt: new Date(),
  };
  if (mode === "mongodb") {
    return PaymentAttempt.findByIdAndUpdate(attempt.id || attempt._id, { $set: changes }, { new: true });
  }
  return memoryStore.update("paymentAttempts", attempt.id, changes);
};

const findMatchingProviderOrder = async (attempt, mode) => {
  const result = await fetchRazorpayOrdersByReceipt(attempt.receipt);
  const candidates = Array.isArray(result?.items) ? result.items : [];
  const match = candidates.find((item) => providerOrderMatches(item, attempt));
  if (!match && candidates.length) {
    await markPaymentAttention(
      String(attempt.id || attempt._id),
      mode,
      "review_required",
      "provider_order_mismatch",
    );
    throw new AppError(
      409,
      "PAYMENT_AMOUNT_MISMATCH",
      "An existing Razorpay order does not match the studio's saved quote",
    );
  }
  return match;
};

const ensureProviderOrder = async (attempt, mode) => {
  if (attempt.providerOrderId) return attempt;
  let providerOrder;
  if (["unknown", "failed"].includes(attempt.state)) {
    providerOrder = await findMatchingProviderOrder(attempt, mode);
  }
  if (!providerOrder) {
    try {
      providerOrder = await createRazorpayOrder({
        amountPaise: attempt.amountPaise,
        currency: attempt.currency,
        receipt: attempt.receipt,
        notes: { order_number: attempt.orderNumber },
      });
    } catch (error) {
      try {
        providerOrder = await findMatchingProviderOrder(attempt, mode);
      } catch (recoveryError) {
        if (recoveryError?.code === "PAYMENT_AMOUNT_MISMATCH") throw recoveryError;
        const state = isAmbiguousRazorpayError(error) ? "unknown" : "failed";
        if (mode === "mongodb") {
          await PaymentAttempt.updateOne(
            { _id: attempt.id || attempt._id, state: { $nin: [...finalPaymentStates] } },
            { $set: { state, lastProviderCheckAt: new Date() } },
          );
        } else if (!finalPaymentStates.has(attempt.state)) {
          memoryStore.update("paymentAttempts", attempt.id, { state, lastProviderCheckAt: new Date() });
        }
        throw error;
      }
      if (!providerOrder) throw error;
    }
  }
  return attachProviderOrder(attempt, providerOrder, mode);
};

const createOrFindPaymentAttempt = async (order, idempotencyKey, policyConsent, mode) => {
  const orderId = String(order.id || order._id);
  const requestHash = paymentRequestHash(order);
  let existing = await attemptForOrder(orderId, mode, { includeSecrets: true });
  if (existing) {
    if (existing.requestHash !== requestHash) throw idempotencyKeyReused();
    return { attempt: existing, replayed: true };
  }
  const input = {
    orderId,
    orderNumber: order.orderNumber,
    buyerId: String(order.buyerId),
    idempotencyKey,
    requestHash,
    receipt: order.orderNumber.slice(0, 40),
    amountPaise: order.paymentQuote.amountPaise,
    currency: order.paymentQuote.currency,
    state: "creating",
    policyConsent: { ...policyConsent, acceptedAt: new Date() },
  };
  try {
    const attempt =
      mode === "mongodb"
        ? await PaymentAttempt.create(input)
        : memoryStore.create("paymentAttempts", input);
    return { attempt, replayed: false };
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    existing = await attemptForOrder(orderId, mode, { includeSecrets: true });
    if (!existing || existing.requestHash !== requestHash) throw idempotencyKeyReused();
    return { attempt: existing, replayed: true };
  }
};

export const createBuyerRazorpaySession = async (
  user,
  orderId,
  idempotencyKey,
  policyConsent,
) => {
  requireRazorpayPaymentConfig();
  const checkoutConfig = razorpayCheckoutConfig();
  const mode = await writableMode();
  const order = await findInternalOrder(orderId, mode);
  assertBuyerOrder(order, user);
  assertConfirmedForPayment(order);
  if (!order.paymentQuote?.amountPaise || order.paymentQuote.currency !== "INR") {
    throw conflict("The studio has not published a Razorpay payment quote for this order");
  }
  if ([...finalPaymentStates, "authorized"].includes(order.paymentStatus)) {
    throw conflict("This order is not eligible for a new Razorpay session");
  }
  const { attempt: initialAttempt, replayed } = await createOrFindPaymentAttempt(
    plain(order),
    idempotencyKey,
    policyConsent,
    mode,
  );
  const attempt = await ensureProviderOrder(plain(initialAttempt), mode);
  if (attempt.providerOrderStatus === "paid") {
    throw conflict("Razorpay reports this order as paid and it is being reconciled. Refresh shortly");
  }
  const publicOrder = await getOrder(String(order.id || order._id));
  return {
    data: {
      ...checkoutConfig,
      razorpayOrderId: attempt.providerOrderId,
      amountPaise: attempt.amountPaise,
      currency: attempt.currency,
      name: "Gift N Wrap Studio",
      description: `Payment for ${order.orderNumber}`,
      prefill: {
        name: order.buyerName,
        email: order.buyerEmail,
        contact: order.shippingAddress?.phone || "",
      },
      order: publicOrder,
      payment: publicPayment(attempt),
    },
    replayed,
  };
};

const validateProviderPayment = (attempt, payment) => {
  if (
    !payment ||
    !/^pay_[A-Za-z0-9]+$/.test(String(payment.id || "")) ||
    String(payment.order_id || "") !== String(attempt.providerOrderId) ||
    Number(payment.amount) !== Number(attempt.amountPaise) ||
    payment.currency !== attempt.currency ||
    ((payment.status === "captured") !== (payment.captured === true)) ||
    (attempt.providerPaymentId &&
      settledPaymentStates.has(attempt.state) &&
      String(attempt.providerPaymentId) !== String(payment.id))
  ) {
    throw new AppError(
      409,
      "PAYMENT_VERIFICATION_FAILED",
      "Razorpay payment details do not match the studio's saved quote",
    );
  }
};

const terminalAttemptState = (state) => finalPaymentStates.has(state);

const markAuthorized = async (attemptId, payment, mode, { signatureVerified = false } = {}) => {
  const now = new Date();
  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const attempt = await PaymentAttempt.findById(attemptId).session(session);
        if (!attempt) throw notFound("Payment attempt");
        validateProviderPayment(attempt, payment);
        if (attentionPaymentStates.has(attempt.state)) {
          result = attempt;
          return;
        }
        const order = await Order.findById(attempt.orderId).session(session);
        if (!order) throw notFound("Order");
        if (!terminalAttemptState(attempt.state)) {
          attempt.state = "authorized";
          attempt.providerPaymentId = String(payment.id);
          attempt.providerPaymentStatus = "authorized";
          attempt.authorizedAt ||= now;
          attempt.lastProviderCheckAt = now;
          if (signatureVerified) attempt.signatureVerifiedAt = now;
          await attempt.save({ session });
          if (["pending", "failed"].includes(order.paymentStatus)) {
            order.paymentStatus = "authorized";
            order.paymentReviewCode = "";
            await order.save({ session });
          }
        }
        result = attempt;
      });
    } finally {
      await session.endSession();
    }
    return { attempt: result, becamePaid: false };
  }
  const attempt = memoryStore.get("paymentAttempts", attemptId);
  if (!attempt) throw notFound("Payment attempt");
  validateProviderPayment(attempt, payment);
  if (terminalAttemptState(attempt.state)) return { attempt, becamePaid: false };
  const updated = memoryStore.update("paymentAttempts", attempt.id, {
    state: "authorized",
    providerPaymentId: String(payment.id),
    providerPaymentStatus: "authorized",
    authorizedAt: attempt.authorizedAt || now,
    lastProviderCheckAt: now,
    ...(signatureVerified ? { signatureVerifiedAt: now } : {}),
  });
  const order = memoryStore.get("orders", attempt.orderId);
  if (order && ["pending", "failed"].includes(order.paymentStatus)) {
    memoryStore.update("orders", order.id, { paymentStatus: "authorized", paymentReviewCode: "" });
  }
  return { attempt: updated, becamePaid: false };
};

const markCaptured = async (attemptId, payment, mode, { signatureVerified = false } = {}) => {
  const now = new Date();
  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let result;
    let becamePaid = false;
    try {
      await session.withTransaction(async () => {
        const attempt = await PaymentAttempt.findById(attemptId).session(session);
        if (!attempt) throw notFound("Payment attempt");
        validateProviderPayment(attempt, payment);
        if (attentionPaymentStates.has(attempt.state)) {
          result = attempt;
          return;
        }
        const order = await Order.findById(attempt.orderId).session(session);
        if (!order) throw notFound("Order");
        if (order.status === "cancelled") {
          attempt.state = "review_required";
          attempt.attentionReason = "captured_after_cancellation";
          attempt.providerPaymentId = String(payment.id);
          attempt.providerPaymentStatus = "captured";
          attempt.authorizedAt ||= now;
          attempt.capturedAt ||= now;
          attempt.lastProviderCheckAt = now;
          if (signatureVerified) attempt.signatureVerifiedAt = now;
          await attempt.save({ session });
          order.paymentMethod = "razorpay";
          order.paymentStatus = "review_required";
          order.paymentReviewCode = "captured_after_cancellation";
          order.paymentCapturedAt = now;
          await order.save({ session });
          result = attempt;
          return;
        }
        becamePaid = !["paid", "partially_refunded", "refunded"].includes(order.paymentStatus);
        if (!terminalAttemptState(attempt.state)) attempt.state = "paid";
        attempt.providerPaymentId = String(payment.id);
        attempt.providerPaymentStatus = "captured";
        attempt.authorizedAt ||= now;
        attempt.capturedAt ||= now;
        attempt.lastProviderCheckAt = now;
        if (signatureVerified) attempt.signatureVerifiedAt = now;
        await attempt.save({ session });
        if (becamePaid) {
          order.paymentMethod = "razorpay";
          order.paymentStatus = "paid";
          order.paymentReviewCode = "";
          order.paymentCapturedAt = now;
          await order.save({ session });
        }
        result = attempt;
      });
    } finally {
      await session.endSession();
    }
    return { attempt: result, becamePaid };
  }
  const attempt = memoryStore.get("paymentAttempts", attemptId);
  if (!attempt) throw notFound("Payment attempt");
  validateProviderPayment(attempt, payment);
  if (attentionPaymentStates.has(attempt.state)) return { attempt, becamePaid: false };
  const order = memoryStore.get("orders", attempt.orderId);
  if (!order) throw notFound("Order");
  if (order.status === "cancelled") {
    const updated = memoryStore.update("paymentAttempts", attempt.id, {
      state: "review_required",
      attentionReason: "captured_after_cancellation",
      providerPaymentId: String(payment.id),
      providerPaymentStatus: "captured",
      authorizedAt: attempt.authorizedAt || now,
      capturedAt: attempt.capturedAt || now,
      lastProviderCheckAt: now,
      ...(signatureVerified ? { signatureVerifiedAt: now } : {}),
    });
    memoryStore.update("orders", order.id, {
      paymentMethod: "razorpay",
      paymentStatus: "review_required",
      paymentReviewCode: "captured_after_cancellation",
      paymentCapturedAt: now,
    });
    return { attempt: updated, becamePaid: false };
  }
  const becamePaid = !["paid", "partially_refunded", "refunded"].includes(order.paymentStatus);
  const updated = memoryStore.update("paymentAttempts", attempt.id, {
    state: terminalAttemptState(attempt.state) ? attempt.state : "paid",
    providerPaymentId: String(payment.id),
    providerPaymentStatus: "captured",
    authorizedAt: attempt.authorizedAt || now,
    capturedAt: attempt.capturedAt || now,
    lastProviderCheckAt: now,
    ...(signatureVerified ? { signatureVerifiedAt: now } : {}),
  });
  if (becamePaid) {
    memoryStore.update("orders", order.id, {
      paymentMethod: "razorpay",
      paymentStatus: "paid",
      paymentReviewCode: "",
      paymentCapturedAt: now,
    });
  }
  return { attempt: updated, becamePaid };
};

const markFailed = async (attemptId, payment, mode) => {
  const now = new Date();
  const failure = {
    code: String(payment?.error_code || "").slice(0, 100),
    source: String(payment?.error_source || "").slice(0, 100),
    step: String(payment?.error_step || "").slice(0, 100),
    reason: String(payment?.error_reason || "").slice(0, 160),
    at: now,
  };
  if (mode === "mongodb") {
    const attempt = await PaymentAttempt.findById(attemptId);
    if (!attempt) throw notFound("Payment attempt");
    if (!terminalAttemptState(attempt.state) && attempt.state !== "authorized") {
      attempt.state = "failed";
      attempt.lastFailedPaymentId = String(payment?.id || "");
      attempt.failedAttempts += 1;
      attempt.lastFailure = failure;
      attempt.lastProviderCheckAt = now;
      await attempt.save();
      await Order.updateOne(
        { _id: attempt.orderId, paymentStatus: "pending" },
        { $set: { paymentStatus: "failed" } },
      );
    }
    return { attempt, becamePaid: false };
  }
  const attempt = memoryStore.get("paymentAttempts", attemptId);
  if (!attempt) throw notFound("Payment attempt");
  if (terminalAttemptState(attempt.state) || attempt.state === "authorized") {
    return { attempt, becamePaid: false };
  }
  const updated = memoryStore.update("paymentAttempts", attempt.id, {
    state: "failed",
    lastFailedPaymentId: String(payment?.id || ""),
    failedAttempts: Number(attempt.failedAttempts || 0) + 1,
    lastFailure: failure,
    lastProviderCheckAt: now,
  });
  const order = memoryStore.get("orders", attempt.orderId);
  if (order?.paymentStatus === "pending") {
    memoryStore.update("orders", order.id, { paymentStatus: "failed" });
  }
  return { attempt: updated, becamePaid: false };
};

const applyProviderPayment = async (attempt, payment, mode, options = {}) => {
  validateProviderPayment(attempt, payment);
  if (payment.status === "captured" && payment.captured === true) {
    return markCaptured(String(attempt.id || attempt._id), payment, mode, options);
  }
  if (payment.status === "authorized") {
    return markAuthorized(String(attempt.id || attempt._id), payment, mode, options);
  }
  if (payment.status === "failed") return markFailed(String(attempt.id || attempt._id), payment, mode);
  if (mode === "mongodb") {
    await PaymentAttempt.updateOne(
      { _id: attempt.id || attempt._id },
      { $set: { providerPaymentStatus: String(payment.status || ""), lastProviderCheckAt: new Date() } },
    );
    return { attempt: await PaymentAttempt.findById(attempt.id || attempt._id), becamePaid: false };
  }
  return {
    attempt: memoryStore.update("paymentAttempts", attempt.id, {
      providerPaymentStatus: String(payment.status || ""),
      lastProviderCheckAt: new Date(),
    }),
    becamePaid: false,
  };
};

const applyTrustedProviderPayment = async (attempt, payment, mode, options = {}) => {
  try {
    return await applyProviderPayment(attempt, payment, mode, options);
  } catch (error) {
    if (error?.code === "PAYMENT_VERIFICATION_FAILED") {
      await markPaymentAttention(
        String(attempt.id || attempt._id),
        mode,
        "review_required",
        "provider_payment_mismatch",
      );
    }
    throw error;
  }
};

export const confirmBuyerRazorpayPayment = async (user, input) => {
  requireRazorpayApiConfig();
  const mode = await writableMode();
  const order = await findInternalOrder(input.orderId, mode);
  assertBuyerOrder(order, user);
  const attempt = await attemptForOrder(String(order.id || order._id), mode);
  if (!attempt?.providerOrderId) throw notFound("Razorpay payment session");
  if (attempt.providerOrderId !== input.razorpayOrderId) {
    throw new AppError(400, "PAYMENT_SIGNATURE_INVALID", "Payment signature verification failed");
  }
  if (!verifyRazorpayPaymentSignature({
    providerOrderId: attempt.providerOrderId,
    providerPaymentId: input.razorpayPaymentId,
    signature: input.razorpaySignature,
  })) {
    throw new AppError(400, "PAYMENT_SIGNATURE_INVALID", "Payment signature verification failed");
  }
  const payment = await fetchRazorpayPayment(input.razorpayPaymentId);
  if (String(payment.id) !== input.razorpayPaymentId) {
    await markPaymentAttention(
      String(attempt.id || attempt._id),
      mode,
      "review_required",
      "provider_payment_id_mismatch",
    );
    throw new AppError(409, "PAYMENT_VERIFICATION_FAILED", "Razorpay returned a different payment");
  }
  const transition = await applyTrustedProviderPayment(plain(attempt), payment, mode, {
    signatureVerified: true,
  });
  return {
    order: await getOrder(String(order.id || order._id)),
    payment: publicPayment(transition.attempt),
    becamePaid: transition.becamePaid,
  };
};

export const getBuyerPaymentState = async (user, orderId) => {
  const mode = await connectDatabase();
  const order = await findInternalOrder(orderId, mode);
  assertBuyerOrder(order, user);
  const internalId = String(order.id || order._id);
  const [attempt, refunds] = await Promise.all([
    attemptForOrder(internalId, mode),
    refundsForOrder(internalId, mode),
  ]);
  return {
    order: await getOrder(internalId),
    payment: publicPayment(attempt),
    refunds: refunds.map(publicRefund),
  };
};

const refundRequestHash = ({ orderId, amountPaise, reason }) =>
  hashValue({ orderId: String(orderId), amountPaise, reason });

const refundReceipt = (orderNumber, idempotencyKey) => {
  const suffix = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 10);
  return `RF-${String(orderNumber).slice(0, 26)}-${suffix}`.slice(0, 40);
};

const updateRefundProviderResult = async (refund, result, mode) => {
  if (refund.state === "processed") return refund;
  const state = result.status === "processed" ? "processed" : result.status === "failed" ? "failed" : "pending";
  const changes = {
    providerRefundId: String(result.id || refund.providerRefundId || ""),
    providerStatus: String(result.status || "pending"),
    state,
    lastProviderCheckAt: new Date(),
    ...(state === "processed" ? { processedAt: new Date() } : {}),
    ...(state === "failed" ? { failedAt: new Date() } : {}),
  };
  if (mode === "mongodb") {
    return RefundAttempt.findByIdAndUpdate(refund.id || refund._id, { $set: changes }, { new: true });
  }
  return memoryStore.update("refundAttempts", refund.id, changes);
};

const recomputeRefundState = async (refundId, mode) => {
  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let refund;
    let refundBecameProcessed = false;
    try {
      await session.withTransaction(async () => {
        refund = await RefundAttempt.findById(refundId).session(session);
        if (!refund) throw notFound("Refund");
        refundBecameProcessed = refund.state !== "processed";
        refund.state = "processed";
        refund.providerStatus = "processed";
        refund.processedAt ||= new Date();
        await refund.save({ session });
        const rows = await RefundAttempt.find({
          orderId: refund.orderId,
          state: "processed",
        }).session(session);
        const refunded = rows.reduce((sum, row) => sum + Number(row.amountPaise || 0), 0);
        const attempt = await PaymentAttempt.findById(refund.paymentAttemptId).session(session);
        if (!attempt) throw notFound("Payment attempt");
        attempt.refundedAmountPaise = refunded;
        const resolvedCancelledCapture =
          attempt.attentionReason === "captured_after_cancellation" &&
          refunded >= attempt.amountPaise;
        if (!attentionPaymentStates.has(attempt.state) || resolvedCancelledCapture) {
          attempt.state = refunded >= attempt.amountPaise ? "refunded" : "partially_refunded";
        }
        if (resolvedCancelledCapture) attempt.attentionReason = "";
        await attempt.save({ session });
        const order = await Order.findById(refund.orderId).session(session);
        if (!order) throw notFound("Order");
        order.refundedAmountPaise = refunded;
        if (!attentionPaymentStates.has(order.paymentStatus) || resolvedCancelledCapture) {
          order.paymentStatus = refunded >= attempt.amountPaise ? "refunded" : "partially_refunded";
        }
        if (resolvedCancelledCapture) order.paymentReviewCode = "";
        await order.save({ session });
      });
    } finally {
      await session.endSession();
    }
    return { refund, refundBecameProcessed };
  }
  const refund = memoryStore.get("refundAttempts", refundId);
  if (!refund) throw notFound("Refund");
  const refundBecameProcessed = refund.state !== "processed";
  const updatedRefund = memoryStore.update("refundAttempts", refund.id, {
    state: "processed",
    providerStatus: "processed",
    processedAt: refund.processedAt || new Date(),
  });
  const refunded = memoryStore
    .find(
      "refundAttempts",
      (row) => row.orderId === refund.orderId && row.state === "processed",
    )
    .reduce((sum, row) => sum + Number(row.amountPaise || 0), 0);
  const attempt = memoryStore.get("paymentAttempts", refund.paymentAttemptId);
  if (!attempt) throw notFound("Payment attempt");
  const state = refunded >= attempt.amountPaise ? "refunded" : "partially_refunded";
  const resolvedCancelledCapture =
    attempt.attentionReason === "captured_after_cancellation" && refunded >= attempt.amountPaise;
  memoryStore.update("paymentAttempts", attempt.id, {
    refundedAmountPaise: refunded,
    state:
      attentionPaymentStates.has(attempt.state) && !resolvedCancelledCapture
        ? attempt.state
        : state,
    ...(resolvedCancelledCapture ? { attentionReason: "" } : {}),
  });
  const order = memoryStore.get("orders", refund.orderId);
  memoryStore.update("orders", refund.orderId, {
    refundedAmountPaise: refunded,
    paymentStatus:
      attentionPaymentStates.has(order?.paymentStatus) && !resolvedCancelledCapture
        ? order.paymentStatus
        : state,
    ...(resolvedCancelledCapture ? { paymentReviewCode: "" } : {}),
  });
  return { refund: updatedRefund, refundBecameProcessed };
};

const markRefundFailed = async (refundId, mode) => {
  const now = new Date();
  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const refund = await RefundAttempt.findById(refundId).session(session);
        if (!refund) throw notFound("Refund");
        if (refund.state === "processed") {
          result = refund;
          return;
        }
        if (!refund.reservationReleasedAt) {
          const attempt = await PaymentAttempt.findById(refund.paymentAttemptId).session(session);
          if (!attempt) throw notFound("Payment attempt");
          attempt.refundReservedAmountPaise = Math.max(
            0,
            Number(attempt.refundReservedAmountPaise || 0) - Number(refund.amountPaise),
          );
          await attempt.save({ session });
          refund.reservationReleasedAt = now;
        }
        refund.state = "failed";
        refund.providerStatus = "failed";
        refund.failedAt ||= now;
        refund.lastProviderCheckAt = now;
        result = await refund.save({ session });
      });
    } finally {
      await session.endSession();
    }
    return result;
  }
  const refund = memoryStore.get("refundAttempts", refundId);
  if (!refund) throw notFound("Refund");
  if (refund.state === "processed") return refund;
  if (!refund.reservationReleasedAt) {
    const attempt = memoryStore.get("paymentAttempts", refund.paymentAttemptId);
    if (!attempt) throw notFound("Payment attempt");
    memoryStore.update("paymentAttempts", attempt.id, {
      refundReservedAmountPaise: Math.max(
        0,
        Number(attempt.refundReservedAmountPaise || 0) - Number(refund.amountPaise),
      ),
    });
  }
  return memoryStore.update("refundAttempts", refundId, {
    state: "failed",
    providerStatus: "failed",
    failedAt: refund.failedAt || now,
    lastProviderCheckAt: now,
    reservationReleasedAt: refund.reservationReleasedAt || now,
  });
};

const ensureProviderRefund = async (refund, mode) => {
  const wasProcessed = refund.state === "processed";
  let result;
  try {
    result = await createRazorpayRefund(
      refund.providerPaymentId,
      {
        amount: refund.amountPaise,
        speed: "normal",
        receipt: refund.receipt,
        notes: { order_id: refund.orderId },
      },
      refund.idempotencyKey,
    );
  } catch (error) {
    if (!isAmbiguousRazorpayError(error)) await markRefundFailed(String(refund.id || refund._id), mode);
    throw error;
  }
  if (
    !/^rfnd_[A-Za-z0-9]+$/.test(String(result?.id || "")) ||
    String(result.payment_id || "") !== String(refund.providerPaymentId) ||
    Number(result.amount) !== Number(refund.amountPaise) ||
    (result.currency && result.currency !== refund.currency) ||
    (result.receipt && result.receipt !== refund.receipt)
  ) {
    await markPaymentAttention(
      String(refund.paymentAttemptId),
      mode,
      "review_required",
      "provider_refund_mismatch",
    );
    throw new AppError(409, "REFUND_VERIFICATION_FAILED", "Razorpay refund details do not match");
  }
  let updated = await updateRefundProviderResult(refund, result, mode);
  let refundBecameProcessed = false;
  if (result.status === "processed") {
    const transition = await recomputeRefundState(String(updated.id || updated._id), mode);
    updated = transition.refund;
    refundBecameProcessed = !wasProcessed || transition.refundBecameProcessed;
  } else if (result.status === "failed") {
    await markRefundFailed(String(updated.id || updated._id), mode);
    throw new AppError(409, "REFUND_FAILED", "Razorpay could not process this refund request");
  }
  return { refund: updated, refundBecameProcessed };
};

export const createAdminRefund = async (orderId, input, adminUser, idempotencyKey) => {
  requireRazorpayApiConfig();
  const mode = await writableMode();
  const order = await findInternalOrder(orderId, mode);
  if (!order) throw notFound("Order");
  const internalId = String(order.id || order._id);
  const attempt = await attemptForOrder(internalId, mode, { includeSecrets: true });
  const existing = await refundForIdempotency(internalId, idempotencyKey, mode);
  if (existing) {
    const replayAmount = input.amountPaise || existing.amountPaise;
    const replayHash = refundRequestHash({
      orderId: internalId,
      amountPaise: replayAmount,
      reason: input.reason,
    });
    if (existing.requestHash !== replayHash) throw idempotencyKeyReused();
    if (existing.state === "failed") {
      throw conflict("This refund request was rejected. Review it and use a new Idempotency-Key");
    }
    const transition = existing.providerRefundId
      ? { refund: existing, refundBecameProcessed: false }
      : await ensureProviderRefund(plain(existing), mode);
    return {
      order: await getOrder(internalId),
      payment: publicPayment(await attemptForOrder(internalId, mode)),
      refund: publicRefund(transition.refund),
      refundCreated: false,
      refundBecameProcessed: transition.refundBecameProcessed,
    };
  }
  const refundableCancelledCapture =
    attempt?.state === "review_required" &&
    attempt.attentionReason === "captured_after_cancellation" &&
    attempt.providerPaymentStatus === "captured" &&
    attempt.capturedAt;
  if (
    !attempt?.providerPaymentId ||
    (!["paid", "partially_refunded"].includes(attempt.state) && !refundableCancelledCapture)
  ) {
    throw conflict("Only a captured Razorpay payment can be refunded");
  }
  const reservations = await refundsForOrder(internalId, mode);
  const recordedReserved = reservations
    .filter((refund) => activeRefundStates.has(refund.state))
    .reduce((sum, refund) => sum + Number(refund.amountPaise || 0), 0);
  const reserved = Math.max(
    recordedReserved,
    Number(attempt.refundReservedAmountPaise || 0),
  );
  const remaining = Number(attempt.amountPaise) - reserved;
  const amountPaise = input.amountPaise ?? remaining;
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > remaining) {
    throw badRequest("Refund amount exceeds the captured amount still available");
  }
  const requestHash = refundRequestHash({ orderId: internalId, amountPaise, reason: input.reason });
  const record = {
    orderId: internalId,
    paymentAttemptId: String(attempt.id || attempt._id),
    buyerId: String(order.buyerId),
    createdBy: String(adminUser.id),
    idempotencyKey,
    requestHash,
    receipt: refundReceipt(order.orderNumber, idempotencyKey),
    providerPaymentId: attempt.providerPaymentId,
    amountPaise,
    currency: "INR",
    reason: input.reason,
    state: "creating",
  };
  let refund;
  let refundCreated = true;
  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const duplicate = await refundForIdempotency(internalId, idempotencyKey, mode, { session });
        if (duplicate) {
          if (duplicate.requestHash !== requestHash) throw idempotencyKeyReused();
          refund = duplicate;
          refundCreated = false;
          return;
        }
        const freshAttempt = await PaymentAttempt.findById(attempt.id || attempt._id).session(session);
        const freshCancelledCapture =
          freshAttempt?.state === "review_required" &&
          freshAttempt.attentionReason === "captured_after_cancellation" &&
          freshAttempt.providerPaymentStatus === "captured" &&
          freshAttempt.capturedAt;
        if (
          !freshAttempt ||
          (!["paid", "partially_refunded"].includes(freshAttempt.state) && !freshCancelledCapture)
        ) {
          throw conflict("Only a captured Razorpay payment can be refunded");
        }
        const activeReservations = await RefundAttempt.find({
          orderId: internalId,
          state: { $in: [...activeRefundStates] },
        }).session(session);
        const freshReserved = Math.max(
          Number(freshAttempt.refundReservedAmountPaise || 0),
          activeReservations.reduce(
            (sum, item) => sum + Number(item.amountPaise || 0),
            0,
          ),
        );
        if (freshReserved + amountPaise > Number(freshAttempt.amountPaise)) {
          throw conflict("The refundable balance changed. Refresh the order and retry safely");
        }
        freshAttempt.refundReservedAmountPaise = freshReserved + amountPaise;
        await freshAttempt.save({ session });
        [refund] = await RefundAttempt.create([record], { session });
      });
    } finally {
      await session.endSession();
    }
  } else {
    const duplicate = memoryStore.findOne(
      "refundAttempts",
      (item) => item.orderId === internalId && item.idempotencyKey === idempotencyKey,
    );
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) throw idempotencyKeyReused();
      refund = duplicate;
      refundCreated = false;
    } else {
      const freshAttempt = memoryStore.get("paymentAttempts", String(attempt.id || attempt._id));
      const freshCancelledCapture =
        freshAttempt?.state === "review_required" &&
        freshAttempt.attentionReason === "captured_after_cancellation" &&
        freshAttempt.providerPaymentStatus === "captured" &&
        freshAttempt.capturedAt;
      if (
        !freshAttempt ||
        (!["paid", "partially_refunded"].includes(freshAttempt.state) && !freshCancelledCapture)
      ) {
        throw conflict("Only a captured Razorpay payment can be refunded");
      }
      const freshReserved = Math.max(
        Number(freshAttempt.refundReservedAmountPaise || 0),
        memoryStore
          .find(
            "refundAttempts",
            (item) => item.orderId === internalId && activeRefundStates.has(item.state),
          )
          .reduce((sum, item) => sum + Number(item.amountPaise || 0), 0),
      );
      if (freshReserved + amountPaise > Number(freshAttempt.amountPaise)) {
        throw conflict("The refundable balance changed. Refresh the order and retry safely");
      }
      memoryStore.update("paymentAttempts", freshAttempt.id, {
        refundReservedAmountPaise: freshReserved + amountPaise,
      });
      try {
        refund = memoryStore.create("refundAttempts", record);
      } catch (error) {
        memoryStore.update("paymentAttempts", freshAttempt.id, {
          refundReservedAmountPaise: freshReserved,
        });
        throw error;
      }
    }
  }
  const transition = await ensureProviderRefund(plain(refund), mode);
  return {
    order: await getOrder(internalId),
    payment: publicPayment(await attemptForOrder(internalId, mode)),
    refund: publicRefund(transition.refund),
    refundCreated,
    refundBecameProcessed: transition.refundBecameProcessed,
  };
};

const webhookEventClaim = async ({ eventId, eventType, payloadHash, entities, payload }, mode) => {
  const existing = mode === "mongodb"
    ? await RazorpayWebhookEvent.findOne({ eventId })
    : memoryStore.findOne("razorpayWebhookEvents", (event) => event.eventId === eventId);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new AppError(400, "WEBHOOK_EVENT_MISMATCH", "Webhook event identifier was reused");
    }
    if (["processed", "ignored"].includes(existing.outcome)) return { event: existing, duplicate: true };
    if (existing.outcome === "processing") {
      const leaseExpired =
        !existing.updatedAt ||
        Date.now() - new Date(existing.updatedAt).getTime() >= webhookProcessingLeaseMs;
      if (!leaseExpired) throw conflict("This webhook event is already being processed");
      const changes = {
        outcome: "processing",
        resultCode: "",
        processedAt: null,
        updatedAt: new Date(),
      };
      if (mode === "mongodb") {
        const staleBefore = new Date(Date.now() - webhookProcessingLeaseMs);
        const reclaimed = await RazorpayWebhookEvent.findOneAndUpdate(
          {
            _id: existing.id || existing._id,
            outcome: "processing",
            $or: [{ updatedAt: { $lte: staleBefore } }, { updatedAt: { $exists: false } }],
          },
          { $set: changes },
          { new: true },
        );
        if (!reclaimed) throw conflict("This webhook event is already being processed");
        return { event: reclaimed, duplicate: false };
      }
      const current = memoryStore.get("razorpayWebhookEvents", existing.id);
      if (
        !current ||
        current.outcome !== "processing" ||
        (current.updatedAt &&
          Date.now() - new Date(current.updatedAt).getTime() < webhookProcessingLeaseMs)
      ) {
        throw conflict("This webhook event is already being processed");
      }
      return {
        event: memoryStore.update("razorpayWebhookEvents", current.id, changes),
        duplicate: false,
      };
    }
    const changes = { outcome: "processing", resultCode: "", processedAt: null };
    const event = mode === "mongodb"
      ? await RazorpayWebhookEvent.findByIdAndUpdate(existing.id, { $set: changes }, { new: true })
      : memoryStore.update("razorpayWebhookEvents", existing.id, changes);
    return { event, duplicate: false };
  }
  const record = {
    eventId,
    eventType,
    payloadHash,
    providerOrderId: String(entities.payment?.order_id || entities.order?.id || ""),
    providerPaymentId: String(entities.payment?.id || entities.dispute?.payment_id || ""),
    providerRefundId: String(entities.refund?.id || ""),
    providerCreatedAt: Number(payload.created_at) > 0
      ? new Date(Number(payload.created_at) * 1_000)
      : null,
    outcome: "processing",
  };
  try {
    const event = mode === "mongodb"
      ? await RazorpayWebhookEvent.create(record)
      : memoryStore.create("razorpayWebhookEvents", record);
    return { event, duplicate: false };
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    return webhookEventClaim({ eventId, eventType, payloadHash, entities, payload }, mode);
  }
};

const finishWebhookEvent = async (event, mode, outcome, resultCode) => {
  const changes = { outcome, resultCode, processedAt: new Date() };
  if (mode === "mongodb") {
    return RazorpayWebhookEvent.findByIdAndUpdate(event.id || event._id, { $set: changes }, { new: true });
  }
  return memoryStore.update("razorpayWebhookEvents", event.id, changes);
};

const findAttemptForProviderOrder = async (providerOrderId, mode) => {
  if (!providerOrderId) return null;
  if (mode === "mongodb") return PaymentAttempt.findOne({ providerOrderId });
  return memoryStore.findOne(
    "paymentAttempts",
    (attempt) => attempt.providerOrderId === providerOrderId,
  );
};

const findAttemptForProviderPayment = async (providerPaymentId, mode) => {
  if (!providerPaymentId) return null;
  if (mode === "mongodb") return PaymentAttempt.findOne({ providerPaymentId });
  return memoryStore.findOne(
    "paymentAttempts",
    (attempt) => attempt.providerPaymentId === providerPaymentId,
  );
};

const findRefundForProviderEntity = async (entity, mode) => {
  if (mode === "mongodb") {
    const clauses = [];
    if (entity.id) clauses.push({ providerRefundId: String(entity.id) });
    if (entity.receipt) clauses.push({ receipt: String(entity.receipt) });
    return clauses.length ? RefundAttempt.findOne({ $or: clauses }).select("+idempotencyKey +requestHash") : null;
  }
  return memoryStore.findOne(
    "refundAttempts",
    (refund) =>
      (entity.id && refund.providerRefundId === String(entity.id)) ||
      (entity.receipt && refund.receipt === String(entity.receipt)),
  );
};

const applyRefundWebhook = async (eventType, entity, mode) => {
  const refund = await findRefundForProviderEntity(entity, mode);
  if (!refund) return { ignored: true, refundBecameProcessed: false };
  if (
    !/^rfnd_[A-Za-z0-9]+$/.test(String(entity.id || "")) ||
    (refund.providerRefundId && String(entity.id || "") !== String(refund.providerRefundId)) ||
    Number(entity.amount) !== Number(refund.amountPaise) ||
    (entity.currency && entity.currency !== refund.currency) ||
    String(entity.payment_id || "") !== String(refund.providerPaymentId)
  ) {
    await markPaymentAttention(
      String(refund.paymentAttemptId),
      mode,
      "review_required",
      "provider_refund_mismatch",
    );
    throw new AppError(409, "REFUND_VERIFICATION_FAILED", "Razorpay refund details do not match");
  }
  let updated = refund;
  if (!refund.providerRefundId) {
    const changes = { providerRefundId: String(entity.id), providerStatus: String(entity.status || "") };
    updated = mode === "mongodb"
      ? await RefundAttempt.findByIdAndUpdate(refund.id, { $set: changes }, { new: true })
      : memoryStore.update("refundAttempts", refund.id, changes);
  }
  if (eventType === "refund.processed" || entity.status === "processed") {
    const transition = await recomputeRefundState(String(updated.id || updated._id), mode);
    return { ignored: false, refundBecameProcessed: transition.refundBecameProcessed };
  }
  if (eventType === "refund.failed" || entity.status === "failed") {
    await markRefundFailed(String(updated.id || updated._id), mode);
    return { ignored: false, refundBecameProcessed: false };
  }
  await updateRefundProviderResult(plain(updated), entity, mode);
  return { ignored: false, refundBecameProcessed: false };
};

export const processRazorpayWebhook = async ({ eventId, rawBody, payload }) => {
  const mode = await writableMode();
  const eventType = String(payload?.event || "");
  const entities = {
    payment: payload?.payload?.payment?.entity,
    order: payload?.payload?.order?.entity,
    refund: payload?.payload?.refund?.entity,
    dispute: payload?.payload?.dispute?.entity,
  };
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const claim = await webhookEventClaim({ eventId, eventType, payloadHash, entities, payload }, mode);
  if (claim.duplicate) {
    return {
      duplicate: true,
      becamePaid: false,
      refundBecameProcessed: false,
      attentionRequired: false,
      disputed: false,
      eventType,
    };
  }
  let outcome = "processed";
  let resultCode = "PROCESSED";
  let becamePaid = false;
  let refundBecameProcessed = false;
  let attentionRequired = false;
  let disputed = false;
  try {
    if (["payment.authorized", "payment.captured", "payment.failed", "order.paid"].includes(eventType)) {
      const payment = entities.payment;
      const providerOrderId = String(payment?.order_id || entities.order?.id || "");
      const attempt = await findAttemptForProviderOrder(providerOrderId, mode);
      if (!attempt || !payment) {
        outcome = "ignored";
        resultCode = "UNKNOWN_PAYMENT_ORDER";
      } else {
        const transition = await applyTrustedProviderPayment(plain(attempt), payment, mode);
        becamePaid = transition.becamePaid;
      }
    } else if (eventType === "payment.dispute.created") {
      const providerPaymentId = String(
        entities.dispute?.payment_id || entities.payment?.id || "",
      );
      let attempt = await findAttemptForProviderPayment(providerPaymentId, mode);
      if (!attempt && entities.payment?.order_id) {
        attempt = await findAttemptForProviderOrder(String(entities.payment.order_id), mode);
      }
      if (!attempt) {
        outcome = "ignored";
        resultCode = "UNKNOWN_DISPUTED_PAYMENT";
      } else {
        await markPaymentAttention(
          String(attempt.id || attempt._id),
          mode,
          "disputed",
          "payment_disputed",
        );
        attentionRequired = true;
        disputed = true;
        resultCode = "PAYMENT_DISPUTED";
      }
    } else if (["refund.created", "refund.processed", "refund.failed"].includes(eventType)) {
      if (!entities.refund) {
        outcome = "ignored";
        resultCode = "MISSING_REFUND_ENTITY";
      } else {
        const transition = await applyRefundWebhook(eventType, entities.refund, mode);
        refundBecameProcessed = transition.refundBecameProcessed;
        if (transition.ignored) {
          outcome = "ignored";
          resultCode = "UNKNOWN_REFUND";
        }
      }
    } else {
      outcome = "ignored";
      resultCode = "UNSUPPORTED_EVENT";
    }
    await finishWebhookEvent(claim.event, mode, outcome, resultCode);
    return {
      duplicate: false,
      becamePaid,
      refundBecameProcessed,
      attentionRequired,
      disputed,
      eventType,
    };
  } catch (error) {
    if (["PAYMENT_VERIFICATION_FAILED", "REFUND_VERIFICATION_FAILED"].includes(error?.code)) {
      await finishWebhookEvent(
        claim.event,
        mode,
        "processed",
        error.code === "PAYMENT_VERIFICATION_FAILED"
          ? "PAYMENT_REVIEW_REQUIRED"
          : "REFUND_REVIEW_REQUIRED",
      );
      return {
        duplicate: false,
        becamePaid: false,
        refundBecameProcessed: false,
        attentionRequired: true,
        disputed: false,
        eventType,
      };
    }
    await finishWebhookEvent(claim.event, mode, "failed", error?.code || "PROCESSING_FAILED").catch(() => {});
    throw error;
  }
};

const reconcilePaymentAttempt = async (attempt, mode) => {
  let current = attempt;
  if (!current.providerOrderId) current = await ensureProviderOrder(plain(current), mode);
  const result = await fetchRazorpayOrderPayments(current.providerOrderId);
  const payments = Array.isArray(result?.items) ? result.items : [];
  const captured = payments.find((payment) => payment.status === "captured");
  const authorized = payments.find((payment) => payment.status === "authorized");
  const failed = [...payments].reverse().find((payment) => payment.status === "failed");
  if (captured) return applyTrustedProviderPayment(plain(current), captured, mode);
  if (authorized) return applyTrustedProviderPayment(plain(current), authorized, mode);
  if (failed) return applyTrustedProviderPayment(plain(current), failed, mode);
  if (mode === "mongodb") {
    await PaymentAttempt.updateOne({ _id: current.id || current._id }, { $set: { lastProviderCheckAt: new Date() } });
  } else {
    memoryStore.update("paymentAttempts", current.id, { lastProviderCheckAt: new Date() });
  }
  return { attempt: current, becamePaid: false };
};

const reconcileRefundAttempt = async (refund, mode) => {
  if (!refund.providerRefundId) return ensureProviderRefund(plain(refund), mode);
  const entity = await fetchRazorpayRefund(refund.providerRefundId);
  if (
    String(entity.id || "") !== String(refund.providerRefundId) ||
    Number(entity.amount) !== Number(refund.amountPaise) ||
    (entity.currency && entity.currency !== refund.currency) ||
    String(entity.payment_id || "") !== String(refund.providerPaymentId)
  ) {
    await markPaymentAttention(
      String(refund.paymentAttemptId),
      mode,
      "review_required",
      "provider_refund_mismatch",
    );
    throw new AppError(409, "REFUND_VERIFICATION_FAILED", "Razorpay refund details do not match");
  }
  if (entity.status === "processed") {
    return recomputeRefundState(String(refund.id || refund._id), mode);
  }
  if (entity.status === "failed") {
    return { refund: await markRefundFailed(String(refund.id || refund._id), mode), refundBecameProcessed: false };
  }
  return {
    refund: await updateRefundProviderResult(plain(refund), entity, mode),
    refundBecameProcessed: false,
  };
};

export const reconcileRazorpayPayments = async ({ limit = env.razorpayReconcileBatchSize } = {}) => {
  requireRazorpayApiConfig();
  const mode = await writableMode();
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 1, 50));
  const attemptStates = ["creating", "created", "authorized", "failed", "unknown"];
  const refundStates = ["creating", "pending", "unknown"];
  const attempts = mode === "mongodb"
    ? await PaymentAttempt.find({ state: { $in: attemptStates } })
      .select("+idempotencyKey +requestHash")
      .sort({ lastProviderCheckAt: 1, createdAt: 1 })
      .limit(boundedLimit)
    : memoryStore
      .find("paymentAttempts", (attempt) => attemptStates.includes(attempt.state))
      .sort((left, right) => new Date(left.lastProviderCheckAt || left.createdAt) - new Date(right.lastProviderCheckAt || right.createdAt))
      .slice(0, boundedLimit);
  const refunds = mode === "mongodb"
    ? await RefundAttempt.find({ state: { $in: refundStates } })
      .select("+idempotencyKey +requestHash")
      .sort({ lastProviderCheckAt: 1, createdAt: 1 })
      .limit(boundedLimit)
    : memoryStore
      .find("refundAttempts", (refund) => refundStates.includes(refund.state))
      .sort((left, right) => new Date(left.lastProviderCheckAt || left.createdAt) - new Date(right.lastProviderCheckAt || right.createdAt))
      .slice(0, boundedLimit);
  const summary = {
    paymentAttempts: { checked: 0, becamePaid: 0, failed: 0 },
    refunds: { checked: 0, becameProcessed: 0, failed: 0 },
  };
  for (const attempt of attempts) {
    summary.paymentAttempts.checked += 1;
    try {
      const result = await reconcilePaymentAttempt(plain(attempt), mode);
      if (result.becamePaid) summary.paymentAttempts.becamePaid += 1;
    } catch {
      summary.paymentAttempts.failed += 1;
    }
  }
  for (const refund of refunds) {
    summary.refunds.checked += 1;
    try {
      const result = await reconcileRefundAttempt(plain(refund), mode);
      if (result.refundBecameProcessed) summary.refunds.becameProcessed += 1;
    } catch {
      summary.refunds.failed += 1;
    }
  }
  return summary;
};

export const paymentPublicHelpers = { publicPayment, publicRefund };
