import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import CustomReferenceUpload from '../components/CustomReferenceUpload';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import StorefrontSelect from '../components/StorefrontSelect';
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
import { resolveStudioContact } from '../utils/studio-contact';
import { applyCorporateBriefPreset } from '../utils/custom-order-preset';
import { localDateInputValue } from '../utils/date-input';
import {
  normalizeCustomReferenceImages,
  shouldDiscardCustomReferences,
} from '../utils/custom-reference-upload';
import '../form-experience.css';
import {
  customInquiryPayload,
  customOrderStepErrors,
  firstCustomOrderError,
  isCorporateCustomOrder,
  selectCustomOrderProductType,
} from '../utils/custom-order-validation';

const DRAFT_KEY = 'gnw-custom-order-draft';
const initialForm = {
  requestKind: 'personal',
  company: '',
  quantity: '',
  productType: '',
  occasion: '',
  description: '',
  palette: '',
  personalization: '',
  budget: '',
  neededBy: '',
  referenceUrl: '',
  referenceImages: [],
  name: '',
  email: '',
  phone: '',
  contactPreference: 'WhatsApp',
};

const stepMeta = [
  ['The idea', 'What are we making?'],
  ['The details', 'Make it unmistakably yours.'],
  ['About you', 'Where can the studio reach you?'],
  ['Review', 'One last look before you send.'],
];

const occasionOptions = [
  { value: '', label: 'Select one' },
  'Birthday',
  'Wedding',
  'Anniversary',
  'Housewarming',
  'Corporate event',
  'Memorial',
  'Just because',
];

const budgetOptions = [
  { value: '', label: 'Choose a range' },
  'Under ₹1,500',
  '₹1,500 – ₹3,000',
  '₹3,000 – ₹6,000',
  '₹6,000 – ₹10,000',
  '₹10,000+',
  'Need guidance',
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
  const [searchParams] = useSearchParams();
  const startsAsCorporate = searchParams.get('brief') === 'corporate';
  const contact = resolveStudioContact(studioSettings);
  const draftUserId = String(sessionOwnerId || user?.id || '');
  const draftOwner = scopedDraftOwner(draftUserId);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [draftReady, setDraftReady] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [hydratedDraftOwner, setHydratedDraftOwner] = useState('pending');
  const stepHeadingRef = useRef(null);
  const wizardCardRef = useRef(null);
  const previousStepRef = useRef(step);
  const formRef = useRef(form);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    if (authLoading) return;
    const previousOwner = hydratedDraftOwner;
    if (previousOwner === draftOwner && draftReady) {
      if (startsAsCorporate) {
        setForm((current) => applyCorporateBriefPreset(current));
        setStep(0);
        setError('');
        setFieldErrors({});
      }
      return;
    }
    if (shouldDiscardCustomReferences(previousOwner, draftOwner)) {
      const abandonedImages = normalizeCustomReferenceImages(
        formRef.current.referenceImages,
        { ownerId: previousOwner },
      );
      abandonedImages.forEach(({ publicId }) => {
        void api.deleteUploadedAsset(publicId).catch(() => {});
      });
    }
    const transferGuest = Boolean(draftUserId)
      && (previousOwner === 'pending' || previousOwner === 'guest');
    const savedDraft = loadScopedDraft(DRAFT_KEY, draftUserId, {
      transferGuest,
      migrateLegacy: previousOwner === 'pending' && Boolean(draftUserId),
    });
    const restoredForm = {
      ...initialForm,
      ...(savedDraft || {}),
      referenceImages: normalizeCustomReferenceImages(savedDraft?.referenceImages, {
        ownerId: draftUserId,
      }),
    };
    setForm(startsAsCorporate
      ? applyCorporateBriefPreset(restoredForm, { preserveAnswers: Boolean(savedDraft) })
      : restoredForm);
    setStep(0);
    setError('');
    setFieldErrors({});
    setSubmitting(false);
    setReferenceBusy(false);
    setSubmitted(null);
    setHydratedDraftOwner(draftOwner);
    setDraftReady(true);
  }, [authLoading, draftOwner, draftReady, draftUserId, hydratedDraftOwner, startsAsCorporate]);
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
    saveScopedDraft(DRAFT_KEY, draftUserId, {
      ...form,
      referenceImages: normalizeCustomReferenceImages(form.referenceImages, {
        ownerId: draftUserId,
      }),
    });
  }, [draftOwner, draftReady, draftUserId, form, hydratedDraftOwner]);
  useEffect(() => {
    if (previousStepRef.current === step) return undefined;
    previousStepRef.current = step;
    const focusFrame = window.requestAnimationFrame(() => stepHeadingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(focusFrame);
  }, [step]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const nextErrors = { ...current };
      delete nextErrors[key];
      return nextErrors;
    });
    if (error) setError('');
  };

  const updateProductType = (productType) => {
    setForm((current) => selectCustomOrderProductType(current, productType));
    setFieldErrors((current) => {
      const nextErrors = { ...current };
      delete nextErrors.productType;
      delete nextErrors.company;
      delete nextErrors.quantity;
      return nextErrors;
    });
    if (error) setError('');
  };

  const focusStepIssue = (errors) => {
    const firstField = Object.keys(errors)[0];
    const selectors = {
      productType: 'input[name="productType"]',
      company: '#custom-company',
      quantity: '#custom-quantity',
      description: '#custom-idea',
      neededBy: '#custom-date-needed',
      personalization: '#custom-personalization',
      referenceUrl: '#custom-reference',
      referenceImages: '.custom-reference-upload button',
      name: '#inquiry-name',
      email: '#inquiry-email',
      phone: '#inquiry-phone',
    };
    const field = document.querySelector(selectors[firstField]);
    const focusTarget = field?.closest('.form-field, .col-sm-6, .col-12') || field;
    wizardCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      focusTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field?.focus({ preventScroll: true });
    }, 240);
  };

  const next = () => {
    if (referenceBusy) {
      const message = 'Wait for the reference image upload to finish, or remove its preview before continuing.';
      setError(message);
      notify(message, 'info');
      return;
    }
    const errors = customOrderStepErrors(form, step);
    const issue = firstCustomOrderError(errors);
    if (issue) {
      setFieldErrors(errors);
      setError('Please correct the highlighted details before continuing.');
      notify(issue, 'error');
      focusStepIssue(errors);
      return;
    }
    setError('');
    setFieldErrors({});
    setStep((value) => Math.min(3, value + 1));
    window.requestAnimationFrame(() => wizardCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const sendRequest = async (authenticatedUser) => {
    const verifiedReferences = normalizeCustomReferenceImages(form.referenceImages, {
      ownerId: authenticatedUser.id,
    });
    if (verifiedReferences.length !== form.referenceImages.length) {
      const message = 'A reference image expired or no longer belongs to this session. Please attach it again before sending.';
      setForm((current) => ({ ...current, referenceImages: verifiedReferences }));
      setStep(1);
      setFieldErrors({ referenceImages: message });
      setError(message);
      notify(message, 'error');
      window.setTimeout(() => focusStepIssue({ referenceImages: message }), 0);
      return;
    }
    for (let targetStep = 0; targetStep <= 2; targetStep += 1) {
      const errors = customOrderStepErrors(form, targetStep);
      const issue = firstCustomOrderError(errors);
      if (issue) {
        setStep(targetStep);
        setFieldErrors(errors);
        setError('Please correct the highlighted details before sending your brief.');
        notify(issue, 'error');
        window.setTimeout(() => focusStepIssue(errors), 0);
        return;
      }
    }
    setError('');
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await api.submitCustomRequest(
        customInquiryPayload(form, authenticatedUser.email, authenticatedUser.id),
        authenticatedUser.id,
      );
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
      let issueStep = step;
      if (/^(productId|category|productType|occasion|idea|description|neededBy)$/.test(issueField)) issueStep = 0;
      else if (/^(customization|personalization|palette|budget|reference)/.test(issueField)) issueStep = 1;
      else if (/^(name|email|phone|contactPreference)$/.test(issueField)) issueStep = 2;
      setStep(issueStep);
      const mappedField = {
        category: 'productType',
        idea: 'description',
        customization: 'personalization',
        reference: 'referenceUrl',
        referenceImages: 'referenceImages',
      }[issueField] || issueField;
      if (mappedField && firstIssue?.message) {
        const serverErrors = { [mappedField]: firstIssue.message };
        setFieldErrors(serverErrors);
        window.setTimeout(() => focusStepIssue(serverErrors), 0);
      }
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
        <Container fluid="xl"><Row className="align-items-center gy-5"><Col lg={6}><p className="eyebrow light-eyebrow">The custom atelier</p><h1>You imagine it.{' '}<br /><em>We’ll shape it.</em></h1><p>For the name plaque you can’t quite find, a wedding detail only you would dream of, or a completely new resin object—begin here.</p></Col><Col lg={6}><div className="custom-order-hero__image"><SmartImage src="/assets/personalized-plaque.webp" alt="Personalized floral resin plaque" fallbackLabel="Your idea, handmade" /><span>Custom orders{' '}<br />welcome</span></div></Col></Row></Container>
      </section>
      <section className="custom-wizard page-section">
        <Container fluid="xl">
          <div className="wizard-progress" aria-label={`Custom order progress, step ${step + 1} of 4`}>
            {stepMeta.map(([label], index) => <button key={label} type="button" onClick={() => { if (!referenceBusy && index < step) { setError(''); setFieldErrors({}); setStep(index); } }} className={`${index === step ? 'is-active' : ''} ${index < step ? 'is-complete' : ''}`} disabled={index > step || referenceBusy} aria-current={index === step ? 'step' : undefined} aria-label={`${label}, step ${index + 1} of 4${index === step ? ', current step' : ''}`}><span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span><small>{label}</small></button>)}
          </div>
          <Row className="g-5 wizard-layout">
            <Col lg={4}><div className="wizard-aside"><p className="eyebrow">Step {step + 1} of 4</p><h2>{stepMeta[step][1]}</h2><p>{step === 0 ? 'Start broad. A few vivid details are more useful than having every measurement worked out.' : step === 1 ? 'Names, flowers, colours and little symbols are what turn an object into your object.' : step === 2 ? 'We keep your details private and use them only to discuss this request.' : 'Nothing goes into production yet. This simply gives our artist enough context to begin the conversation.'}</p>{contact.phoneHref && <div className="wizard-help"><Icon name="phone" /><span>Prefer to talk it through?<a href={contact.phoneHref}>Call {contact.phoneLabel}</a></span></div>}</div></Col>
            <Col lg={{ span: 7, offset: 1 }}>
              <div ref={wizardCardRef} className="wizard-card" aria-busy={submitting}>
                {error && <Alert variant="danger" className="soft-alert" role="alert">{error}</Alert>}
                {step === 0 && <StepIdea form={form} update={update} updateProductType={updateProductType} errors={fieldErrors} headingRef={stepHeadingRef} />}
                {step === 1 && <StepDetails form={form} update={update} errors={fieldErrors} headingRef={stepHeadingRef} ownerId={draftUserId} onReferenceBusyChange={setReferenceBusy} />}
                {step === 2 && <StepContact form={form} update={update} errors={fieldErrors} headingRef={stepHeadingRef} />}
                {step === 3 && <StepReview form={form} edit={(targetStep) => { setError(''); setFieldErrors({}); setStep(targetStep); }} headingRef={stepHeadingRef} />}
                <div className="wizard-actions">
                  {step > 0 && <Button type="button" variant="link" className="plain-link" disabled={referenceBusy} onClick={() => { setError(''); setFieldErrors({}); setStep((value) => value - 1); }}>Back</Button>}
                  {step < 3 ? <Button type="button" className="button-burgundy" onClick={next} disabled={referenceBusy}>{referenceBusy ? <><Spinner size="sm" /> Uploading reference…</> : <>Continue <Icon name="arrow" /></>}</Button> : <Button type="button" className="button-burgundy" onClick={submit} disabled={submitting || referenceBusy}>{submitting ? <><Spinner size="sm" /> Sending…</> : <>Send to the studio <Icon name="arrow" /></>}</Button>}
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

function StepIdea({ form, update, updateProductType, errors, headingRef }) {
  const corporate = isCorporateCustomOrder(form);
  const productTypeError = errors.productType ? 'custom-product-type-error' : undefined;
  const neededByMinimum = localDateInputValue();

  return (
    <div className="wizard-step">
      <p className="eyebrow">The starting point</p>
      <h3 ref={headingRef} tabIndex="-1">What would you love us to create?</h3>
      <Form.Group className="form-field" id="custom-product-type">
        <Form.Label>Type of piece</Form.Label>
        <div
          className={`choice-grid${errors.productType ? ' is-invalid' : ''}`}
          role="radiogroup"
          aria-label="Type of piece"
          aria-invalid={errors.productType ? true : undefined}
          aria-describedby={productTypeError}
        >
          {['Name plaque', 'Wall clock', 'Wedding keepsake', 'Serving piece', 'Home décor', 'Corporate gifts', 'Something new'].map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="productType"
                required
                checked={form.productType === option}
                onClick={() => {
                  if (
                    form.requestKind === 'corporate'
                    && form.productType === option
                    && option !== 'Corporate gifts'
                  ) updateProductType(option);
                }}
                onChange={() => updateProductType(option)}
              />
              <span><Icon name="spark" />{option}</span>
            </label>
          ))}
        </div>
        {errors.productType && <div id={productTypeError} className="invalid-feedback d-block">{errors.productType}</div>}
      </Form.Group>

      {corporate && (
        <div className="corporate-brief-fields" aria-label="Corporate brief details">
          <p><Icon name="package" /> A few scale details help us recommend realistic formats and timing.</p>
          <Row className="g-3">
            <Col sm={7}>
              <Form.Group controlId="custom-company">
                <Form.Label>Company or organisation</Form.Label>
                <Form.Control
                  required
                  maxLength={120}
                  autoComplete="organization"
                  value={form.company}
                  onChange={(event) => update('company', event.target.value)}
                  isInvalid={Boolean(errors.company)}
                  aria-describedby={errors.company ? 'custom-company-error' : undefined}
                />
                <Form.Control.Feedback id="custom-company-error" type="invalid">{errors.company}</Form.Control.Feedback>
              </Form.Group>
            </Col>
            <Col sm={5}>
              <Form.Group controlId="custom-quantity">
                <Form.Label>Estimated quantity</Form.Label>
                <Form.Control
                  required
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100000"
                  step="1"
                  value={form.quantity}
                  onChange={(event) => update('quantity', event.target.value)}
                  isInvalid={Boolean(errors.quantity)}
                  aria-describedby={errors.quantity ? 'custom-quantity-error' : undefined}
                />
                <Form.Control.Feedback id="custom-quantity-error" type="invalid">{errors.quantity}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>
        </div>
      )}

      <Form.Group className="form-field" controlId="custom-idea">
        <Form.Label>Describe the idea</Form.Label>
        <Form.Control
          required
          minLength={10}
          as="textarea"
          rows={5}
          value={form.description}
          maxLength={800}
          onChange={(event) => update('description', event.target.value)}
          isInvalid={Boolean(errors.description)}
          aria-describedby={`custom-idea-error custom-idea-count`}
          placeholder="Who is it for, what should it feel like, and what made you imagine it?"
        />
        <Form.Control.Feedback id="custom-idea-error" type="invalid">{errors.description}</Form.Control.Feedback>
        <div className="character-count" id="custom-idea-count">{form.description.length}/800</div>
      </Form.Group>
      <Row className="g-3">
        <Col sm={6}>
          <Form.Group controlId="custom-occasion">
            <Form.Label>Occasion <small>optional</small></Form.Label>
            <StorefrontSelect id="custom-occasion" value={form.occasion} options={occasionOptions} onChange={(value) => update('occasion', value)} ariaLabel="Choose an occasion" />
          </Form.Group>
        </Col>
        <Col sm={6}>
          <Form.Group className="studio-date-field" controlId="custom-date-needed">
            <Form.Label>Needed by <small>optional</small></Form.Label>
            <Form.Control
              type="date"
              min={neededByMinimum}
              value={form.neededBy}
              onChange={(event) => update('neededBy', event.target.value)}
              isInvalid={Boolean(errors.neededBy)}
              aria-invalid={errors.neededBy ? true : undefined}
              aria-describedby="custom-date-needed-help custom-date-needed-error"
              aria-errormessage={errors.neededBy ? 'custom-date-needed-error' : undefined}
            />
            <Form.Control.Feedback id="custom-date-needed-error" type="invalid">{errors.neededBy}</Form.Control.Feedback>
            <Form.Text id="custom-date-needed-help">Choose today or later; the studio will confirm whether the timing is possible.</Form.Text>
          </Form.Group>
        </Col>
      </Row>
    </div>
  );
}

function StepDetails({
  form,
  update,
  errors,
  headingRef,
  ownerId,
  onReferenceBusyChange,
}) {
  return (
    <div className="wizard-step">
      <p className="eyebrow">The personal layer</p>
      <h3 ref={headingRef} tabIndex="-1">Which details should live inside it?</h3>
      <Form.Group className="form-field" controlId="custom-personalization">
        <Form.Label>Names, dates, photos, logo or special elements</Form.Label>
        <Form.Control
          required
          as="textarea"
          rows={5}
          value={form.personalization}
          maxLength={600}
          onChange={(event) => update('personalization', event.target.value)}
          isInvalid={Boolean(errors.personalization)}
          aria-describedby="custom-personalization-error custom-personalization-count"
          placeholder="e.g. Names Aarya & Kabir, wedding date, ivory flowers, one printed photograph…"
        />
        <Form.Control.Feedback id="custom-personalization-error" type="invalid">{errors.personalization}</Form.Control.Feedback>
        <div className="character-count" id="custom-personalization-count">{form.personalization.length}/600</div>
      </Form.Group>
      <Form.Group className="form-field" controlId="custom-palette">
        <Form.Label>Colour or theme direction <small>optional</small></Form.Label>
        <Form.Control value={form.palette} onChange={(event) => update('palette', event.target.value)} placeholder="e.g. Deep green geode with restrained gold" />
      </Form.Group>
      <Row className="g-3">
        <Col sm={6}>
          <Form.Group controlId="custom-budget">
            <Form.Label>Comfortable budget <small>optional</small></Form.Label>
            <StorefrontSelect id="custom-budget" value={form.budget} options={budgetOptions} onChange={(value) => update('budget', value)} ariaLabel="Choose a comfortable budget" />
          </Form.Group>
        </Col>
        <Col sm={6}>
          <Form.Group controlId="custom-reference">
            <Form.Label>Reference link <small>optional</small></Form.Label>
            <Form.Control
              type="url"
              value={form.referenceUrl}
              onChange={(event) => update('referenceUrl', event.target.value)}
              isInvalid={Boolean(errors.referenceUrl)}
              aria-describedby={errors.referenceUrl ? 'custom-reference-error' : undefined}
              placeholder="Pinterest, Drive or Instagram URL"
            />
            <Form.Control.Feedback id="custom-reference-error" type="invalid">{errors.referenceUrl}</Form.Control.Feedback>
          </Form.Group>
        </Col>
      </Row>
      <CustomReferenceUpload
        images={form.referenceImages}
        ownerId={ownerId}
        onChange={(images) => update('referenceImages', images)}
        onBusyChange={onReferenceBusyChange}
        error={errors.referenceImages}
      />
    </div>
  );
}

function StepContact({ form, update, errors, headingRef }) {
  const { user } = useAuth();
  return (
    <div className="wizard-step">
      <p className="eyebrow">Stay in the loop</p>
      <h3 ref={headingRef} tabIndex="-1">How should we continue the conversation?</h3>
      <Row className="g-3">
        <Col sm={6}>
          <Form.Group controlId="inquiry-name">
            <Form.Label>Your name</Form.Label>
            <Form.Control required minLength={2} value={form.name} maxLength={100} onChange={(event) => update('name', event.target.value)} autoComplete="name" isInvalid={Boolean(errors.name)} aria-describedby={errors.name ? 'inquiry-name-error' : undefined} />
            <Form.Control.Feedback id="inquiry-name-error" type="invalid">{errors.name}</Form.Control.Feedback>
          </Form.Group>
        </Col>
        <Col sm={6}>
          <Form.Group controlId="inquiry-phone">
            <Form.Label>Mobile number</Form.Label>
            <Form.Control required type="tel" inputMode="tel" maxLength={24} value={form.phone} onChange={(event) => update('phone', event.target.value)} autoComplete="tel" isInvalid={Boolean(errors.phone)} aria-describedby="inquiry-phone-error inquiry-phone-help" placeholder="09876543210 or +91 98765 43210" />
            <Form.Control.Feedback id="inquiry-phone-error" type="invalid">{errors.phone}</Form.Control.Feedback>
            <Form.Text id="inquiry-phone-help">Use a 10-digit Indian mobile, optionally beginning with 0 or +91.</Form.Text>
          </Form.Group>
        </Col>
        <Col xs={12}>
          <Form.Group controlId="inquiry-email">
            <Form.Label>Email address</Form.Label>
            <Form.Control required readOnly={Boolean(user)} className={user ? 'verified-readonly' : ''} aria-readonly={user ? true : undefined} type="email" maxLength={254} value={form.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" isInvalid={Boolean(errors.email)} aria-describedby="inquiry-email-error inquiry-email-help" />
            <Form.Control.Feedback id="inquiry-email-error" type="invalid">{errors.email}</Form.Control.Feedback>
            {user && <Form.Text id="inquiry-email-help"><Icon name="lock" size={12} /> Verified account email—change it by signing in with another account.</Form.Text>}
          </Form.Group>
        </Col>
        <Col xs={12}>
          <Form.Group controlId="inquiry-contact">
            <Form.Label>Preferred contact</Form.Label>
            <div className="inline-choices" role="radiogroup" aria-label="Preferred contact method">
              {['WhatsApp', 'Phone call', 'Email'].map((option) => <Form.Check key={option} inline type="radio" name="contactPreference" id={`contact-${option.toLowerCase().replace(/\s+/g, '-')}`} label={option} checked={form.contactPreference === option} onChange={() => update('contactPreference', option)} />)}
            </div>
          </Form.Group>
        </Col>
      </Row>
      <Alert variant="info" className="soft-alert privacy-inline"><Icon name="shield" /> Your contact details are used only to respond to this request.</Alert>
    </div>
  );
}

function StepReview({ form, edit, headingRef }) {
  const corporateRows = isCorporateCustomOrder(form)
    ? [
      ['Company', form.company, 0],
      ['Quantity', `${Number(form.quantity).toLocaleString('en-IN')} pieces`, 0],
    ]
    : [];
  const rows = [
    ['Piece', form.productType, 0],
    ...corporateRows,
    ['Occasion', form.occasion || 'Not specified', 0],
    ['Your idea', form.description, 0],
    ['Personal details', form.personalization, 1],
    ['Palette', form.palette || 'Artist guidance requested', 1],
    ['Budget', form.budget || 'To discuss', 1],
    ...(form.referenceImages?.length
      ? [['Reference images', `${form.referenceImages.length} securely attached`, 1]]
      : []),
    ['Needed by', form.neededBy || 'No fixed date', 0],
    ['Contact', `${form.name} · ${form.phone} · ${form.email}`, 2],
    ['Preferred contact', form.contactPreference, 2],
  ];
  return (
    <div className="wizard-step review-step">
      <p className="eyebrow">Review your request</p>
      <h3 ref={headingRef} tabIndex="-1">Does this sound like your idea?</h3>
      <div className="review-list">
        {rows.map(([label, value, ownerStep]) => (
          <div key={label}>
            <span>{label}</span>
            <p>{value}</p>
            <button type="button" onClick={() => edit(ownerStep)} aria-label={`Edit ${label.toLowerCase()}`}>Edit</button>
          </div>
        ))}
      </div>
      <Alert variant="info" className="soft-alert"><strong>Sending this is free.</strong> The studio will review the brief and contact you before any design is confirmed or payment is requested.</Alert>
    </div>
  );
}
