import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Accordion from 'react-bootstrap/Accordion';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../components/Icon';
import StorefrontSelect from '../components/StorefrontSelect';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { resolveStudioContact } from '../utils/studio-contact';
import '../form-experience.css';
import {
  INDIAN_MOBILE_MESSAGE,
  normalizeIndianMobile,
} from '../../shared/indian-phone.js';

const faq = [
  ['Can I customize every product?', 'Most products marked “Customizable” support names, dates, colours, finishes and other product-specific details.'],
  ['Do you accept bulk orders?', 'Yes. Share your quantity, occasion, date and budget through the custom order form.'],
  ['Can I add names and photos?', 'Yes, where the product supports them. You can preview and securely upload supported images while personalizing.'],
  ['Do you make corporate gifts?', 'Yes—logo plaques, employee awards, desk pieces, hampers, event souvenirs and more.'],
  ['Do you deliver across India?', 'Yes. Every piece is carefully packaged for PAN India delivery.'],
  ['Can I request a completely new design?', 'Absolutely. Begin a custom request and describe what you have in mind.'],
];

const contactFieldNames = new Set(['name', 'email', 'phone', 'subject', 'message']);
const fieldErrorsFrom = (details) => Object.fromEntries(
  (Array.isArray(details) ? details : [])
    .filter((issue) => contactFieldNames.has(issue?.field) && issue?.message)
    .map((issue) => [issue.field, issue.message]),
);

const focusContactField = (field) => {
  if (!field) return;
  window.requestAnimationFrame(() => document.getElementById(`contact-${field}`)?.focus());
};

const emptyContactForm = {
  name: '',
  email: '',
  phone: '',
  subject: 'Product question',
  message: '',
};

const subjectOptions = [
  'Product question',
  'Existing order',
  'Custom design',
  'Corporate or bulk gifting',
  'Delivery and care',
];

export default function ContactPage() {
  const { user, sessionOwnerId, requireAuth, refreshSession } = useAuth();
  const { studioSettings, notify } = useShop();
  const contact = resolveStudioContact(studioSettings);
  const formRef = useRef(null);
  const formOwnerRef = useRef('guest');
  const [form, setForm] = useState(emptyContactForm);
  const [state, setState] = useState({ submitting: false, error: '', sent: false });
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    const nextOwner = String(sessionOwnerId || user?.id || '') || 'guest';
    const previousOwner = formOwnerRef.current;
    if (previousOwner !== nextOwner && previousOwner !== 'guest') {
      setForm({
        ...emptyContactForm,
        name: user?.name || '',
        email: user?.email || '',
      });
      setFieldErrors({});
      setState({ submitting: false, error: '', sent: false });
      formOwnerRef.current = nextOwner;
      return;
    }
    formOwnerRef.current = nextOwner;
    if (!user) return;
    setForm((current) => ({
      ...current,
      name: current.name || user.name || '',
      email: user.email || current.email,
    }));
  }, [sessionOwnerId, user]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => current[key] ? { ...current, [key]: '' } : current);
    setState((current) => current.error || current.sent
      ? { ...current, error: '', sent: false }
      : current);
  };
  const sendMessage = async (formElement, authenticatedUser) => {
    if (!formElement) return;
    const normalizedPhone = form.phone.trim() ? normalizeIndianMobile(form.phone) : '';
    const clientFieldErrors = {
      ...(form.name.trim().length < 2 ? { name: 'Enter at least 2 characters.' } : {}),
      ...(normalizedPhone === null ? { phone: INDIAN_MOBILE_MESSAGE } : {}),
      ...(form.message.trim().length < 10
        ? { message: 'Write at least 10 characters so we can understand how to help.' }
        : {}),
    };
    if (!formElement.checkValidity() || Object.keys(clientFieldErrors).length) {
      formElement.classList.add('was-validated');
      setFieldErrors(clientFieldErrors);
      setState({
        submitting: false,
        error: 'Please correct the highlighted fields. Your message has not been sent.',
        sent: false,
      });
      notify('Please correct the highlighted fields before sending your message.', 'error');
      focusContactField(Object.keys(clientFieldErrors)[0]);
      if (!Object.keys(clientFieldErrors).length) {
        window.requestAnimationFrame(() => formElement.querySelector(':invalid')?.focus());
      }
      return;
    }
    formElement.classList.remove('was-validated');
    setFieldErrors({});
    setState({ submitting: true, error: '', sent: false });
    try {
      await api.submitContact({
        ...form,
        email: authenticatedUser.email,
        phone: normalizedPhone,
      }, authenticatedUser.id);
      setState({ submitting: false, error: '', sent: true });
      setForm({
        name: authenticatedUser.name || form.name,
        email: authenticatedUser.email,
        phone: '',
        subject: 'Product question',
        message: '',
      });
      notify('Your message reached the studio. We’ll reply as soon as we can.');
    } catch (error) {
      if (error.code === 'SESSION_IDENTITY_CHANGED') {
        await refreshSession();
        const message = 'Your signed-in account changed, so this message was not sent. Please review the current account details and try again.';
        setState({ submitting: false, error: message, sent: false });
        notify(message, 'error');
        return;
      }
      if (error.status === 401) {
        setState({ submitting: false, error: '', sent: false });
        requireAuth({
          force: true,
          message: 'Your session expired. Log in again to send this message; everything you wrote is still here.',
          onAuthenticated: (nextUser) => sendMessage(formRef.current, nextUser),
          onAccountMismatch: () => {
            const message = 'You signed in to a different account, so this message was not sent. Please review the details before trying again.';
            setState({ submitting: false, error: message, sent: false });
            notify(message, 'error');
          },
        });
        return;
      }
      const serverFieldErrors = fieldErrorsFrom(error.details);
      const hasFieldErrors = Object.keys(serverFieldErrors).length > 0;
      setFieldErrors(serverFieldErrors);
      focusContactField(Object.keys(serverFieldErrors)[0]);
      const message = hasFieldErrors
        ? 'Please correct the highlighted fields. Your message has not been sent.'
        : `${error.message} Your message was not sent. Please try again${contact.phone ? ' or call the studio' : ''}.`;
      setState({
        submitting: false,
        error: message,
        sent: false,
      });
      notify(message, 'error');
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!user) {
      requireAuth({
        message: 'Log in or create an account before sending this message. Everything you wrote will stay here.',
        onAuthenticated: (nextUser) => sendMessage(formRef.current, nextUser),
        onAccountMismatch: () => {
          const message = 'Your signed-in account changed. Please review the current account details before sending this message.';
          setState({ submitting: false, error: message, sent: false });
          notify(message, 'warning');
        },
      });
      return;
    }
    void sendMessage(event.currentTarget, user);
  };

  return <>
    <section className="contact-hero">
      <Container fluid="xl">
        <p className="eyebrow light-eyebrow">Contact the studio</p>
        <h1>A thoughtful gift{' '}<br />starts with a hello.</h1>
        <p>Questions, unusual ideas and detailed briefs are all welcome. We’ll help you find the clearest next step.</p>
      </Container>
    </section>
    <section className="page-section contact-main">
      <Container fluid="xl">
        <Row className="g-5">
          <Col lg={5}>
            <div className="contact-details">
              <p className="eyebrow">Gift N Wrap Studio</p>
              <h2>Handmade resin art & personalized gifts.</h2>
              <p>Reach us directly for product questions, timelines, custom ideas and bulk gifting.</p>
              {contact.phoneHref && <a href={contact.phoneHref}>
                <span><Icon name="phone" /></span>
                <p><small>Call the studio</small><strong>{contact.phoneLabel}</strong></p>
              </a>}
              {contact.email && <a href={`mailto:${contact.email}`}>
                <span><Icon name="mail" /></span>
                <p><small>Email the studio</small><strong>{contact.email}</strong></p>
              </a>}
              {contact.instagramUrl && <a href={contact.instagramUrl} target="_blank" rel="noreferrer">
                <span><Icon name="instagram" /></span>
                <p><small>See recent work on Instagram</small><strong>{contact.instagramLabel || 'Instagram'}</strong></p>
              </a>}
              <a href="https://maps.app.goo.gl/Tfcr1XpcvsaZqgJ28?g_st=iw" target="_blank" rel="noreferrer">
                <span><Icon name="map" /></span>
                <p><small>Find the studio</small><strong>Open in Google Maps</strong></p>
              </a>
            </div>
          </Col>
          <Col lg={{ span: 6, offset: 1 }}>
            <Form ref={formRef} noValidate onSubmit={submit} className="contact-form" aria-busy={state.submitting}>
              <p className="eyebrow">Send a note</p>
              <h2>What can we make easier?</h2>
              {state.error && <Alert variant="danger" className="soft-alert" role="alert">{state.error}</Alert>}
              {state.sent && <Alert variant="success" className="soft-alert" role="status"><Icon name="check" /> Your message reached the studio. We’ll reply as soon as we can.</Alert>}
              <Row className="g-3">
                <Col sm={6}>
                  <Form.Group controlId="contact-name">
                    <Form.Label>Name</Form.Label>
                    <Form.Control required minLength={2} maxLength={100} autoComplete="name" value={form.name} onChange={(event) => update('name', event.target.value)} isInvalid={Boolean(fieldErrors.name)} aria-invalid={fieldErrors.name ? true : undefined} aria-describedby="contact-name-error" />
                    <Form.Control.Feedback id="contact-name-error" type="invalid">{fieldErrors.name || 'Enter at least 2 characters.'}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col sm={6}>
                  <Form.Group controlId="contact-phone">
                    <Form.Label>Mobile <small>optional</small></Form.Label>
                    <Form.Control type="tel" inputMode="tel" autoComplete="tel-national" maxLength={24} value={form.phone} onChange={(event) => update('phone', event.target.value)} isInvalid={Boolean(fieldErrors.phone)} aria-invalid={fieldErrors.phone ? true : undefined} aria-describedby={`contact-phone-help${fieldErrors.phone ? ' contact-phone-error' : ''}`} placeholder="09876543210 or +91 98765 43210" />
                    <Form.Control.Feedback id="contact-phone-error" type="invalid">{fieldErrors.phone || INDIAN_MOBILE_MESSAGE}</Form.Control.Feedback>
                    <Form.Text id="contact-phone-help">Use a 10-digit Indian mobile, optionally beginning with 0 or +91.</Form.Text>
                  </Form.Group>
                </Col>
                <Col xs={12}>
                  <Form.Group controlId="contact-email">
                    <Form.Label>Email</Form.Label>
                    <Form.Control required readOnly={Boolean(user)} className={user ? 'verified-readonly' : ''} aria-readonly={user ? true : undefined} type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} isInvalid={Boolean(fieldErrors.email)} aria-invalid={fieldErrors.email ? true : undefined} aria-describedby="contact-email-error contact-email-help" />
                    <Form.Control.Feedback id="contact-email-error" type="invalid">{fieldErrors.email || 'Enter a valid email.'}</Form.Control.Feedback>
                    <Form.Text id="contact-email-help">{user ? <><Icon name="lock" size={12} /> Verified account email—change it by signing in with another account.</> : 'You’ll verify this email securely before the message is sent.'}</Form.Text>
                  </Form.Group>
                </Col>
                <Col xs={12}>
                  <Form.Group controlId="contact-subject">
                    <Form.Label>About</Form.Label>
                    <StorefrontSelect id="contact-subject" value={form.subject} options={subjectOptions} onChange={(value) => update('subject', value)} invalid={Boolean(fieldErrors.subject)} ariaDescribedBy={fieldErrors.subject ? 'contact-subject-error' : undefined} ariaLabel="Choose what your message is about" />
                    <Form.Control.Feedback id="contact-subject-error" type="invalid">{fieldErrors.subject}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col xs={12}>
                  <Form.Group controlId="contact-message">
                    <Form.Label>Message</Form.Label>
                    <Form.Control required as="textarea" rows={6} minLength={10} maxLength={3000} value={form.message} onChange={(event) => update('message', event.target.value)} isInvalid={Boolean(fieldErrors.message)} aria-invalid={fieldErrors.message ? true : undefined} aria-describedby="contact-message-error contact-message-count" placeholder="Include the product, occasion or order number if you have one." />
                    <Form.Control.Feedback id="contact-message-error" type="invalid">{fieldErrors.message || 'Write at least 10 characters so we can understand how to help.'}</Form.Control.Feedback>
                    <div className="character-count" id="contact-message-count">{form.message.length}/3000</div>
                  </Form.Group>
                </Col>
              </Row>
              {!user && <Alert variant="info" className="soft-alert contact-auth-note"><Icon name="lock" /> Your note stays here while you verify your email. Nothing is sent until you finish secure sign-in.</Alert>}
              <Button type="submit" className="button-burgundy" disabled={state.submitting}>
                {state.submitting ? <><Spinner size="sm" /> Sending…</> : <>{user ? 'Send message' : 'Continue securely'} <Icon name="arrow" /></>}
              </Button>
            </Form>
          </Col>
        </Row>
      </Container>
    </section>
    <section className="faq-section page-section" id="faq">
      <Container fluid="xl">
        <Row className="gy-5">
          <Col lg={4}>
            <p className="eyebrow">Frequently asked</p>
            <h2>The useful details, all together.</h2>
            <p className="muted-copy">For care and processing timelines, visit our dedicated guide.</p>
            <Link to="/care-and-delivery" className="text-link">Care & delivery guide <Icon name="arrow" /></Link>
          </Col>
          <Col lg={{ span: 7, offset: 1 }}>
            <Accordion flush className="studio-accordion">
              {faq.map(([question, answer], index) => <Accordion.Item eventKey={String(index)} key={question}><Accordion.Header>{question}</Accordion.Header><Accordion.Body>{answer}</Accordion.Body></Accordion.Item>)}
            </Accordion>
          </Col>
        </Row>
      </Container>
    </section>
  </>;
}
