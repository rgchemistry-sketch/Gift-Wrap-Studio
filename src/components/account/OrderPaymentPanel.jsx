import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { formatCurrency } from '../../data/catalog';
import Icon from '../Icon';
import { loadRazorpayCheckout } from '../../utils/razorpay-checkout';
import {
  createPaymentIdempotencyKey,
  isAmbiguousPaymentError,
  paymentSnapshot,
  unwrapPaymentPayload,
} from '../../utils/razorpay-payment';

const paymentUnavailable = (error) => [404, 501, 503].includes(Number(error?.status));
const moneyFromPaise = (amountPaise) => formatCurrency(Number(amountPaise || 0) / 100);
const PAYMENT_POLICY_VERSION = '2026-08-21';

const sessionDetails = (result) => {
  const data = result?.data ?? result ?? {};
  const session = data.session || data.checkout || data;
  return {
    keyId: session.keyId || session.razorpayKeyId || session.key || '',
    razorpayOrderId: session.razorpayOrderId || session.orderId || session.order_id || '',
    amountPaise: Number(session.amountPaise ?? session.amount ?? 0),
    currency: session.currency || 'INR',
    businessName: session.businessName || session.name || 'Gift N Wrap Studio',
    description: session.description || 'Handmade studio order',
    image: session.image || '',
    prefill: session.prefill || {},
    notes: session.notes || {},
    testMode: Boolean(
      session.testMode
      ?? session.isTestMode
      ?? (
        String(session.mode || '').toLowerCase() === 'test'
        || String(session.keyId || session.razorpayKeyId || session.key || '').startsWith('rzp_test_')
      ),
    ),
  };
};

const paymentStateCopy = (snapshot, phase) => {
  if (phase === 'verifying') return 'Razorpay returned securely. We are verifying the signature and captured amount before confirming anything.';
  if (phase === 'reconciling' || snapshot.isSettling) return 'The payment is being reconciled securely. You can leave this page; the verified result will remain with your order.';
  if (snapshot.refundFailed) return 'Your payment remains verified, but the latest refund request was not processed. Please contact the studio before taking another action.';
  if (snapshot.isRefunded) return 'This payment has been refunded to its original payment method.';
  if (snapshot.isPartiallyRefunded) return `${moneyFromPaise(snapshot.refundedAmountPaise)} has been returned to the original payment method.`;
  if (snapshot.isPaid) return 'Payment is verified. Your order can now move through the studio.';
  if (snapshot.isCapturedAfterCancellation) return 'A payment was captured after this order was cancelled. The studio must return it to the original payment method; please do not pay again.';
  if (snapshot.status === 'disputed') return 'This payment is under dispute and needs studio review. Your order will not move forward from this status.';
  if (snapshot.status === 'review_required') return 'The payment record needs a secure studio review. Please do not pay again while this message is shown.';
  if (snapshot.status === 'failed') return 'The previous attempt was not completed. Your order is still safe, and you can try again.';
  return 'Your design and total are confirmed. Complete payment through Razorpay when you are ready.';
};

export default function OrderPaymentPanel({ order, userId, onOrderChange }) {
  const headingId = useId();
  const orderId = String(order?.id || order?._id || order?.orderNumber || '');
  const [paymentRecord, setPaymentRecord] = useState({});
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const attemptKeyRef = useRef('');
  const mountedRef = useRef(true);
  const snapshot = useMemo(
    () => paymentSnapshot(order, paymentRecord),
    [order, paymentRecord],
  );
  const shouldRender = snapshot.hasQuote || snapshot.method === 'razorpay';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshPayment = useCallback(async ({ quiet = false } = {}) => {
    if (!orderId) return null;
    if (!quiet) setRefreshing(true);
    try {
      const result = await api.getOrderPayment(orderId);
      const next = unwrapPaymentPayload(result);
      if (!mountedRef.current) return next;
      setPaymentRecord((current) => ({ ...current, ...next }));
      setTestMode((current) => Boolean(current || next.testMode || next.isTestMode));
      if (!quiet) {
        setError('');
        setNotice('Payment status refreshed from the secure server record.');
      }
      return next;
    } catch (requestError) {
      if (!mountedRef.current) return null;
      if (!quiet || paymentUnavailable(requestError)) {
        setError(paymentUnavailable(requestError)
          ? 'Secure online payment is not available in this deployment yet. Your order has not changed; please contact the studio if you need help.'
          : `${requestError.message} No payment state was changed.`);
      }
      return null;
    } finally {
      if (mountedRef.current && !quiet) setRefreshing(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!shouldRender) return undefined;
    void refreshPayment({ quiet: true });
    return undefined;
  }, [refreshPayment, shouldRender]);

  useEffect(() => {
    const shouldPoll = phase === 'verifying'
      || phase === 'reconciling'
      || snapshot.isSettling;
    if (!shouldPoll) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshPayment({ quiet: true });
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [phase, refreshPayment, snapshot.isSettling]);

  const confirmPayment = useCallback(async (session, response) => {
    if (!mountedRef.current) return;
    setPhase('verifying');
    setError('');
    setNotice('');
    try {
      const result = await api.confirmRazorpayPayment(
        {
          orderId,
          razorpayOrderId: response.razorpay_order_id || session.razorpayOrderId,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        },
        userId,
      );
      const next = unwrapPaymentPayload(result);
      if (!mountedRef.current) return;
      setPaymentRecord((current) => ({ ...current, ...next }));
      const verified = paymentSnapshot(order, next);
      setPhase(verified.isPaid ? 'complete' : 'reconciling');
      setNotice(verified.isPaid
        ? 'Payment verified. Thank you—your secure receipt now belongs to this order.'
        : 'Payment received for verification. We are reconciling the captured status now.');
      onOrderChange?.();
    } catch (requestError) {
      if (!mountedRef.current) return;
      setPhase('reconciling');
      setError(`${requestError.message} Do not pay again yet—refresh the verified status first.`);
      void refreshPayment({ quiet: true });
    }
  }, [onOrderChange, order, orderId, refreshPayment, userId]);

  const startPayment = async () => {
    if (!orderId || !snapshot.canPay) return;
    setPhase('loading');
    setError('');
    setNotice('');
    try {
      const RazorpayCheckout = await loadRazorpayCheckout();
      if (!attemptKeyRef.current) {
        attemptKeyRef.current = createPaymentIdempotencyKey(`checkout:${orderId}`);
      }
      const result = await api.createRazorpayPaymentSession(
        orderId,
        attemptKeyRef.current,
        userId,
        { accepted: true, version: PAYMENT_POLICY_VERSION },
      );
      const session = sessionDetails(result);
      if (
        !session.keyId
        || !session.razorpayOrderId
        || !Number.isSafeInteger(session.amountPaise)
        || session.amountPaise <= 0
      ) {
        throw new Error('The secure payment session was incomplete. No payment was started.');
      }
      setTestMode(session.testMode);

      const checkout = new RazorpayCheckout({
        key: session.keyId,
        amount: session.amountPaise,
        currency: session.currency,
        name: session.businessName,
        description: session.description,
        ...(session.image ? { image: session.image } : {}),
        order_id: session.razorpayOrderId,
        prefill: session.prefill,
        notes: session.notes,
        theme: { color: '#6d1f35' },
        retry: { enabled: true },
        handler: (response) => void confirmPayment(session, response),
        modal: {
          escape: true,
          ondismiss: () => {
            if (!mountedRef.current) return;
            setPhase('idle');
            setError('');
            setNotice('Checkout was closed. Nothing has been marked paid or failed; you can return whenever you are ready.');
            void refreshPayment({ quiet: true });
          },
        },
      });
      checkout.on?.('payment.failed', () => {
        if (!mountedRef.current) return;
        setPhase('idle');
        setError('That payment attempt was not completed. No new payment has been confirmed; refresh the status before trying again.');
        void refreshPayment({ quiet: true });
      });
      checkout.open();
      attemptKeyRef.current = '';
      setPhase('open');
    } catch (requestError) {
      if (!mountedRef.current) return;
      if (!isAmbiguousPaymentError(requestError)) attemptKeyRef.current = '';
      setPhase('idle');
      setError(paymentUnavailable(requestError)
        ? 'Secure online payment is not available in this deployment yet. Your order is unchanged.'
        : `${requestError.message || 'Secure checkout could not start.'} No payment was confirmed.`);
    }
  };

  if (!shouldRender) return null;

  const busy = ['loading', 'verifying'].includes(phase);
  const statusClass = snapshot.isPaid
    ? 'is-paid'
    : snapshot.isRefunded || snapshot.isPartiallyRefunded
      ? 'is-refunded'
      : snapshot.status === 'failed'
        ? 'is-failed'
        : snapshot.isSettling || phase === 'verifying' || phase === 'reconciling'
          ? 'is-processing'
          : ['review_required', 'disputed'].includes(snapshot.status)
            ? 'is-failed'
          : 'is-due';

  return (
    <section className={`order-payment ${statusClass}`} aria-labelledby={headingId} aria-busy={busy}>
      <div className="order-payment__seal" aria-hidden="true"><Icon name={snapshot.isPaid ? 'check' : 'card'} size={23} /></div>
      <div className="order-payment__body">
        <div className="order-payment__heading">
          <div><p className="eyebrow">Secure payment</p><h3 id={headingId}>{snapshot.isPaid ? 'Payment received' : snapshot.isCapturedAfterCancellation ? 'Refund review required' : 'Your confirmed studio quote'}</h3></div>
          <span className={`payment-state ${statusClass}`}><i aria-hidden="true" />{phase === 'verifying' ? 'Verifying securely' : snapshot.isCapturedAfterCancellation ? 'Captured after cancellation' : snapshot.label}</span>
        </div>
        <div className="order-payment__quote">
          <p><small>{snapshot.isPaid ? 'Paid amount' : 'Amount due'}</small><strong>{moneyFromPaise(snapshot.quoteAmountPaise)}</strong></p>
          <span>INR · {testMode || snapshot.testMode ? 'Test mode' : 'Razorpay secure checkout'}</span>
        </div>
        {snapshot.paymentQuote.note && <p className="order-payment__note">“{snapshot.paymentQuote.note}”</p>}
        <p className="order-payment__copy">{paymentStateCopy(snapshot, phase)}</p>
        {snapshot.refundedAmountPaise > 0 && (
          <div className="order-payment__refund"><span>Returned to original method</span><strong>{moneyFromPaise(snapshot.refundedAmountPaise)}</strong></div>
        )}
        {testMode || snapshot.testMode ? <div className="payment-test-label" role="status"><Icon name="alert" size={15} /><span><strong>Test mode only.</strong> No real money will move in this checkout.</span></div> : null}
        <div className="order-payment__messages" aria-live="polite" aria-atomic="true">
          {error && <Alert variant="warning"><Icon name="alert" size={16} /><span>{error}</span></Alert>}
          {!error && snapshot.refundFailed && <Alert variant="warning"><Icon name="alert" size={16} /><span>The most recent refund attempt was not processed. Your original payment record remains intact.</span></Alert>}
          {!error && notice && <Alert variant="success"><Icon name="check" size={16} /><span>{notice}</span></Alert>}
        </div>
        {snapshot.canPay && (
          <p className="order-payment__consent">
            By choosing <strong>Pay securely</strong>, you confirm this frozen amount and consent to sharing the personal and transaction data needed for Razorpay to process, protect and reconcile the payment. See our <Link to="/terms-and-conditions" target="_blank" rel="noreferrer">Terms</Link>, <Link to="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</Link> and <Link to="/cancellation-and-refund-policy" target="_blank" rel="noreferrer">Cancellation &amp; Refund Policy</Link>.
          </p>
        )}
        <div className="order-payment__actions">
          {snapshot.canPay && (
            <Button type="button" className="button-burgundy" disabled={busy || phase === 'open'} onClick={startPayment}>
              {phase === 'loading' ? <><Spinner size="sm" /> Preparing secure checkout…</> : <>Pay securely · {moneyFromPaise(snapshot.quoteAmountPaise)} <Icon name="lock" size={15} /></>}
            </Button>
          )}
          {(snapshot.isSettling || phase === 'reconciling' || phase === 'verifying' || error) && (
            <Button type="button" variant="outline-dark" disabled={refreshing || phase === 'verifying'} onClick={() => void refreshPayment()}>
              {refreshing ? <><Spinner size="sm" /> Refreshing…</> : <><Icon name="refresh" size={15} /> Refresh payment status</>}
            </Button>
          )}
        </div>
        <p className="order-payment__safety"><Icon name="shield" size={14} /> Payment details are entered in Razorpay’s hosted checkout. Gift N Wrap Studio never asks for your CVV, UPI PIN or OTP.</p>
      </div>
    </section>
  );
}
