import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AppError, configurationError } from "../lib/errors.js";

const apiBaseUrl = "https://api.razorpay.com/v1";

class RazorpayProviderError extends AppError {
  constructor(
    message,
    {
      providerStatus = 0,
      providerCode = "",
      ambiguous = false,
      status = 502,
      code = "PAYMENT_PROVIDER_ERROR",
    } = {},
  ) {
    super(status, code, message);
    this.providerStatus = providerStatus;
    this.providerCode = providerCode;
    this.ambiguous = ambiguous;
  }
}

const defaultFetch = (...args) => globalThis.fetch(...args);
let providerFetch = defaultFetch;

export const setRazorpayFetchForTests = (fetchImplementation) => {
  if (!env.isTest) throw new Error("Razorpay test doubles are test-only");
  providerFetch = fetchImplementation;
};

export const resetRazorpayFetchForTests = () => {
  if (!env.isTest) throw new Error("Razorpay test reset is test-only");
  providerFetch = defaultFetch;
};

const keyMatchesMode = () =>
  env.razorpayMode === "test"
    ? env.razorpayKeyId.startsWith("rzp_test_")
    : env.razorpayMode === "live" && env.razorpayKeyId.startsWith("rzp_live_");

export const requireRazorpayApiConfig = () => {
  const missing = [
    ["RAZORPAY_MODE", env.razorpayMode],
    ["RAZORPAY_KEY_ID", env.razorpayKeyId],
    ["RAZORPAY_KEY_SECRET", env.razorpayKeySecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw configurationError(missing);
  if (!keyMatchesMode()) {
    throw new AppError(
      503,
      "SERVICE_MISCONFIGURED",
      "Razorpay mode does not match the configured API key",
    );
  }
};

export const requireRazorpayWebhookConfig = () => {
  if (!env.razorpayWebhookSecret) throw configurationError(["RAZORPAY_WEBHOOK_SECRET"]);
};

export const requireRazorpayPaymentConfig = () => {
  requireRazorpayApiConfig();
  requireRazorpayWebhookConfig();
};

export const razorpayCheckoutConfig = () => {
  requireRazorpayApiConfig();
  return { keyId: env.razorpayKeyId, testMode: env.razorpayMode === "test" };
};

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {};
  }
};

const providerRequest = async (path, { method = "GET", body, headers = {} } = {}) => {
  requireRazorpayApiConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.razorpayApiTimeoutMs);
  let response;
  let payload;
  try {
    response = await providerFetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64")}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    payload = await safeJson(response);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    throw new RazorpayProviderError(
      timedOut
        ? "The payment provider did not respond in time. Please retry safely"
        : "The payment provider could not be reached. Please retry safely",
      { ambiguous: method !== "GET" },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const providerCode = String(payload?.error?.code || "");
    const ambiguous =
      method !== "GET" &&
      (response.status >= 500 || [408, 409, 425, 429].includes(response.status));
    throw new RazorpayProviderError(
      ambiguous
        ? "The payment provider response is uncertain. Retry safely with the same request key"
        : "The payment provider rejected the request",
      {
        providerStatus: response.status,
        providerCode,
        ambiguous,
        status: ambiguous ? 502 : 422,
        code: ambiguous ? "PAYMENT_PROVIDER_ERROR" : "PAYMENT_PROVIDER_REJECTED",
      },
    );
  }
  return payload;
};

export const createRazorpayOrder = ({ amountPaise, currency, receipt, notes }) =>
  providerRequest("/orders", {
    method: "POST",
    body: {
      amount: amountPaise,
      currency,
      receipt,
      partial_payment: false,
      notes,
    },
  });

export const fetchRazorpayOrdersByReceipt = (receipt) =>
  providerRequest(`/orders?receipt=${encodeURIComponent(receipt)}&count=10`);

export const fetchRazorpayPayment = (paymentId) =>
  providerRequest(`/payments/${encodeURIComponent(paymentId)}`);

export const fetchRazorpayOrderPayments = (orderId) =>
  providerRequest(`/orders/${encodeURIComponent(orderId)}/payments`);

export const createRazorpayRefund = (paymentId, payload, idempotencyKey) =>
  providerRequest(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: payload,
    headers: { "X-Refund-Idempotency": idempotencyKey },
  });

export const fetchRazorpayRefund = (refundId) =>
  providerRequest(`/refunds/${encodeURIComponent(refundId)}`);

const timingSafeHexMatch = (expectedHex, suppliedHex) => {
  if (!/^[a-f0-9]{64}$/i.test(String(suppliedHex || ""))) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const supplied = Buffer.from(suppliedHex, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};

export const verifyRazorpayPaymentSignature = ({ providerOrderId, providerPaymentId, signature }) => {
  requireRazorpayApiConfig();
  const expected = createHmac("sha256", env.razorpayKeySecret)
    .update(`${providerOrderId}|${providerPaymentId}`)
    .digest("hex");
  return timingSafeHexMatch(expected, signature);
};

const webhookSignatureMatches = (rawBody, signature, secret) => {
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeHexMatch(expected, signature);
};

export const verifyRazorpayWebhookSignature = (rawBody, signature) => {
  requireRazorpayWebhookConfig();
  return (
    webhookSignatureMatches(rawBody, signature, env.razorpayWebhookSecret) ||
    webhookSignatureMatches(rawBody, signature, env.razorpayWebhookSecretPrevious)
  );
};

export const isAmbiguousRazorpayError = (error) => Boolean(error?.ambiguous);
