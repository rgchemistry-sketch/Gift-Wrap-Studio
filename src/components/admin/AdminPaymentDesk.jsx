import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import { api } from '../../api/client';
import { formatCurrency } from '../../data/catalog';
import {
  createPaymentIdempotencyKey,
  formatPaiseInput,
  isAmbiguousPaymentError,
  parseRupeesToPaise,
  paymentSnapshot,
  unwrapPaymentPayload,
} from '../../utils/razorpay-payment';
import Icon from '../Icon';

const moneyFromPaise = (amountPaise) => formatCurrency(Number(amountPaise || 0) / 100);
const backendUnavailable = (error) => [404, 501, 503].includes(Number(error?.status));

const safeActionError = (error, action) => (
  backendUnavailable(error)
    ? `Razorpay ${action} controls are not available in this deployment. Nothing was changed.`
    : `${error?.message || `The ${action} could not be completed.`} Nothing was changed.`
);

export default function AdminPaymentDesk({ order, onChanged }) {
  const orderId = String(order?.id || order?._id || order?.orderNumber || '');
  const [paymentRecord, setPaymentRecord] = useState({});
  const snapshot = useMemo(
    () => paymentSnapshot(order, paymentRecord),
    [order, paymentRecord],
  );
  const fallbackAmountPaise = parseRupeesToPaise(String(order?.total ?? '')) || 0;
  const paidAmountPaise = snapshot.quoteAmountPaise || fallbackAmountPaise;
  const remainingRefundablePaise = Math.max(
    0,
    paidAmountPaise - snapshot.refundedAmountPaise,
  );
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [refundMode, setRefundMode] = useState('full');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundError, setRefundError] = useState('');
  const [refundReview, setRefundReview] = useState(null);
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const refundKeyRef = useRef('');

  useEffect(() => {
    setPaymentRecord({});
    refundKeyRef.current = '';
  }, [orderId]);

  useEffect(() => {
    setQuoteAmount(formatPaiseInput(snapshot.quoteAmountPaise || fallbackAmountPaise));
    setQuoteNote(snapshot.paymentQuote.note || '');
    setRefundAmount(formatPaiseInput(remainingRefundablePaise));
    setQuoteError('');
    setRefundError('');
    setRefundReview(null);
  }, [fallbackAmountPaise, orderId, remainingRefundablePaise, snapshot.paymentQuote.note, snapshot.quoteAmountPaise]);

  const publishQuote = async (event) => {
    event.preventDefault();
    const amountPaise = parseRupeesToPaise(quoteAmount);
    if (!amountPaise || amountPaise < 100 || amountPaise > 1_000_000_000) {
      setQuoteError('Enter a valid amount from ₹1 to ₹1,00,00,000, with no more than two decimal places.');
      return;
    }
    if (String(order.status || '') !== 'confirmed') {
      setQuoteError('Move this order to Confirmed before publishing a payment quote.');
      return;
    }
    setQuoteSubmitting(true);
    setQuoteError('');
    setNotice('');
    try {
      const result = await api.publishAdminPaymentQuote(orderId, {
        amountPaise,
        note: quoteNote.trim(),
      });
      const next = unwrapPaymentPayload(result);
      setPaymentRecord(next);
      setNotice(`Frozen payment quote published for ${moneyFromPaise(amountPaise)}. The customer can now pay from their account.`);
      onChanged?.(next);
    } catch (requestError) {
      setQuoteError(safeActionError(requestError, 'quote'));
    } finally {
      setQuoteSubmitting(false);
    }
  };

  const reviewRefund = (event) => {
    event.preventDefault();
    const amountPaise = refundMode === 'full'
      ? remainingRefundablePaise
      : parseRupeesToPaise(refundAmount);
    if (!amountPaise || amountPaise < 100 || amountPaise > remainingRefundablePaise) {
      setRefundError(`Enter an amount from ₹1 to ${moneyFromPaise(remainingRefundablePaise)}.`);
      return;
    }
    if (refundReason.trim().length < 5) {
      setRefundError('Add a clear refund reason of at least 5 characters for the payment record.');
      return;
    }
    setRefundError('');
    setRefundReview({ amountPaise, reason: refundReason.trim() });
  };

  const confirmRefund = async () => {
    if (!refundReview || !orderId) return;
    setRefundSubmitting(true);
    setRefundError('');
    setNotice('');
    if (!refundKeyRef.current) {
      refundKeyRef.current = createPaymentIdempotencyKey(`refund:${orderId}`);
    }
    try {
      const result = await api.refundAdminOrderPayment(
        orderId,
        { amountPaise: refundReview.amountPaise, reason: refundReview.reason },
        refundKeyRef.current,
      );
      const next = unwrapPaymentPayload(result);
      setPaymentRecord(next);
      const returnedRefund = next.refund || next.refunds?.[0];
      if (String(returnedRefund?.state || '').toLowerCase() === 'failed') {
        refundKeyRef.current = '';
        setRefundReview(null);
        setRefundError('Razorpay did not accept this refund request. Verify the payment record before deliberately creating a new refund request.');
        onChanged?.(next);
        return;
      }
      refundKeyRef.current = '';
      setRefundReview(null);
      setRefundReason('');
      setNotice(`Refund requested for ${moneyFromPaise(refundReview.amountPaise)}. Final bank processing will be reconciled from Razorpay.`);
      onChanged?.(next);
    } catch (requestError) {
      if (!isAmbiguousPaymentError(requestError)) refundKeyRef.current = '';
      setRefundReview(null);
      setRefundError(
        isAmbiguousPaymentError(requestError)
          ? `${requestError.message || 'The provider response was interrupted.'} Check the verified payment record before retrying this refund.`
          : safeActionError(requestError, 'refund'),
      );
    } finally {
      setRefundSubmitting(false);
    }
  };

  const canPublishQuote = String(order.status || '') === 'confirmed'
    && !snapshot.hasQuote
    && !snapshot.isPaid
    && !snapshot.isRefunded;
  const canRefund = (snapshot.isPaid || snapshot.isPartiallyRefunded)
    || snapshot.isCapturedAfterCancellation;
  const hasRefundableBalance = canRefund
    && remainingRefundablePaise >= 100;

  return (
    <section className="admin-payment-desk" aria-labelledby="admin-payment-heading">
      <div className="admin-payment-desk__head">
        <div><p className="eyebrow">Razorpay control desk</p><h3 id="admin-payment-heading">Payment & refunds</h3></div>
        <span className={`payment-state is-${snapshot.status}`}><i aria-hidden="true" />{snapshot.label}</span>
      </div>

      {notice && <Alert variant="success" className="admin-payment-desk__alert"><Icon name="check" size={16} /><span>{notice}</span></Alert>}
      {snapshot.isCapturedAfterCancellation && <Alert variant="danger" className="admin-payment-desk__alert"><Icon name="alert" size={16} /><span>This payment was captured after the order was cancelled. Keep the order stopped and return the captured balance to the original payment method.</span></Alert>}
      {snapshot.refundFailed && <Alert variant="warning" className="admin-payment-desk__alert"><Icon name="alert" size={16} /><span>The latest refund request was not processed. Verify the provider record before deliberately trying again.</span></Alert>}

      {snapshot.hasQuote ? (
        <div className="admin-payment-quote">
          <span><Icon name="lock" size={16} /> Frozen customer quote</span>
          <strong>{moneyFromPaise(snapshot.quoteAmountPaise)}</strong>
          <small>INR · published {snapshot.paymentQuote.quotedAt ? new Date(snapshot.paymentQuote.quotedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'for this confirmed order'}</small>
          {snapshot.paymentQuote.note && <p>{snapshot.paymentQuote.note}</p>}
        </div>
      ) : canPublishQuote ? (
        <Form className="admin-payment-quote-form" onSubmit={publishQuote} noValidate>
          <p>Publish the exact customer amount only after customization, delivery and any tax treatment are final. This quote becomes the server-owned Razorpay amount.</p>
          <Form.Group controlId={`payment-quote-${orderId}`}>
            <Form.Label>Final amount in INR</Form.Label>
            <div className="admin-money-input"><span aria-hidden="true">₹</span><Form.Control value={quoteAmount} onChange={(event) => { setQuoteAmount(event.target.value); setQuoteError(''); }} inputMode="decimal" autoComplete="off" placeholder="2499.00" isInvalid={Boolean(quoteError)} /></div>
            <Form.Control.Feedback type="invalid">{quoteError}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group controlId={`payment-quote-note-${orderId}`}>
            <Form.Label>Customer-facing quote note <small>optional</small></Form.Label>
            <Form.Control as="textarea" rows={2} maxLength={500} value={quoteNote} onChange={(event) => setQuoteNote(event.target.value)} placeholder="Final design, delivery and inclusions confirmed" />
          </Form.Group>
          {quoteError && !parseRupeesToPaise(quoteAmount) && <p className="admin-payment-field-error" role="alert">{quoteError}</p>}
          <Button type="submit" className="button-burgundy" disabled={quoteSubmitting}>{quoteSubmitting ? <><Spinner size="sm" /> Publishing…</> : <>Publish frozen quote <Icon name="arrow" size={15} /></>}</Button>
        </Form>
      ) : (
        <div className="admin-payment-gate">
          <Icon name="shield" size={19} />
          <p><strong>{String(order.status || '') === 'confirmed' ? 'No quote action is available.' : 'Confirm the order before requesting payment.'}</strong><span>The customer should pay only after the design and final amount are agreed.</span></p>
        </div>
      )}

      {snapshot.hasQuote && (
        <dl className="admin-payment-ledger">
          <div><dt>Quoted</dt><dd>{moneyFromPaise(snapshot.quoteAmountPaise)}</dd></div>
          <div><dt>Returned</dt><dd>{moneyFromPaise(snapshot.refundedAmountPaise)}</dd></div>
          <div><dt>Refundable balance</dt><dd>{moneyFromPaise(remainingRefundablePaise)}</dd></div>
        </dl>
      )}

      {hasRefundableBalance && (
        <Form className="admin-refund-form" onSubmit={reviewRefund} noValidate>
          <div className="admin-refund-form__intro"><Icon name="refresh" size={18} /><p><strong>Return payment to its original method</strong><span>Review the exact amount and reason before sending the request to Razorpay.</span></p></div>
          <div className="admin-refund-mode" role="group" aria-label="Refund amount type">
            <button type="button" aria-pressed={refundMode === 'full'} className={refundMode === 'full' ? 'is-active' : ''} onClick={() => { setRefundMode('full'); setRefundError(''); }}>Full balance</button>
            <button type="button" aria-pressed={refundMode === 'partial'} className={refundMode === 'partial' ? 'is-active' : ''} onClick={() => { setRefundMode('partial'); setRefundError(''); }}>Partial amount</button>
          </div>
          {refundMode === 'partial' && <Form.Group controlId={`refund-amount-${orderId}`}><Form.Label>Refund amount in INR</Form.Label><div className="admin-money-input"><span aria-hidden="true">₹</span><Form.Control value={refundAmount} onChange={(event) => { setRefundAmount(event.target.value); setRefundError(''); }} inputMode="decimal" autoComplete="off" isInvalid={Boolean(refundError && !parseRupeesToPaise(refundAmount))} /></div></Form.Group>}
          <Form.Group controlId={`refund-reason-${orderId}`}><Form.Label>Reason for the payment record</Form.Label><Form.Control as="textarea" rows={2} minLength={5} maxLength={500} value={refundReason} onChange={(event) => { setRefundReason(event.target.value); setRefundError(''); }} placeholder="Customer-approved cancellation, damaged item…" /></Form.Group>
          {refundError && <p className="admin-payment-field-error" role="alert">{refundError}</p>}
          <Button type="submit" variant="outline-dark">Review {refundMode === 'full' ? moneyFromPaise(remainingRefundablePaise) : 'partial'} refund</Button>
        </Form>
      )}

      {snapshot.status === 'refund_pending' && <div className="admin-payment-gate"><Spinner size="sm" /><p><strong>Refund reconciliation in progress.</strong><span>Wait for the verified provider result before creating another refund.</span></p></div>}

      <Modal show={Boolean(refundReview)} onHide={() => !refundSubmitting && setRefundReview(null)} centered className="admin-refund-confirm" aria-labelledby="admin-refund-confirm-title">
        <Modal.Header closeButton={!refundSubmitting}><div><p className="eyebrow">Final check · original payment method</p><Modal.Title id="admin-refund-confirm-title">Confirm {moneyFromPaise(refundReview?.amountPaise)} refund</Modal.Title></div></Modal.Header>
        <Modal.Body>
          <div className="admin-refund-confirm__amount"><span>This refund</span><strong>{moneyFromPaise(refundReview?.amountPaise)}</strong><small>{moneyFromPaise(Math.max(0, remainingRefundablePaise - Number(refundReview?.amountPaise || 0)))} remains refundable afterward</small></div>
          <dl><div><dt>Order</dt><dd>{order.orderNumber || orderId}</dd></div><div><dt>Reason</dt><dd>{refundReview?.reason}</dd></div></dl>
          <Alert variant="warning"><Icon name="alert" size={17} /><span>This sends a real provider request in Live Mode. Razorpay and the customer’s bank determine final processing time.</span></Alert>
        </Modal.Body>
        <Modal.Footer><Button type="button" variant="outline-dark" disabled={refundSubmitting} onClick={() => setRefundReview(null)}>Go back</Button><Button type="button" variant="danger" disabled={refundSubmitting} onClick={confirmRefund}>{refundSubmitting ? <><Spinner size="sm" /> Sending refund…</> : `Confirm ${moneyFromPaise(refundReview?.amountPaise)} refund`}</Button></Modal.Footer>
      </Modal>
    </section>
  );
}
