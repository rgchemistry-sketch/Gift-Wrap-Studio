import { useEffect, useState } from 'react';
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
import { api } from '../api/client';
import { formatCurrency } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';

const DRAFT_KEY = 'gnw-checkout-draft';
const IDEMPOTENCY_KEY = 'gnw-checkout-idempotency';

function readDraft() {
  try {
    return JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

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
  const { cart, subtotal, clearCart, claimedOfferCode, welcomeOffer, studioSettings } = useShop();
  const { user, openAuth } = useAuth();
  const [form, setForm] = useState(() => ({ ...emptyForm, ...(readDraft() || {}) }));
  const [validated, setValidated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState(null);
  const [idempotencyKey] = useState(getCheckoutKey);

  useEffect(() => {
    if (!user) return;
    setForm((current) => ({
      ...current,
      fullName: current.fullName || user.name || '',
      email: current.email || user.email || '',
      phone: current.phone || user.phone || '',
    }));
  }, [user]);

  useEffect(() => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  }, [form]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const offerCode = claimedOfferCode || (window.sessionStorage.getItem('gnw-first-offer-claimed') === 'true' ? welcomeOffer?.code || 'FIRST10' : '');
  const bulkThreshold = Number(welcomeOffer?.bulkOrderThreshold || studioSettings?.shipping?.bulkThreshold || 10);
  const offerClaimed = Boolean(offerCode && (welcomeOffer?.enabled ?? true));
  const itemOfferEligible = !cart.some((line) =>
    String(line.product.category || '').toLowerCase().includes('corporate') || line.quantity >= bulkThreshold,
  );

  const submit = async (event) => {
    event.preventDefault();
    const htmlForm = event.currentTarget;
    setValidated(true);
    setError('');
    if (!htmlForm.checkValidity()) {
      event.stopPropagation();
      htmlForm.querySelector(':invalid')?.focus();
      return;
    }
    if (!user) {
      openAuth('Log in with an email verification code, Google, Facebook or Apple to securely submit your saved order request.', 'login');
      return;
    }
    const expiredUpload = cart.find((line) => {
      const expiresAt = Date.parse(line.customization?.media?.expiresAt || '');
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    });
    if (expiredUpload) {
      setError(`The secure photo attached to ${expiredUpload.product.title} expired. Remove that item and add it again with the photo.`);
      return;
    }
    const pendingUpload = cart.find((line) => line.customization?.media?.pending);
    if (pendingUpload) {
      setError(`Please return to ${pendingUpload.product.title} and securely reattach its photo before sending your request.`);
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
          phone: form.phone,
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
      const result = await api.submitOrderRequest(payload, idempotencyKey);
      const createdOrder = result.data || result.order || result;
      setOrder(createdOrder);
      clearCart();
      window.localStorage.removeItem(DRAFT_KEY);
      window.sessionStorage.removeItem(IDEMPOTENCY_KEY);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      if (requestError.status === 401) {
        openAuth('Your session expired. Sign in again; your order form is still saved.');
      } else {
        setError(`${requestError.message} Nothing was charged and your form is still saved.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

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
            <Form noValidate validated={validated} onSubmit={submit} className="checkout-form">
              <fieldset>
                <legend><span>01</span> Contact details</legend>
                <Row className="g-3">
                  <Col sm={6}><Form.Group controlId="checkout-name"><Form.Label>Full name</Form.Label><Form.Control required value={form.fullName} onChange={(event) => update('fullName', event.target.value)} autoComplete="name" /><Form.Control.Feedback type="invalid">Please enter your full name.</Form.Control.Feedback></Form.Group></Col>
                  <Col sm={6}><Form.Group controlId="checkout-phone"><Form.Label>Mobile number</Form.Label><Form.Control required pattern="[6-9][0-9]{9}" inputMode="numeric" value={form.phone} onChange={(event) => update('phone', event.target.value.replace(/\D/g, '').slice(0, 10))} autoComplete="tel" placeholder="10-digit number" /><Form.Control.Feedback type="invalid">Enter a valid 10-digit Indian mobile number.</Form.Control.Feedback></Form.Group></Col>
                  <Col xs={12}><Form.Group controlId="checkout-email"><Form.Label>Email address</Form.Label><Form.Control required type="email" value={form.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" /><Form.Control.Feedback type="invalid">Enter a valid email address.</Form.Control.Feedback></Form.Group></Col>
                </Row>
              </fieldset>
              <fieldset>
                <legend><span>02</span> Delivery address</legend>
                <Row className="g-3">
                  <Col xs={12}><Form.Group controlId="checkout-address-1"><Form.Label>House, building and street</Form.Label><Form.Control required value={form.addressLine1} onChange={(event) => update('addressLine1', event.target.value)} autoComplete="address-line1" /><Form.Control.Feedback type="invalid">Please enter the delivery address.</Form.Control.Feedback></Form.Group></Col>
                  <Col xs={12}><Form.Group controlId="checkout-address-2"><Form.Label>Landmark or area <small>optional</small></Form.Label><Form.Control value={form.addressLine2} onChange={(event) => update('addressLine2', event.target.value)} autoComplete="address-line2" /></Form.Group></Col>
                  <Col sm={5}><Form.Group controlId="checkout-city"><Form.Label>City</Form.Label><Form.Control required value={form.city} onChange={(event) => update('city', event.target.value)} autoComplete="address-level2" /><Form.Control.Feedback type="invalid">Enter your city.</Form.Control.Feedback></Form.Group></Col>
                  <Col sm={4}><Form.Group controlId="checkout-state"><Form.Label>State</Form.Label><Form.Control required value={form.state} onChange={(event) => update('state', event.target.value)} autoComplete="address-level1" /><Form.Control.Feedback type="invalid">Enter your state.</Form.Control.Feedback></Form.Group></Col>
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
                <div className="checkout-mini-line" key={line.lineId}><div><SmartImage src={line.product.image} alt="" fallbackLabel={line.product.category} /><span>{line.quantity}</span></div><p><strong>{line.product.title}</strong><small>{line.customization?.name ? `For ${line.customization.name}` : line.product.category}</small></p><b>{formatCurrency((line.product.price + (line.customizationFee || 0)) * line.quantity)}</b></div>
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
