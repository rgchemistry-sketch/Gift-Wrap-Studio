import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { api } from './client.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
});

test('Razorpay session records payment-time policy consent and identity headers', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({ data: { razorpayOrderId: 'order_secure' } }, 201);
  };

  await api.createRazorpayPaymentSession(
    'studio-order-1',
    'checkout:stable-key',
    'buyer-1',
    { accepted: true, version: '2026-08-21' },
  );

  assert.equal(request.url, '/api/payments/razorpay/orders/studio-order-1/session');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.get('Idempotency-Key'), 'checkout:stable-key');
  assert.equal(request.options.headers.get('X-Expected-User-Id'), 'buyer-1');
  assert.deepEqual(JSON.parse(request.options.body), {
    policyConsent: { accepted: true, version: '2026-08-21' },
  });
});

test('Razorpay confirmation sends only signed callback fields in the body', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({ data: { order: { paymentStatus: 'paid' } } });
  };
  const payload = {
    orderId: 'studio-order-1',
    razorpayOrderId: 'order_secure',
    razorpayPaymentId: 'pay_secure',
    razorpaySignature: 'a'.repeat(64),
  };

  await api.confirmRazorpayPayment(payload, 'buyer-1');

  assert.equal(request.url, '/api/payments/razorpay/confirm');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.get('X-Expected-User-Id'), 'buyer-1');
  assert.deepEqual(JSON.parse(request.options.body), payload);
});
