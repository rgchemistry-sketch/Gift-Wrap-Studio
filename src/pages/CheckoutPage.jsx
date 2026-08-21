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
import StorefrontSelect from '../components/StorefrontSelect';
import { RouteLoader } from '../components/Feedback';
import { api } from '../api/client';
import { formatCurrency } from '../data/catalog';
import { useCatalog } from '../data/useCatalog';
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
import { focusAndRevealFirstInvalid, shouldDisableBuyingAction } from '../utils/buying-flow';
import { dateInputIsBeforeMinimum, localDateInputValue } from '../utils/date-input';
import {
  loadCheckoutConfirmation,
  removeCheckoutConfirmation,
  safeCheckoutConfirmation,
  storeCheckoutConfirmation,
} from '../utils/checkout-confirmation';
import '../buying-flow.css';

const DRAFT_KEY = 'gnw-checkout-draft';
const IDEMPOTENCY_KEY = 'gnw-checkout-idempotency';
const contactPreferenceOptions = ['WhatsApp', 'Phone call', 'Email'];
const indianStateOptions = [
  { value: '', label: 'Choose your state or union territory', disabled: true },
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];
const COUPON_ERROR_CODES = new Set([
  'WELCOME_OFFER_INVALID',
  'WELCOME_OFFER_EXCLUDED',
  'WELCOME_OFFER_INELIGIBLE',
]);
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

function createCheckoutKey() {
  return window.crypto?.randomUUID?.() || `gnw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function storeCheckoutKey(key) {
  try {
    window.sessionStorage.setItem(IDEMPOTENCY_KEY, key);
  } catch {
    // The in-memory key still protects this mounted checkout when storage is blocked.
  }
}

function removeCheckoutKey() {
  try {
    window.sessionStorage.removeItem(IDEMPOTENCY_KEY);
  } catch {
    // There may be no persisted key when storage is blocked.
  }
}

function getCheckoutKey() {
  let existing = '';
  try {
    existing = window.sessionStorage.getItem(IDEMPOTENCY_KEY) || '';
  } catch {
    // Generate an in-memory key below.
  }
  if (existing) return existing;
  const generated = createCheckoutKey();
  storeCheckoutKey(generated);
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

function CheckoutSummary({
  cart,
  subtotal,
  offerStatus,
  offerClaimed,
  removeWelcomeOffer,
  mobile = false,
}) {
  const content = (
    <>
      <div className="checkout-summary__head"><p className="eyebrow" id={mobile ? 'checkout-summary-mobile-title' : 'checkout-summary-title'}>Your pieces</p><Link to="/cart">Edit bag</Link></div>
      {cart.map((line) => (
        <div className="checkout-mini-line" key={line.lineId}><div><SmartImage src={line.product.image} alt="" fallbackLabel={line.product.category} /><span>{line.quantity}</span></div><p><strong>{line.product.title}</strong><small>{line.unavailable ? (line.unavailableReason || 'Unavailable') : line.customizationUnavailable ? (line.customizationUnavailableReason || 'Personalization needs attention') : line.customization?.name ? `For ${line.customization.name}` : line.product.category}{line.priceUpdatedFrom != null && Number(line.priceUpdatedFrom) !== Number(line.product.price) ? ` · Price updated from ${formatCurrency(line.priceUpdatedFrom)}` : ''}</small></p><b>{line.unavailable ? 'Unavailable' : line.customizationUnavailable ? 'Needs attention' : formatCurrency(line.product.price * line.quantity)}</b></div>
      ))}
      <dl><div><dt>Item total</dt><dd>{formatCurrency(subtotal)}</dd></div><div><dt>Delivery</dt><dd>Confirmed after address review</dd></div><div><dt>Offer</dt><dd>{offerStatus}{offerClaimed && <><br /><button type="button" className="plain-link" onClick={removeWelcomeOffer}>Remove offer</button></>}</dd></div><div className="summary-total"><dt>Current estimate</dt><dd>{formatCurrency(subtotal)}</dd></div></dl>
      <div className="checkout-summary__note"><Icon name="spark" /><p><strong>What happens next?</strong><small>The studio reviews your design notes, confirms the final total and shares payment instructions personally.</small></p></div>
    </>
  );

  if (mobile) {
    return (
      <details className="checkout-summary-mobile">
        <summary><span>Order summary</span><strong>{formatCurrency(subtotal)}</strong><Icon name="chevron" /></summary>
        <div className="checkout-summary-mobile__body" aria-labelledby="checkout-summary-mobile-title">{content}</div>
      </details>
    );
  }

  return <aside className="checkout-summary checkout-summary-desktop" aria-labelledby="checkout-summary-title">{content}</aside>;
}

export default function CheckoutPage() {
  const {
    cart,
    subtotal,
    clearCart,
    removeFromCart,
    removeCartCustomization,
    claimedOfferCode,
    welcomeOffer,
    studioSettings,
    notify,
    removeWelcomeOffer,
    revalidateCart,
    markCartItemUnavailable,
    markCartCustomizationUnavailable,
  } = useShop();
  const {
    products: catalog,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useCatalog();
  const { user, sessionOwnerId, loading: authLoading, requireAuth, refreshSession } = useAuth();
  const draftUserId = String(sessionOwnerId || user?.id || '');
  const draftOwner = scopedDraftOwner(draftUserId);
  const [form, setForm] = useState(emptyForm);
  const [draftReady, setDraftReady] = useState(false);
  const [validated, setValidated] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [couponRecovery, setCouponRecovery] = useState(false);
  const [idempotencyConflict, setIdempotencyConflict] = useState(false);
  const [liveCatalogReady, setLiveCatalogReady] = useState(false);
  const [order, setOrder] = useState(null);
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(getCheckoutKey);
  const formRef = useRef(null);
  const promptedForAuthRef = useRef(false);
  const skipOfferRef = useRef(false);
  const [hydratedDraftOwner, setHydratedDraftOwner] = useState('pending');

  const refreshLiveCart = async () => {
    setLiveCatalogReady(false);
    const liveProducts = await refreshCatalog({ force: true });
    if (!Array.isArray(liveProducts)) return false;
    revalidateCart(liveProducts);
    setLiveCatalogReady(true);
    return true;
  };

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
    setCouponRecovery(false);
    setIdempotencyConflict(false);
    setOrder(null);
    setPoliciesAccepted(false);
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
    if (authLoading || !draftReady || hydratedDraftOwner !== draftOwner) return;
    if (cart.length) {
      removeCheckoutConfirmation(draftUserId);
      setOrder(null);
      return;
    }
    setOrder((current) => current || loadCheckoutConfirmation(draftUserId));
  }, [authLoading, cart.length, draftOwner, draftReady, draftUserId, hydratedDraftOwner]);

  useEffect(() => {
    if (!draftReady || hydratedDraftOwner !== draftOwner) return;
    saveScopedDraft(DRAFT_KEY, draftUserId, form);
  }, [draftOwner, draftReady, draftUserId, form, hydratedDraftOwner]);

  useEffect(() => {
    let active = true;
    setLiveCatalogReady(false);
    refreshCatalog({ force: true }).then((liveProducts) => {
      if (!active || !Array.isArray(liveProducts)) return;
      revalidateCart(liveProducts);
      setLiveCatalogReady(true);
    });
    return () => { active = false; };
  }, [refreshCatalog, revalidateCart]);

  useEffect(() => {
    if (liveCatalogReady && !catalogLoading && !catalogError) revalidateCart(catalog);
  }, [cart, catalog, catalogError, catalogLoading, liveCatalogReady, revalidateCart]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'phone' && phoneError) setPhoneError('');
  };
  const offerCode = claimedOfferCode;
  const bulkThreshold = Number(welcomeOffer?.bulkOrderThreshold || studioSettings?.shipping?.bulkThreshold || 10);
  const quantityByProduct = cart.reduce((totals, line) => {
    const productKey = String(line.product.id || line.product.slug || line.lineId);
    totals.set(productKey, (totals.get(productKey) || 0) + Number(line.quantity || 0));
    return totals;
  }, new Map());
  const itemOfferEligible = !cart.some((line) => (
    String(line.product.category || '').toLowerCase().includes('corporate')
  )) && ![...quantityByProduct.values()].some((quantity) => quantity >= bulkThreshold);
  const offerClaimed = Boolean(offerCode);
  const offerEligible = welcomeOffer?.eligible === true
    && welcomeOffer?.enabled === true
    && itemOfferEligible;
  const unavailableItems = cart.filter((line) => line.unavailable);
  const customizationUnavailableItems = cart.filter((line) => line.customizationUnavailable);
  const bagNeedsAttention = unavailableItems.length > 0 || customizationUnavailableItems.length > 0;
  const bagCheckPending = !catalogError && (!liveCatalogReady || catalogLoading);
  const submitLabel = catalogError
    ? 'Retry the bag check to continue'
    : bagCheckPending
      ? 'Checking your bag…'
      : bagNeedsAttention
        ? 'Resolve bag updates to continue'
        : idempotencyConflict
          ? 'Confirm before starting a new request'
          : 'Send order request';
  const offerStatus = !offerClaimed
    ? '—'
    : !itemOfferEligible
      ? 'Not available on bulk/corporate pieces'
      : welcomeOffer?.eligible === false
        ? 'Not available for this account'
        : offerEligible
          ? `${offerCode} · eligibility confirmed`
          : 'Eligibility could not be confirmed; the offer will not be sent';

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
    if (idempotencyConflict) {
      const message = 'Before sending anything again, check Orders & requests and explicitly confirm that you want to start a separate request.';
      setError(message);
      notify(message, 'warning');
      return;
    }
    setCouponRecovery(false);
    if (!liveCatalogReady || catalogLoading || catalogError) {
      const message = catalogError
        ? 'We couldn’t verify live bag details. Try the catalogue check again before sending this request.'
        : 'We’re still checking your bag against the live catalogue. Please wait a moment.';
      setError(message);
      notify(message, 'info');
      return;
    }
    if (customizationUnavailableItems.length) {
      const message = 'Choose whether to keep each affected piece without personalization or remove it before sending this request.';
      setError(message);
      notify(message, 'warning');
      return;
    }
    if (unavailableItems.length) {
      const message = 'Remove unavailable pieces from your bag before sending this request.';
      setError(message);
      notify(message, 'warning');
      return;
    }
    setValidated(true);
    setError('');
    if (!htmlForm.checkValidity()) {
      event.stopPropagation();
      notify('Please complete the highlighted delivery details before continuing.', 'error');
      focusAndRevealFirstInvalid(htmlForm);
      return;
    }
    if (!form.state) {
      const message = 'Choose your delivery state or union territory.';
      setError(message);
      notify(message, 'error');
      window.requestAnimationFrame(() => {
        const stateControl = document.getElementById('checkout-state');
        stateControl?.focus({ preventScroll: true });
        stateControl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
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
      const applyOffer = !skipOfferRef.current && offerClaimed && offerEligible;
      skipOfferRef.current = false;
      const payload = {
        items: cart.map((line) => ({
          productId: String(line.product.id || line.product.slug),
          slug: line.product.slug,
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
        neededBy: form.occasionDate || undefined,
        contactPreference: form.contactPreference,
        note: form.notes,
        couponCode: applyOffer ? offerCode : undefined,
        paymentMethod: 'manual_confirmation',
        policyConsent: { accepted: true, version: '2026-08-21' },
      };
      const result = await api.submitOrderRequest(payload, idempotencyKey, user.id);
      const createdOrder = result.data || result.order || result;
      const confirmation = storeCheckoutConfirmation(draftUserId, createdOrder)
        || safeCheckoutConfirmation(createdOrder);
      setOrder(confirmation);
      clearCart();
      removeScopedDraft(DRAFT_KEY, draftUserId);
      removeCheckoutKey();
      notify(`Order request${createdOrder.orderNumber ? ` ${createdOrder.orderNumber}` : ''} was sent securely.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      const firstIssue = Array.isArray(requestError.details) ? requestError.details[0] : null;
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
      } else if (COUPON_ERROR_CODES.has(requestError.code)) {
        const message = `${requestError.message} Nothing was charged. You can continue without this offer.`;
        setCouponRecovery(true);
        setError(message);
        notify(message, 'warning');
      } else if (
        requestError.code === 'IDEMPOTENCY_KEY_REUSED'
        || (requestError.status === 409 && /Idempotency-Key/i.test(requestError.message))
      ) {
        const message = 'An earlier attempt may already have gone through. Check Orders & requests first. A new request will stay blocked until you explicitly confirm below.';
        setIdempotencyConflict(true);
        setError(message);
        notify(message, 'warning');
      } else if (
        firstIssue?.field === 'items'
        && firstIssue.customizationAvailable === false
      ) {
        markCartCustomizationUnavailable({
          productId: firstIssue.productId,
          slug: firstIssue.slug,
          productVersion: firstIssue.productUpdatedAt,
        });
        void refreshLiveCart();
        const message = 'Personalization is no longer available for an item in your bag. Your saved details are still here—keep the piece without personalization or remove it before continuing.';
        setError(message);
        notify(message, 'warning');
      } else {
        if (requestError.code === 'NOT_FOUND' && firstIssue?.field === 'items') {
          markCartItemUnavailable({
            productId: firstIssue.productId,
            slug: firstIssue.slug,
          });
        }
        if (firstIssue?.field === 'items') {
          void refreshLiveCart();
        }
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

  const continueWithoutOffer = () => {
    skipOfferRef.current = true;
    removeWelcomeOffer();
    setCouponRecovery(false);
    setError('');
    formRef.current?.requestSubmit();
  };

  const acknowledgeNewOrderRequest = () => {
    const replacementKey = createCheckoutKey();
    storeCheckoutKey(replacementKey);
    setIdempotencyKey(replacementKey);
    setIdempotencyConflict(false);
    setError('');
    notify('A separate order request is now ready. Review the details, then send when you are ready.', 'info');
    window.requestAnimationFrame(() => {
      document.querySelector('.checkout-submit')?.focus({ preventScroll: true });
    });
  };

  const keepWithoutCustomization = (lineId) => {
    if (!removeCartCustomization(lineId)) return;
    setError('');
  };

  const removeAffectedLine = (lineId) => {
    removeFromCart(lineId);
    setError('');
  };

  const retryBagCheck = async () => {
    setError('');
    const refreshed = await refreshLiveCart();
    if (!refreshed) {
      const message = 'We still couldn’t refresh your bag. Check your connection and try again.';
      setError(message);
      notify(message, 'warning');
    }
  };

  const dismissConfirmation = () => {
    removeCheckoutConfirmation(draftUserId);
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
        <div><Button as={Link} to="/account" className="button-burgundy" onClick={dismissConfirmation}>View my requests</Button><Link to="/shop" className="text-link" onClick={dismissConfirmation}>Return to the studio <Icon name="arrow" /></Link></div>
      </Container>
    );
  }

  if (!cart.length) {
    return (
      <Container className="access-state page-section"><div className="access-state__icon"><Icon name="bag" size={30} /></div><p className="eyebrow">Order request</p><h1>Your bag is empty.</h1><p>Choose a studio piece before sharing delivery details.</p><Button as={Link} to="/shop" className="button-burgundy">Browse the collection</Button></Container>
    );
  }

  const neededByMinimum = localDateInputValue();
  const neededByInvalid = dateInputIsBeforeMinimum(form.occasionDate, neededByMinimum);

  return (
    <section className="checkout-page page-section">
      <Container fluid="xl">
        <nav className="checkout-steps" aria-label="Order request progress"><span className="is-complete"><i><Icon name="check" size={13} /></i> Bag</span><b aria-hidden="true" /><span className="is-active" aria-current="step"><i>2</i> Details</span><b aria-hidden="true" /><span><i>3</i> Confirm</span></nav>
        <Row className="g-5">
          <Col lg={7}>
            <div className="checkout-heading"><p className="eyebrow">Order request</p><h1>Where should we send the beautiful thing?</h1><p>Share your delivery and occasion details. You’ll review the final design, total and payment instructions with the studio before production.</p></div>
            <CheckoutSummary cart={cart} subtotal={subtotal} offerStatus={offerStatus} offerClaimed={offerClaimed} removeWelcomeOffer={removeWelcomeOffer} mobile />
            {catalogError && <Alert variant="warning" className="soft-alert">We couldn’t refresh live bag details. <button type="button" className="plain-link" onClick={refreshLiveCart}>Try again</button></Alert>}
            {unavailableItems.length > 0 && <Alert variant="warning" className="soft-alert"><strong>{unavailableItems.length === 1 ? 'A piece in your bag is unavailable.' : 'Some pieces in your bag are unavailable.'}</strong> {unavailableItems.map((line) => <button type="button" className="plain-link" key={line.lineId} onClick={() => removeAffectedLine(line.lineId)}>Remove {line.product.title}</button>)}</Alert>}
            {customizationUnavailableItems.length > 0 && (
              <Alert variant="warning" className="soft-alert">
                <strong>{customizationUnavailableItems.length === 1 ? 'A personalized piece needs your attention.' : 'Some personalized pieces need your attention.'}</strong>{' '}
                The studio no longer offers personalization for {customizationUnavailableItems.length === 1 ? 'this piece' : 'these pieces'}, and none of your saved details have been removed.
                {customizationUnavailableItems.map((line) => (
                  <div key={line.lineId}>
                    <strong>{line.product.title}:</strong>{' '}
                    <button type="button" className="plain-link" onClick={() => keepWithoutCustomization(line.lineId)}>Keep without personalization</button>{' '}
                    <button type="button" className="plain-link" onClick={() => removeAffectedLine(line.lineId)}>Remove piece</button>
                  </div>
                ))}
              </Alert>
            )}
            {error && <Alert variant="danger" className="soft-alert" role="alert">{error}{couponRecovery && <div><Button type="button" size="sm" variant="outline-dark" onClick={continueWithoutOffer}>Continue without offer</Button></div>}{idempotencyConflict && <div className="checkout-conflict-actions"><Button as={Link} to="/account?tab=orders" size="sm" variant="outline-dark">Check Orders & requests</Button><Button type="button" size="sm" variant="outline-dark" onClick={acknowledgeNewOrderRequest}>I checked — start a separate request</Button></div>}</Alert>}
            <Form ref={formRef} noValidate validated={validated} onSubmit={submit} className="checkout-form" aria-busy={submitting}>
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
                  <Col sm={4}><Form.Group controlId="checkout-state"><Form.Label>State / UT</Form.Label><StorefrontSelect id="checkout-state" name="state" value={form.state} options={indianStateOptions} onChange={(value) => update('state', value)} required invalid={validated && !form.state} ariaDescribedBy={validated && !form.state ? 'checkout-state-error' : undefined} ariaLabel="Choose delivery state or union territory" />{validated && !form.state && <div className="invalid-feedback d-block" id="checkout-state-error">Choose your state or union territory.</div>}</Form.Group></Col>
                  <Col sm={3}><Form.Group controlId="checkout-pin"><Form.Label>PIN code</Form.Label><Form.Control required pattern="[1-9][0-9]{5}" inputMode="numeric" value={form.postalCode} onChange={(event) => update('postalCode', event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="postal-code" /><Form.Control.Feedback type="invalid">Enter a 6-digit PIN.</Form.Control.Feedback></Form.Group></Col>
                </Row>
              </fieldset>
              <fieldset>
                <legend><span>03</span> The finishing details</legend>
                <Row className="g-3">
                  <Col sm={6}>
                    <Form.Group className="studio-date-field" controlId="checkout-date">
                      <Form.Label>Need it by <small>optional</small></Form.Label>
                      <Form.Control
                        type="date"
                        value={form.occasionDate}
                        min={neededByMinimum}
                        onChange={(event) => update('occasionDate', event.target.value)}
                        isInvalid={validated && neededByInvalid}
                        aria-invalid={validated && neededByInvalid ? true : undefined}
                        aria-describedby="checkout-date-help checkout-date-error"
                        aria-errormessage={validated && neededByInvalid ? 'checkout-date-error' : undefined}
                      />
                      <Form.Control.Feedback id="checkout-date-error" type="invalid">Choose today or a future date.</Form.Control.Feedback>
                      <Form.Text id="checkout-date-help">Choose the date you hope to receive it; the studio confirms feasibility before production.</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col sm={6}><Form.Group controlId="checkout-contact"><Form.Label>Preferred contact</Form.Label><StorefrontSelect id="checkout-contact" value={form.contactPreference} options={contactPreferenceOptions} onChange={(value) => update('contactPreference', value)} ariaLabel="Choose a preferred contact method" /></Form.Group></Col>
                  <Col xs={12}><Form.Group controlId="checkout-notes"><Form.Label>Delivery or gift notes <small>optional</small></Form.Label><Form.Control as="textarea" rows={4} maxLength={500} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Anything the studio should know about the occasion or delivery?" /></Form.Group></Col>
                </Row>
              </fieldset>
              {!user && <Alert variant="info" className="soft-alert sign-in-reminder"><Icon name="lock" /> You’ll be asked to log in with a secure email code or an approved provider when you send this request. Your form is saved on this device.</Alert>}
              <div className="checkout-policy-consent">
                <Form.Check
                  id="checkout-policy-consent"
                  required
                  checked={policiesAccepted}
                  onChange={(event) => setPoliciesAccepted(event.target.checked)}
                  label={<span>I agree to the <Link to="/terms-and-conditions" target="_blank" rel="noreferrer">Terms & Conditions</Link>, <Link to="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</Link> and <Link to="/cancellation-and-refund-policy" target="_blank" rel="noreferrer">Cancellation & Refund Policy</Link>. If I choose online payment, I also consent to sharing the information needed for Razorpay to process and protect the transaction.</span>}
                  feedback="Please review and accept the policies before sending your request."
                  feedbackType="invalid"
                />
                <p><Icon name="shield" size={14} /> We never ask you to send a card number, CVV, UPI PIN or payment OTP.</p>
              </div>
              <Button type={catalogError ? 'button' : 'submit'} onClick={catalogError ? retryBagCheck : undefined} className="button-burgundy checkout-submit" disabled={submitting || shouldDisableBuyingAction({ catalogError, checkPending: bagCheckPending, needsAttention: bagNeedsAttention, acknowledgementRequired: idempotencyConflict })} aria-describedby="checkout-submit-note">{submitting ? <><Spinner size="sm" /> Sending securely…</> : <>{submitLabel}{!bagCheckPending && !catalogError && !bagNeedsAttention && !idempotencyConflict && <Icon name="arrow" />}</>}</Button>
              <p className="checkout-submit-note" id="checkout-submit-note">By sending, you are requesting a studio review—not completing a purchase or payment.</p>
            </Form>
          </Col>
          <Col lg={{ span: 4, offset: 1 }}>
            <CheckoutSummary cart={cart} subtotal={subtotal} offerStatus={offerStatus} offerClaimed={offerClaimed} removeWelcomeOffer={removeWelcomeOffer} />
          </Col>
        </Row>
      </Container>
    </section>
  );
}
