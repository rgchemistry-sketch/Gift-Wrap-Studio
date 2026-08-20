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
import { resolveStudioContact } from '../utils/studio-contact';

const DRAFT_KEY = 'gnw-custom-order-draft';
const initialForm = {
  productType: '', occasion: '', description: '', palette: '', personalization: '', budget: '', neededBy: '', referenceUrl: '', name: '', email: '', phone: '', contactPreference: 'WhatsApp',
};

const stepMeta = [
  ['The idea', 'What are we making?'],
  ['The details', 'Make it unmistakably yours.'],
  ['About you', 'Where can the studio reach you?'],
  ['Review', 'One last look before you send.'],
];

export default function CustomOrderPage() {
  const {
    user,
    sessionOwnerId,
    loading: authLoading,
    requireAuth,
    refreshSession,
  } = useAuth();
  const { notify, studioSettings } = useShop();
  const contact = resolveStudioContact(studioSettings);
  const draftUserId = String(sessionOwnerId || user?.id || '');
  const draftOwner = scopedDraftOwner(draftUserId);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [draftReady, setDraftReady] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [hydratedDraftOwner, setHydratedDraftOwner] = useState('pending');
  const stepHeadingRef = useRef(null);
  const previousStepRef = useRef(step);

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
    setForm({ ...initialForm, ...(savedDraft || {}) });
    setStep(0);
    setError('');
    setSubmitting(false);
    setSubmitted(null);
    setHydratedDraftOwner(draftOwner);
    setDraftReady(true);
  }, [authLoading, draftOwner, draftReady, draftUserId, hydratedDraftOwner]);
  useEffect(() => {
    if (!draftReady || !user) return;
    setForm((current) => ({
      ...current,
      name: current.name || user.name || '',
      email: user.email || current.email,
      phone: current.phone || user.phone || '',
    }));
  }, [draftReady, user]);
  useEffect(() => {
    if (!draftReady || hydratedDraftOwner !== draftOwner) return;
    saveScopedDraft(DRAFT_KEY, draftUserId, form);
  }, [draftOwner, draftReady, draftUserId, form, hydratedDraftOwner]);
  useEffect(() => {
    if (previousStepRef.current === step) return undefined;
    previousStepRef.current = step;
    const focusFrame = window.requestAnimationFrame(() => stepHeadingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(focusFrame);
  }, [step]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (error) setError('');
  };

  const focusStepIssue = (targetStep) => {
    let selector = '';
    if (targetStep === 0) selector = !form.productType ? 'input[name="productType"]' : '#custom-idea';
    if (targetStep === 1) selector = !form.personalization.trim() ? '#custom-personalization' : '#custom-reference';
    if (targetStep === 2) {
      selector = form.name.trim().length < 2
        ? '#inquiry-name'
        : !/^\S+@\S+\.\S+$/.test(form.email)
          ? '#inquiry-email'
          : '#inquiry-phone';
    }
    if (selector) window.requestAnimationFrame(() => document.querySelector(selector)?.focus());
  };

  const validateStep = (targetStep = step) => {
    if (targetStep === 0 && (!form.productType || form.description.trim().length < 10)) {
      return 'Choose a product direction and describe your idea in at least 10 characters.';
    }
    if (targetStep === 1) {
      if (!form.personalization.trim()) return 'Tell us which names, dates, photos, logo or details should be included.';
      if (form.referenceUrl.trim()) {
        try {
          const reference = new URL(form.referenceUrl);
          if (!['http:', 'https:'].includes(reference.protocol)) throw new Error('invalid');
        } catch {
          return 'Enter a complete HTTP or HTTPS reference link.';
        }
      }
    }
    if (targetStep === 2) {
      if (form.name.trim().length < 2) return 'Enter your name using at least 2 characters.';
      if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Enter a valid email address.';
      if (!normalizeIndianMobile(form.phone)) return INDIAN_MOBILE_MESSAGE;
    }
    return '';
  };

  const next = () => {
    const issue = validateStep();
    if (issue) { setError(issue); notify(issue, 'error'); focusStepIssue(step); return; }
    setError('');
    setStep((value) => Math.min(3, value + 1));
    window.scrollTo({ top: 260, behavior: 'smooth' });
  };

  const sendRequest = async (authenticatedUser) => {
    for (let targetStep = 0; targetStep <= 2; targetStep += 1) {
      const issue = validateStep(targetStep);
      if (issue) {
        setStep(targetStep);
        setError(issue);
        notify(issue, 'error');
        window.setTimeout(() => focusStepIssue(targetStep), 0);
        return;
      }
    }
    setError('');
    setSubmitting(true);
    try {
      const result = await api.submitCustomRequest({
        ...form,
        email: authenticatedUser.email,
        phone: normalizeIndianMobile(form.phone),
      }, authenticatedUser.id);
      setSubmitted(result.data || result);
      removeScopedDraft(DRAFT_KEY, authenticatedUser.id);
      notify('Your custom brief reached the studio securely.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      if (requestError.code === 'SESSION_IDENTITY_CHANGED') {
        await refreshSession();
        const message = 'Your signed-in account changed, so this brief was not sent. Please review the current account’s saved draft.';
        setError(message);
        notify(message, 'error');
        return;
      }
      if (requestError.status === 401) {
        requireAuth({
          force: true,
          message: 'Your session expired. Log in again to send this custom brief; your draft is still saved.',
          onAuthenticated: sendRequest,
          onAccountMismatch: () => {
            const message = 'You signed in to a different account, so the previous account’s brief was not sent. Please review the saved draft before trying again.';
            setError(message);
            notify(message, 'error');
          },
        });
        return;
      }
      const firstIssue = Array.isArray(requestError.details) ? requestError.details[0] : null;
      const issueField = String(firstIssue?.field || '');
      if (/^(productId|category|productType|occasion|idea|description)$/.test(issueField)) setStep(0);
      else if (/^(customization|personalization|palette|budget|neededBy|reference)/.test(issueField)) setStep(1);
      else if (/^(name|email|phone|contactPreference)$/.test(issueField)) setStep(2);
      const message = `${firstIssue?.message || requestError.message} Your draft is still saved on this device.`;
      setError(message);
      notify(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    if (!user) {
      requireAuth({
        message: 'Log in or create an account before sending this custom brief. Your complete draft will stay here.',
        onAuthenticated: sendRequest,
        onAccountMismatch: () => {
          const message = 'Your signed-in account changed. Please review this account’s saved brief before sending it.';
          setError(message);
          notify(message, 'warning');
        },
      });
      return;
    }
    void sendRequest(user);
  };

  if (!draftReady || hydratedDraftOwner !== draftOwner) return <RouteLoader />;

  if (submitted) {
    return (
      <Container className="order-confirmation page-section">
        <div className="order-confirmation__mark"><Icon name="spark" size={34} /></div>
        <p className="eyebrow">Custom request received</p>
        <h1>Your idea has a place at our table.</h1>
        <p>Thank you, {form.name}. The studio will review feasibility, design direction, timing and budget before contacting you by {form.contactPreference.toLowerCase()}.</p>
        <Alert variant="info" className="soft-alert"><strong>This is an inquiry, not a confirmed purchase.</strong> No payment has been taken.</Alert>
        <div><Button as={Link} to="/shop" className="button-burgundy">Browse while you wait</Button><Link to="/" className="text-link">Back home <Icon name="arrow" /></Link></div>
      </Container>
    );
  }

  return (
    <>
      <section className="custom-order-hero">
        <Container fluid="xl"><Row className="align-items-center gy-5"><Col lg={6}><p className="eyebrow light-eyebrow">The custom atelier</p><h1>You imagine it.<br /><em>We’ll shape it.</em></h1><p>For the name plaque you can’t quite find, a wedding detail only you would dream of, or a completely new resin object—begin here.</p></Col><Col lg={6}><div className="custom-order-hero__image"><SmartImage src="/assets/personalized-plaque.webp" alt="Personalized floral resin plaque" fallbackLabel="Your idea, handmade" /><span>Custom orders<br />welcome</span></div></Col></Row></Container>
      </section>
      <section className="custom-wizard page-section">
        <Container fluid="xl">
          <div className="wizard-progress" aria-label={`Custom order progress, step ${step + 1} of 4`}>
            {stepMeta.map(([label], index) => <button key={label} type="button" onClick={() => { if (index < step) { setError(''); setStep(index); } }} className={`${index === step ? 'is-active' : ''} ${index < step ? 'is-complete' : ''}`} disabled={index > step} aria-current={index === step ? 'step' : undefined} aria-label={`${label}, step ${index + 1} of 4${index === step ? ', current step' : ''}`}><span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span><small>{label}</small></button>)}
          </div>
          <Row className="g-5 wizard-layout">
            <Col lg={4}><div className="wizard-aside"><p className="eyebrow">Step {step + 1} of 4</p><h2>{stepMeta[step][1]}</h2><p>{step === 0 ? 'Start broad. A few vivid details are more useful than having every measurement worked out.' : step === 1 ? 'Names, flowers, colours and little symbols are what turn an object into your object.' : step === 2 ? 'We keep your details private and use them only to discuss this request.' : 'Nothing goes into production yet. This simply gives our artist enough context to begin the conversation.'}</p>{contact.phoneHref && <div className="wizard-help"><Icon name="phone" /><span>Prefer to talk it through?<a href={contact.phoneHref}>Call {contact.phoneLabel}</a></span></div>}</div></Col>
            <Col lg={{ span: 7, offset: 1 }}>
              <div className="wizard-card" aria-busy={submitting}>
                {error && <Alert variant="danger" className="soft-alert" role="alert">{error}</Alert>}
                {step === 0 && <StepIdea form={form} update={update} headingRef={stepHeadingRef} />}
                {step === 1 && <StepDetails form={form} update={update} headingRef={stepHeadingRef} />}
                {step === 2 && <StepContact form={form} update={update} headingRef={stepHeadingRef} />}
                {step === 3 && <StepReview form={form} edit={setStep} headingRef={stepHeadingRef} />}
                <div className="wizard-actions">
                  {step > 0 && <Button type="button" variant="link" className="plain-link" onClick={() => { setError(''); setStep((value) => value - 1); }}>Back</Button>}
                  {step < 3 ? <Button type="button" className="button-burgundy" onClick={next}>Continue <Icon name="arrow" /></Button> : <Button type="button" className="button-burgundy" onClick={submit} disabled={submitting}>{submitting ? <><Spinner size="sm" /> Sending…</> : <>Send to the studio <Icon name="arrow" /></>}</Button>}
                </div>
                <p className="wizard-saved"><Icon name="check" size={13} /> Your progress is saved on this device.</p>
              </div>
            </Col>
          </Row>
        </Container>
      </section>
    </>
  );
}

function StepIdea({ form, update, headingRef }) {
  return <div className="wizard-step"><p className="eyebrow">The starting point</p><h3 ref={headingRef} tabIndex="-1">What would you love us to create?</h3><Form.Group className="form-field"><Form.Label>Type of piece <small>required</small></Form.Label><div className="choice-grid">{['Name plaque', 'Wall clock', 'Wedding keepsake', 'Serving piece', 'Home décor', 'Something new'].map((option) => <label key={option}><input type="radio" name="productType" required checked={form.productType === option} onChange={() => update('productType', option)} /><span><Icon name="spark" />{option}</span></label>)}</div></Form.Group><Form.Group className="form-field" controlId="custom-idea"><Form.Label>Describe the idea <small>required</small></Form.Label><Form.Control required minLength={10} as="textarea" rows={5} value={form.description} maxLength={800} onChange={(event) => update('description', event.target.value)} placeholder="Who is it for, what should it feel like, and what made you imagine it?" /><div className="character-count">{form.description.length}/800</div></Form.Group><Row className="g-3"><Col sm={6}><Form.Group controlId="custom-occasion"><Form.Label>Occasion <small>optional</small></Form.Label><Form.Select value={form.occasion} onChange={(event) => update('occasion', event.target.value)}><option value="">Select one</option><option>Birthday</option><option>Wedding</option><option>Anniversary</option><option>Housewarming</option><option>Corporate event</option><option>Memorial</option><option>Just because</option></Form.Select></Form.Group></Col><Col sm={6}><Form.Group controlId="custom-date-needed"><Form.Label>Needed by <small>optional</small></Form.Label><Form.Control type="date" min={new Date().toISOString().slice(0, 10)} value={form.neededBy} onChange={(event) => update('neededBy', event.target.value)} /></Form.Group></Col></Row></div>;
}

function StepDetails({ form, update, headingRef }) {
  return <div className="wizard-step"><p className="eyebrow">The personal layer</p><h3 ref={headingRef} tabIndex="-1">Which details should live inside it?</h3><Form.Group className="form-field" controlId="custom-personalization"><Form.Label>Names, dates, photos, logo or special elements <small>required</small></Form.Label><Form.Control required as="textarea" rows={5} value={form.personalization} maxLength={600} onChange={(event) => update('personalization', event.target.value)} placeholder="e.g. Names Aarya & Kabir, wedding date, ivory flowers, one printed photograph…" /><div className="character-count">{form.personalization.length}/600</div></Form.Group><Form.Group className="form-field" controlId="custom-palette"><Form.Label>Colour or theme direction <small>optional</small></Form.Label><Form.Control value={form.palette} onChange={(event) => update('palette', event.target.value)} placeholder="e.g. Deep green geode with restrained gold" /></Form.Group><Row className="g-3"><Col sm={6}><Form.Group controlId="custom-budget"><Form.Label>Comfortable budget <small>optional</small></Form.Label><Form.Select value={form.budget} onChange={(event) => update('budget', event.target.value)}><option value="">Choose a range</option><option>Under ₹1,500</option><option>₹1,500 – ₹3,000</option><option>₹3,000 – ₹6,000</option><option>₹6,000 – ₹10,000</option><option>₹10,000+</option><option>Need guidance</option></Form.Select></Form.Group></Col><Col sm={6}><Form.Group controlId="custom-reference"><Form.Label>Reference link <small>optional</small></Form.Label><Form.Control type="url" value={form.referenceUrl} onChange={(event) => update('referenceUrl', event.target.value)} placeholder="Pinterest, Drive or Instagram URL" /></Form.Group></Col></Row><p className="form-tip"><Icon name="upload" /> You can share full-resolution photos with the studio after the first review, so precious files aren’t compressed unnecessarily.</p></div>;
}

function StepContact({ form, update, headingRef }) {
  const { user } = useAuth();
  return <div className="wizard-step"><p className="eyebrow">Stay in the loop</p><h3 ref={headingRef} tabIndex="-1">How should we continue the conversation?</h3><Row className="g-3"><Col sm={6}><Form.Group controlId="inquiry-name"><Form.Label>Your name <small>required</small></Form.Label><Form.Control required minLength={2} value={form.name} maxLength={100} onChange={(event) => update('name', event.target.value)} autoComplete="name" /></Form.Group></Col><Col sm={6}><Form.Group controlId="inquiry-phone"><Form.Label>Mobile number <small>required</small></Form.Label><Form.Control required type="tel" inputMode="tel" maxLength={24} value={form.phone} onChange={(event) => update('phone', event.target.value)} autoComplete="tel" placeholder="09876543210 or +91 98765 43210" /><Form.Text>Use a 10-digit Indian mobile, optionally beginning with 0 or +91.</Form.Text></Form.Group></Col><Col xs={12}><Form.Group controlId="inquiry-email"><Form.Label>Email address <small>required</small></Form.Label><Form.Control required readOnly={Boolean(user)} type="email" maxLength={254} value={form.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" />{user && <Form.Text>Replies will go to your verified account email.</Form.Text>}</Form.Group></Col><Col xs={12}><Form.Group controlId="inquiry-contact"><Form.Label>Preferred contact</Form.Label><div className="inline-choices">{['WhatsApp', 'Phone call', 'Email'].map((option) => <Form.Check key={option} inline type="radio" name="contactPreference" id={`contact-${option.toLowerCase().replace(/\s+/g, '-')}`} label={option} checked={form.contactPreference === option} onChange={() => update('contactPreference', option)} />)}</div></Form.Group></Col></Row><Alert variant="info" className="soft-alert privacy-inline"><Icon name="shield" /> Your contact details are used only to respond to this request.</Alert></div>;
}

function StepReview({ form, edit, headingRef }) {
  const rows = [
    ['Piece', form.productType, 0],
    ['Occasion', form.occasion || 'Not specified', 0],
    ['Your idea', form.description, 0],
    ['Personal details', form.personalization, 1],
    ['Palette', form.palette || 'Artist guidance requested', 1],
    ['Budget', form.budget || 'To discuss', 1],
    ['Needed by', form.neededBy || 'No fixed date', 0],
    ['Contact', `${form.name} · ${form.phone} · ${form.email}`, 2],
    ['Preferred contact', form.contactPreference, 2],
  ];
  return <div className="wizard-step review-step"><p className="eyebrow">Review your request</p><h3 ref={headingRef} tabIndex="-1">Does this sound like your idea?</h3><div className="review-list">{rows.map(([label, value, ownerStep]) => <div key={label}><span>{label}</span><p>{value}</p><button type="button" onClick={() => edit(ownerStep)}>Edit</button></div>)}</div><Alert variant="info" className="soft-alert"><strong>Sending this is free.</strong> The studio will review the brief and contact you before any design is confirmed or payment is requested.</Alert></div>;
}
