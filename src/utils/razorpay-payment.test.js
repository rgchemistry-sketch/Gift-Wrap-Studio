import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCurrency } from '../data/catalog.js';
import {
  createPaymentIdempotencyKey,
  formatPaiseInput,
  normalizePaymentStatus,
  parseRupeesToPaise,
  paymentSnapshot,
  unwrapPaymentPayload,
} from './razorpay-payment.js';

test('generated idempotency keys use Razorpay-safe characters', () => {
  const key = createPaymentIdempotencyKey('refund:studio/order');
  assert.match(key, /^[A-Za-z0-9_-]{10,100}$/);
  assert.doesNotMatch(key, /[.:/]/);
});

test('rupee input becomes exact integer paise without float rounding', () => {
  assert.equal(parseRupeesToPaise('1,299.50'), 129_950);
  assert.equal(parseRupeesToPaise('499'), 49_900);
  assert.equal(parseRupeesToPaise('10.5'), 1_050);
  assert.equal(parseRupeesToPaise('10.005'), null);
  assert.equal(parseRupeesToPaise('0'), null);
  assert.equal(formatPaiseInput(129_950), '1299.50');
  assert.match(formatCurrency(1299.51), /1,299\.51/);
});

test('payment snapshots keep fulfilment, payment and refund states separate', () => {
  const quoted = paymentSnapshot({
    status: 'confirmed',
    paymentStatus: 'pending',
    paymentMethod: 'razorpay',
    paymentQuote: { amountPaise: 250_000, currency: 'INR' },
  });
  assert.equal(quoted.canPay, true);
  assert.equal(quoted.quoteAmountPaise, 250_000);

  const refunded = paymentSnapshot({
    status: 'confirmed',
    paymentStatus: 'partially_refunded',
    paymentQuote: { amountPaise: 250_000 },
    refundedAmountPaise: 50_000,
  });
  assert.equal(refunded.canPay, false);
  assert.equal(refunded.remainingRefundablePaise, 200_000);
  assert.equal(refunded.isPartiallyRefunded, true);
  assert.equal(normalizePaymentStatus('captured'), 'paid');
});

test('payment responses unwrap either an order or a payment record', () => {
  assert.deepEqual(unwrapPaymentPayload({ data: { order: { id: 'order-1' } } }), { id: 'order-1' });
  assert.deepEqual(
    unwrapPaymentPayload({ data: { payment: { state: 'paid', amountPaise: 12_500 } } }),
    {
      paymentState: 'paid',
      amountPaise: 12_500,
      testMode: undefined,
      refundedAmountPaise: 0,
    },
  );
});

test('active refunds surface as reconciliation without losing the paid amount', () => {
  const record = unwrapPaymentPayload({
    data: {
      order: {
        id: 'order-1',
        status: 'confirmed',
        paymentStatus: 'paid',
        paymentQuote: { amountPaise: 80_000 },
      },
      payment: { state: 'paid', refundedAmountPaise: 0 },
      refunds: [{ id: 'refund-1', state: 'pending', amountPaise: 20_000 }],
    },
  });
  const snapshot = paymentSnapshot(record);
  assert.equal(snapshot.status, 'refund_pending');
  assert.equal(snapshot.isSettling, true);
  assert.equal(snapshot.canPay, false);
});

test('a late capture after cancellation is surfaced as refundable manual attention', () => {
  const snapshot = paymentSnapshot({
    status: 'cancelled',
    paymentStatus: 'review_required',
    paymentReviewCode: 'captured_after_cancellation',
    paymentQuote: { amountPaise: 42_000 },
  });
  assert.equal(snapshot.isCapturedAfterCancellation, true);
  assert.equal(snapshot.canPay, false);
  assert.equal(snapshot.remainingRefundablePaise, 42_000);
});
