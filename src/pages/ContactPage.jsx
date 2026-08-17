import { useState } from 'react';
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
import { api } from '../api/client';
import { useShop } from '../context/ShopContext';
import { resolveStudioContact } from '../utils/studio-contact';
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

export default function ContactPage() {
  const { studioSettings } = useShop();
  const contact = resolveStudioContact(studioSettings);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    subject: 'Product question',
    message: '',
  });
  const [state, setState] = useState({ submitting: false, error: '', sent: false });
  const [fieldErrors, setFieldErrors] = useState({});

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => current[key] ? { ...current, [key]: '' } : current);
    setState((current) => current.error || current.sent
      ? { ...current, error: '', sent: false }
      : current);
  };
  const submit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
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
      await api.submitContact({ ...form, phone: normalizedPhone });
      setState({ submitting: false, error: '', sent: true });
      setForm({ name: '', email: '', phone: '', subject: 'Product question', message: '' });
    } catch (error) {
      const serverFieldErrors = fieldErrorsFrom(error.details);
      const hasFieldErrors = Object.keys(serverFieldErrors).length > 0;
      setFieldErrors(serverFieldErrors);
      focusContactField(Object.keys(serverFieldErrors)[0]);
      setState({
        submitting: false,
        error: hasFieldErrors
          ? 'Please correct the highlighted fields. Your message has not been sent.'
          : `${error.message} Your message was not sent. Please try again${contact.phone ? ' or call the studio' : ''}.`,
        sent: false,
      });
    }
  };

  return <>
    <section className="contact-hero">
      <Container fluid="xl">
        <p className="eyebrow light-eyebrow">Contact the studio</p>
        <h1>A thoughtful gift<br />starts with a hello.</h1>
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
            <Form noValidate onSubmit={submit} className="contact-form">
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
                    <Form.Control required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} isInvalid={Boolean(fieldErrors.email)} aria-invalid={fieldErrors.email ? true : undefined} aria-describedby="contact-email-error" />
                    <Form.Control.Feedback id="contact-email-error" type="invalid">{fieldErrors.email || 'Enter a valid email.'}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col xs={12}>
                  <Form.Group controlId="contact-subject">
                    <Form.Label>About</Form.Label>
                    <Form.Select value={form.subject} onChange={(event) => update('subject', event.target.value)} isInvalid={Boolean(fieldErrors.subject)} aria-invalid={fieldErrors.subject ? true : undefined} aria-describedby={fieldErrors.subject ? 'contact-subject-error' : undefined}><option>Product question</option><option>Existing order</option><option>Custom design</option><option>Corporate or bulk gifting</option><option>Delivery and care</option></Form.Select>
                    <Form.Control.Feedback id="contact-subject-error" type="invalid">{fieldErrors.subject}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col xs={12}>
                  <Form.Group controlId="contact-message">
                    <Form.Label>Message</Form.Label>
                    <Form.Control required as="textarea" rows={6} minLength={10} maxLength={3000} value={form.message} onChange={(event) => update('message', event.target.value)} isInvalid={Boolean(fieldErrors.message)} aria-invalid={fieldErrors.message ? true : undefined} aria-describedby="contact-message-error" placeholder="Include the product, occasion or order number if you have one." />
                    <Form.Control.Feedback id="contact-message-error" type="invalid">{fieldErrors.message || 'Write at least 10 characters so we can understand how to help.'}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
              </Row>
              <Button type="submit" className="button-burgundy" disabled={state.submitting}>
                {state.submitting ? <><Spinner size="sm" /> Sending…</> : <>Send message <Icon name="arrow" /></>}
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
