import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import { RouteLoader } from '../components/Feedback';
import { api } from '../api/client';
import { formatCurrency } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import {
  loadScopedDraft,
  removeScopedDraft,
  saveScopedDraft,
  scopedDraftOwner,
} from '../utils/scoped-draft';
import {
  INDIAN_MOBILE_MESSAGE,
  normalizeIndianMobile,
} from '../../shared/indian-phone.js';

const DRAFT_KEY = 'gnw-checkout-draft';
const IDEMPOTENCY_KEY = 'gnw-checkout-idempotency';
const checkoutFieldIds = {
  'shippingAddress.recipientName': 'checkout-name',
  'shippingAddress.phone': 'checkout-phone',
  'shippingAddress.line1': 'checkout-address-1',
  'shippingAddress.line2': 'checkout-address-2',
  'shippingAddress.city': 'checkout-city',
  'shippingAddress.state': 'checkout-state',
  'shippingAddress.postalCode': 'checkout-pin',
  note: 'checkout-notes',
};

function getCheckoutKey() {
  const existing = window.sessionStorage.getItem(IDEMPOTENCY_KEY);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() || `gnw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(IDEMPOTENCY_KEY, generated);
  return generated;
}

const emptyForm = {
  fullName: '',
  phone: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  occasionDate: '',
  notes: '',
  contactPreference: 'WhatsApp',
};

export default function CheckoutPage() {
  const { cart, subtotal, clearCart, claimedOfferCode, welcomeOffer, studioSettings, notify } = useShop();
  const { user, sessionOwnerId, loading: authLoading, requireAuth, refreshSession } = useAuth();
  const draftUserId = String(sessionOwnerId || user?.id || '');
  const draftOwner = scopedDraftOwner(draftUserId);
  const [form, setForm] = useState(emptyForm);
  const [draftReady, setDraftReady] = useState(false);
  const [validated, setValidated] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState(null);
  const [idempotencyKey] = useState(getCheckoutKey);
  const formRef = useRef(null);
  const promptedForAuthRef = useRef(false);
  const [hydratedDraftOwner, setHydratedDraftOwner] = useState('pending');

  useEffect(() => {
    if (authLoading) return;
    const previousOwner = hydratedDraftOwner;
    if (previousOwner === draftOwner && draftReady) return;
    const transferGuest = Boolean(draftUserId)
      && (previousOwner === 'pending' || previousOwner === 'guest');
    const savedDraft = loadScopedDraft(DRAFT_KEY, draftUserId, {
      transferGuest,
      migrateLegacy: previousOwner === 'pending' && Boolean(draftUserId),
    });
    setForm({ ...emptyForm, ...(savedDraft || {}) });
    setValidated(false);
    setPhoneError('');
    setError('');
    setOrder(null);
    setHydratedDraftOwner(draftOwner);
    setDraftReady(true);
  }, [authLoading, draftOwner, draftReady, draftUserId, hydratedDraftOwner]);

  useEffect(() => {
    if (authLoading || user || !cart.length || promptedForAuthRef.current) return;
    promptedForAuthRef.current = true;
    requireAuth({
      message: 'Log in or create an account to continue with your saved order. Your bag and delivery draft will stay on this device.',
    });
  }, [authLoading, cart.length, requireAuth, user]);

  useEffect(() => {
    if (!draftReady || !user) return;
    setForm((current) => ({
      ...current,
      fullName: current.fullName || user.name || '',
      email: user.email || current.email || '',
      phone: current.phone || user.phone || '',
    }));
  }, [draftReady, user]);

  useEffect(() => {
    if (!draftReady || hydratedDraftOwner !== draftOwner) return;
    saveScopedDraft(DRAFT_KEY, draftUserId, form);
  }, [draftOwner, draftReady, draftUserId, form, hydratedDraftOwner]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'phone' && phoneError) setPhoneError('');
  };
  const offerCode = claimedOfferCode || (window.sessionStorage.getItem('gnw-first-offer-claimed') === 'true' ? welcomeOffer?.code || 'FIRST10' : '');
  const bulkThreshold = Number(welcomeOffer?.bulkOrderThreshold || studioSettings?.shipping?.bulkThreshold || 10);
  const offerClaimed = Boolean(offerCode && (welcomeOffer?.enabled ?? true));
  const itemOfferEligible = !cart.some((line) =>
    String(line.product.category || '').toLowerCase().includes('corporate') || line.quantity >= bulkThreshold,
  );

  const submit = async (event) => {
    event.preventDefault();
    const htmlForm = event.currentTarget;
    if (!user) {
      requireAuth({
        message: 'Log in or create an account before sending this order request. Your bag and completed form will stay here.',
        onAuthenticated: () => formRef.current?.requestSubmit(),
        onAccountMismatch: () => {
          const message = 'Your signed-in account changed. Please review this account’s bag and delivery details before continuing.';
          setError(message);
          notify(message, 'warning');
        },
      });
      return;
    }
    setValidated(true);
    setError('');
    if (!htmlForm.checkValidity()) {
      event.stopPropagation();
      notify('Please complete the highlighted delivery details before continuing.', 'error');
      htmlForm.querySelector(':invalid')?.focus();
      return;
    }
    const normalizedPhone = normalizeIndianMobile(form.phone);
    if (!normalizedPhone) {
      setPhoneError(INDIAN_MOBILE_MESSAGE);
      setError('Please correct the highlighted mobile number before sending your order request.');
      notify(INDIAN_MOBILE_MESSAGE, 'error');
      window.requestAnimationFrame(() => document.getElementById('checkout-phone')?.focus());
      return;
    }
    setPhoneError('');
    const expiredUpload = cart.find((line) => {
      const expiresAt = Date.parse(line.customization?.media?.expiresAt || '');
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    });
    if (expiredUpload) {
      const message = `The secure photo attached to ${expiredUpload.product.title} expired. Remove that item and add it again with the photo.`;
      setError(message);
      notify(message, 'error');
      return;
    }
    const pendingUpload = cart.find((line) => line.customization?.media?.pending);
    if (pendingUpload) {
      const message = `Please return to ${pendingUpload.product.title} and securely reattach its photo before sending your request.`;
      setError(message);
      notify(message, 'error');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        items: cart.map((line) => ({
          ...(/^[a-f\d]{24}$/i.test(line.product.id) ? { productId: line.product.id } : { slug: line.product.slug }),
          quantity: line.quantity,
          customization: line.customization && Object.keys(line.customization).length
            ? JSON.stringify(line.customization)
            : undefined,
        })),
        shippingAddress: {
          recipientName: form.fullName,
          phone: normalizedPhone,
          line1: form.addressLine1,
          line2: form.addressLine2,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          country: 'India',
        },
        note: [
          form.occasionDate ? `Needed by: ${form.occasionDate}` : '',
          `Preferred contact: ${form.contactPreference}`,
          form.notes,
        ].filter(Boolean).join('\n'),
        couponCode: offerClaimed && itemOfferEligible ? offerCode : undefined,
        paymentMethod: 'manual_confirmation',
      };
      const result = await api.submitOrderRequest(payload, idempotencyKey, user.id);
      const createdOrder = result.data || result.order || result;
      setOrder(createdOrder);
      clearCart();
      removeScopedDraft(DRAFT_KEY, draftUserId);
      window.sessionStorage.removeItem(IDEMPOTENCY_KEY);
      notify(`Order request${createdOrder.orderNumber ? ` ${createdOrder.orderNumber}` : ''} was sent securely.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      if (requestError.code === 'SESSION_IDENTITY_CHANGED') {
        await refreshSession();
        const message = 'Your signed-in account changed, so this order was not sent. Please review the current account’s bag and delivery details.';
        setError(message);
        notify(message, 'error');
      } else if (requestError.status === 401) {
        requireAuth({
          force: true,
          message: 'Your session expired. Log in again to send this order request; your bag and form are still saved.',
          onAuthenticated: () => formRef.current?.requestSubmit(),
          onAccountMismatch: () => {
            const message = 'You signed in to a different account, so the previous account’s order was not sent. Please review your bag and details before continuing.';
            setError(message);
            notify(message, 'error');
          },
        });
      } else {
        const firstIssue = Array.isArray(requestError.details) ? requestError.details[0] : null;
        if (firstIssue?.field === 'shippingAddress.phone') {
          setPhoneError(firstIssue.message || INDIAN_MOBILE_MESSAGE);
        }
        const message = `${firstIssue?.message || requestError.message} Nothing was charged and your form is still saved.`;
        setError(message);
        notify(message, 'error');
        const fieldId = checkoutFieldIds[firstIssue?.field];
        if (fieldId) window.requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!draftReady || hydratedDraftOwner !== draftOwner) return <RouteLoader />;

  if (order) {
    return (
      <Container className="order-confirmation page-section">
        <div className="order-confirmation__mark"><Icon name="check" size={34} /></div>
        <p className="eyebrow">Request received</p>
        <h1>Your idea is with the studio.</h1>
        <p>We’ve received your order request{order.orderNumber ? ` ${order.orderNumber}` : ''}. The studio will review personalization, timing, delivery and the final amount before sharing the next step.</p>
        <Alert variant="info" className="soft-alert"><strong>No payment has been taken.</strong> This confirmation only records your request.</Alert>
        <div className="order-confirmation__steps"><span><i>1</i> Studio review</span><span><i>2</i> Design & total confirmation</span><span><i>3</i> Payment instructions</span><span><i>4</i> Handcrafting begins</span></div>
        <div><Button as={Link} to="/account" className="button-burgundy">View my requests</Button><Link to="/shop" className="text-link">Return to the studio <Icon name="arrow" /></Link></div>
      </Container>
    );
  }

  if (!cart.length) {
    return (
      <Container className="access-state page-section"><div className="access-state__icon"><Icon name="bag" size={30} /></div><p className="eyebrow">Order request</p><h1>Your bag is empty.</h1><p>Choose a studio piece before sharing delivery details.</p><Button as={Link} to="/shop" className="button-burgundy">Browse the collection</Button></Container>
    );
  }

  return (
    <section className="checkout-page page-section">
      <Container fluid="xl">
        <nav className="checkout-steps" aria-label="Checkout progress"><span className="is-complete"><i><Icon name="check" size={13} /></i> Bag</span><b /><span className="is-active"><i>2</i> Details</span><b /><span><i>3</i> Studio confirmation</span></nav>
        <Row className="g-5">
          <Col lg={7}>
            <div className="checkout-heading"><p className="eyebrow">Order request</p><h1>Where should we send the beautiful thing?</h1><p>Share your delivery and occasion details. You’ll review the final design, total and payment instructions with the studio before production.</p></div>
            {error && <Alert variant="danger" className="soft-alert" role="alert">{error}</Alert>}
            <Form ref={formRef} noValidate validated={validated} onSubmit={submit} className="checkout-form">
              <fieldset>
                <legend><span>01</span> Contact details</legend>
                <Row className="g-3">
                  <Col sm={6}><Form.Group controlId="checkout-name"><Form.Label>Full name</Form.Label><Form.Control required minLength={2} maxLength={100} value={form.fullName} onChange={(event) => update('fullName', event.target.value)} autoComplete="name" /><Form.Control.Feedback type="invalid">Please enter your full name.</Form.Control.Feedback></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="checkout-phone"><Form.Label>Mobile number</Form.Label><Form.Control required type="tel" inputMode="tel" maxLength={24} value={form.phone} onChange={(event) => update('phone', event.target.value)} autoComplete="tel" placeholder="09876543210 or +91 98765 43210" isInvalid={Boolean(phoneError)} aria-invalid={phoneError ? true : undefined} aria-describedby="checkout-phone-error checkout-phone-help" /><Form.Control.Feedback id="checkout-phone-error" type="invalid">{phoneError || INDIAN_MOBILE_MESSAGE}</Form.Control.Feedback><Form.Text id="checkout-phone-help">Use a 10-digit Indian mobile, optionally beginning with 0 or +91.</Form.Text></Form.Group></Col>
                  <Col xs={12}><Form.Group controlId="checkout-email"><Form.Label>Email address</Form.Label><Form.Control required readOnly={Boolean(user)} type="email" maxLength={254} value={form.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" /><Form.Control.Feedback type="invalid">Enter a valid email address.</Form.Control.Feedback>{user && <Form.Text>Order updates will be tied to your verified account email.</Form.Text>}</Form.Group></Col>
                </Row>
              </fieldset>
              <fieldset>
                <legend><span>02</span> Delivery address</legend>
                <Row className="g-3">
                  <Col xs={12}><Form.Group controlId="checkout-address-1"><Form.Label>House, building and street</Form.Label><Form.Control required minLength={3} maxLength={200} value={form.addressLine1} onChange={(event) => update('addressLine1', event.target.value)} autoComplete="address-line1" /><Form.Control.Feedback type="invalid">Please enter the delivery address.</Form.Control.Feedback></Form.Group></Col>
                  <Col xs={12}><Form.Group controlId="checkout-address-2"><Form.Label>Landmark or area <small>optional</small></Form.Label><Form.Control maxLength={200} value={form.addressLine2} onChange={(event) => update('addressLine2', event.target.value)} autoComplete="address-line2" /></Form.Group></Col>
                  <Col sm={5}><Form.Group controlId="checkout-city"><Form.Label>City</Form.Label><Form.Control required minLength={2} maxLength={100} value={form.city} onChange={(event) => update('city', event.target.value)} autoComplete="address-level2" /><Form.Control.Feedback type="invalid">Enter your city.</Form.Control.Feedback></Form.Group></Col>
                  <Col sm={4}><Form.Group controlId="checkout-state"><Form.Label>State</Form.Label><Form.Control required minLength={2} maxLength={100} value={form.state} onChange={(event) => update('state', event.target.value)} autoComplete="address-level1" /><Form.Control.Feedback type="invalid">Enter your state.</Form.Control.Feedback></Form.Group></Col>
                  <Col sm={3}><Form.Group controlId="checkout-pin"><Form.Label>PIN code</Form.Label><Form.Control required pattern="[1-9][0-9]{5}" inputMode="numeric" value={form.postalCode} onChange={(event) => update('postalCode', event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="postal-code" /><Form.Control.Feedback type="invalid">Enter a 6-digit PIN.</Form.Control.Feedback></Form.Group></Col>
                </Row>
              </fieldset>
              <fieldset>
                <legend><span>03</span> The finishing details</legend>
                <Row className="g-3">
                  <Col sm={6}><Form.Group controlId="checkout-date"><Form.Label>Need it by <small>optional</small></Form.Label><Form.Control type="date" value={form.occasionDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => update('occasionDate', event.target.value)} /></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="checkout-contact"><Form.Label>Preferred contact</Form.Label><Form.Select value={form.contactPreference} onChange={(event) => update('contactPreference', event.target.value)}><option>WhatsApp</option><option>Phone call</option><option>Email</option></Form.Select></Form.Group></Col>
                  <Col xs={12}><Form.Group controlId="checkout-notes"><Form.Label>Delivery or gift notes <small>optional</small></Form.Label><Form.Control as="textarea" rows={4} maxLength={500} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Anything the studio should know about the occasion or delivery?" /></Form.Group></Col>
                </Row>
              </fieldset>
              {!user && <Alert variant="info" className="soft-alert sign-in-reminder"><Icon name="lock" /> You’ll be asked to log in with a secure email code or an approved provider when you send this request. Your form is saved on this device.</Alert>}
              <Button type="submit" className="button-burgundy checkout-submit" disabled={submitting}>{submitting ? <><Spinner size="sm" /> Sending securely…</> : <>Send order request <Icon name="arrow" /></>}</Button>
              <p className="checkout-submit-note">By sending, you are requesting a studio review—not completing a purchase or payment.</p>
            </Form>
          </Col>
          <Col lg={{ span: 4, offset: 1 }}>
            <aside className="checkout-summary">
              <div className="checkout-summary__head"><p className="eyebrow">Your pieces</p><Link to="/cart">Edit bag</Link></div>
              {cart.map((line) => (
                <div className="checkout-mini-line" key={line.lineId}><div><SmartImage src={line.product.image} alt="" fallbackLabel={line.product.category} /><span>{line.quantity}</span></div><p><strong>{line.product.title}</strong><small>{line.customization?.name ? `For ${line.customization.name}` : line.product.category}</small></p><b>{formatCurrency(line.product.price * line.quantity)}</b></div>
              ))}
              <dl><div><dt>Item total</dt><dd>{formatCurrency(subtotal)}</dd></div><div><dt>Delivery</dt><dd>Confirmed after address review</dd></div><div><dt>Offer</dt><dd>{offerClaimed ? (itemOfferEligible ? `${offerCode} · first-order check pending` : 'Not available on bulk/corporate pieces') : '—'}</dd></div><div className="summary-total"><dt>Current estimate</dt><dd>{formatCurrency(subtotal)}</dd></div></dl>
              <div className="checkout-summary__note"><Icon name="spark" /><p><strong>What happens next?</strong><small>The studio reviews your design notes, confirms the final total and shares payment instructions personally.</small></p></div>
            </aside>
          </Col>
        </Row>
      </Container>
    </section>
  );
}
