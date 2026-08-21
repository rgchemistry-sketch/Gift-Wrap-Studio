const paidStatuses = new Set(['paid', 'captured']);
const pendingStatuses = new Set(['authorized', 'processing', 'verifying', 'refund_pending']);
const retryableStatuses = new Set(['not_started', 'pending', 'failed']);
const activeRefundStatuses = new Set(['creating', 'pending', 'unknown']);

const finitePaise = (value) => {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
};

export const unwrapPaymentPayload = (result) => {
  const data = result?.data ?? result;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  if (!data.order && !data.payment && !data.refund && !Array.isArray(data.refunds)) return data;

  const order = data.order && typeof data.order === 'object' ? data.order : {};
  const payment = data.payment && typeof data.payment === 'object' ? data.payment : {};
  const refunds = Array.isArray(data.refunds)
    ? data.refunds
    : data.refund && typeof data.refund === 'object'
      ? [data.refund]
      : [];
  const activeRefund = refunds.find((refund) => activeRefundStatuses.has(
    String(refund?.state || '').toLowerCase(),
  ));

  return {
    ...order,
    ...(Object.keys(payment).length ? {
      paymentState: payment.state,
      amountPaise: payment.amountPaise,
      testMode: payment.testMode,
      ...(payment.attentionReason ? { attentionReason: payment.attentionReason } : {}),
      ...(payment.capturedAt ? { capturedAt: payment.capturedAt } : {}),
      refundedAmountPaise: Math.max(
        finitePaise(order.refundedAmountPaise),
        finitePaise(payment.refundedAmountPaise),
      ),
    } : {}),
    ...(refunds.length ? { refunds, refund: activeRefund || refunds[0] } : {}),
    ...(activeRefund ? { refundState: activeRefund.state } : {}),
  };
};

export const normalizePaymentStatus = (value) => {
  const status = String(value || 'not_started').trim().toLowerCase();
  if (status === 'captured') return 'paid';
  if (['creating', 'created', 'payment_pending'].includes(status)) return 'pending';
  if (status === 'partially-refunded') return 'partially_refunded';
  return status || 'not_started';
};

export const paymentStatusLabel = (value) => ({
  not_started: 'Not started',
  pending: 'Awaiting payment',
  authorized: 'Confirming payment',
  processing: 'Confirming payment',
  verifying: 'Verifying securely',
  paid: 'Paid',
  partially_refunded: 'Partially refunded',
  refund_pending: 'Refund in progress',
  refunded: 'Refunded',
  review_required: 'Studio review required',
  disputed: 'Payment disputed',
  failed: 'Payment unsuccessful',
}[normalizePaymentStatus(value)] || String(value || 'Payment update').replaceAll('_', ' '));

export const paymentSnapshot = (order = {}, override = {}) => {
  const merged = { ...order, ...override };
  const paymentQuote = { ...(order.paymentQuote || {}), ...(override.paymentQuote || {}) };
  const quoteAmountPaise = finitePaise(
    paymentQuote.amountPaise
      ?? merged.amountPaise
      ?? merged.payableAmountPaise,
  );
  const refundedAmountPaise = finitePaise(
    merged.refundedAmountPaise
      ?? merged.amountRefundedPaise
      ?? merged.refund?.amountPaise,
  );
  const paymentStatus = normalizePaymentStatus(
    override.paymentStatus
      ?? override.paymentState
      ?? order.paymentStatus
      ?? 'not_started',
  );
  const refundState = String(
    override.refundState
      ?? override.refund?.state
      ?? order.refundState
      ?? '',
  ).toLowerCase();
  const status = activeRefundStatuses.has(refundState) && !['refunded'].includes(paymentStatus)
    ? 'refund_pending'
    : paymentStatus;
  const method = String(override.paymentMethod ?? order.paymentMethod ?? '').toLowerCase();
  const attentionReason = String(
    override.attentionReason
      ?? override.paymentReviewCode
      ?? order.paymentReviewCode
      ?? '',
  ).toLowerCase();
  const hasQuote = quoteAmountPaise > 0;
  const isPaid = paidStatuses.has(status);
  const isRefunded = status === 'refunded';
  const isPartiallyRefunded = status === 'partially_refunded';
  const isSettling = pendingStatuses.has(status);
  const isCapturedAfterCancellation = status === 'review_required'
    && attentionReason === 'captured_after_cancellation';
  const remainingRefundablePaise = Math.max(0, quoteAmountPaise - refundedAmountPaise);
  const orderStatus = String(order.status || merged.orderStatus || '').toLowerCase();
  const explicitlyPayable = typeof merged.canPay === 'boolean' ? merged.canPay : null;
  const canPay = explicitlyPayable ?? (
    hasQuote
      && orderStatus === 'confirmed'
      && !['cancelled', 'delivered'].includes(orderStatus)
      && retryableStatuses.has(status)
  );

  return {
    status,
    label: paymentStatusLabel(status),
    method,
    paymentQuote,
    quoteAmountPaise,
    refundedAmountPaise,
    remainingRefundablePaise,
    hasQuote,
    isPaid,
    isRefunded,
    isPartiallyRefunded,
    isSettling,
    attentionReason,
    isCapturedAfterCancellation,
    refundState,
    refundFailed: refundState === 'failed',
    canPay,
    testMode: Boolean(
      merged.testMode
      ?? merged.isTestMode
      ?? (String(merged.mode || '').toLowerCase() === 'test'),
    ),
  };
};

export const parseRupeesToPaise = (value) => {
  const input = String(value ?? '').trim().replaceAll(',', '');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

export const formatPaiseInput = (amountPaise) => {
  const amount = finitePaise(amountPaise);
  return amount > 0 ? (amount / 100).toFixed(amount % 100 === 0 ? 0 : 2) : '';
};

export const createPaymentIdempotencyKey = (prefix = 'payment') => {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  // Razorpay's refund idempotency header accepts only letters, numbers,
  // hyphens and underscores. Use the same portable alphabet for checkout
  // sessions so one generator is safe for both provider-facing workflows.
  return `${prefix}-${random}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
};

export const isAmbiguousPaymentError = (error) => (
  error?.code === 'TIMEOUT'
  || error?.code === 'NETWORK_ERROR'
  || Number(error?.status) >= 500
);
