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

const DRAFT_KEY = 'gnw-custom-order-draft';
const initialForm = {
  productType: '', occasion: '', description: '', palette: '', personalization: '', budget: '', neededBy: '', referenceUrl: '', name: '', email: '', phone: '', contactPreference: 'WhatsApp',
};

function loadDraft() {
  try { return JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

const stepMeta = [
  ['The idea', 'What are we making?'],
  ['The details', 'Make it unmistakably yours.'],
  ['About you', 'Where can the studio reach you?'],
  ['Review', 'One last look before you send.'],
];

export default function CustomOrderPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => ({ ...initialForm, ...(loadDraft() || {}) }));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  useEffect(() => window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form)), [form]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const validateStep = () => {
    if (step === 0 && (!form.productType || !form.description.trim())) return 'Choose a product direction and tell us a little about the idea.';
    if (step === 1 && !form.personalization.trim()) return 'Tell us which names, dates, photos, logo or details should be included.';
    if (step === 2) {
      if (!form.name.trim() || !/^\S+@\S+\.\S+$/.test(form.email) || !/^[6-9]\d{9}$/.test(form.phone)) return 'Enter your name, a valid email and a 10-digit Indian mobile number.';
    }
    return '';
  };

  const next = () => {
    const issue = validateStep();
    if (issue) { setError(issue); return; }
    setError('');
    setStep((value) => Math.min(3, value + 1));
    window.scrollTo({ top: 260, behavior: 'smooth' });
  };

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const result = await api.submitCustomRequest(form);
      setSubmitted(result.data || result);
      window.localStorage.removeItem(DRAFT_KEY);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      setError(`${requestError.message} Your draft is still saved on this device.`);
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="wizard-progress" aria-label={`Step ${step + 1} of 4`}>
            {stepMeta.map(([label], index) => <button key={label} type="button" onClick={() => index < step && setStep(index)} className={`${index === step ? 'is-active' : ''} ${index < step ? 'is-complete' : ''}`} disabled={index > step}><span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span><small>{label}</small></button>)}
          </div>
          <Row className="g-5 wizard-layout">
            <Col lg={4}><div className="wizard-aside"><p className="eyebrow">Step {step + 1} of 4</p><h2>{stepMeta[step][1]}</h2><p>{step === 0 ? 'Start broad. A few vivid details are more useful than having every measurement worked out.' : step === 1 ? 'Names, flowers, colours and little symbols are what turn an object into your object.' : step === 2 ? 'We keep your details private and use them only to discuss this request.' : 'Nothing goes into production yet. This simply gives our artist enough context to begin the conversation.'}</p><div className="wizard-help"><Icon name="phone" /><span>Prefer to talk it through?<a href="tel:+919588281126">Call 95882 81126</a></span></div></div></Col>
            <Col lg={{ span: 7, offset: 1 }}>
              <div className="wizard-card">
                {error && <Alert variant="danger" className="soft-alert" role="alert">{error}</Alert>}
                {step === 0 && <StepIdea form={form} update={update} />}
                {step === 1 && <StepDetails form={form} update={update} />}
                {step === 2 && <StepContact form={form} update={update} />}
                {step === 3 && <StepReview form={form} edit={setStep} />}
                <div className="wizard-actions">
                  {step > 0 && <Button variant="link" className="plain-link" onClick={() => { setError(''); setStep((value) => value - 1); }}>Back</Button>}
                  {step < 3 ? <Button className="button-burgundy" onClick={next}>Continue <Icon name="arrow" /></Button> : <Button className="button-burgundy" onClick={submit} disabled={submitting}>{submitting ? <><Spinner size="sm" /> Sending…</> : <>Send to the studio <Icon name="arrow" /></>}</Button>}
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

function StepIdea({ form, update }) {
  return <div className="wizard-step"><p className="eyebrow">The starting point</p><h3>What would you love us to create?</h3><Form.Group className="form-field"><Form.Label>Type of piece</Form.Label><div className="choice-grid">{['Name plaque', 'Wall clock', 'Wedding keepsake', 'Serving piece', 'Home décor', 'Something new'].map((option) => <label key={option}><input type="radio" name="productType" checked={form.productType === option} onChange={() => update('productType', option)} /><span><Icon name="spark" />{option}</span></label>)}</div></Form.Group><Form.Group className="form-field" controlId="custom-idea"><Form.Label>Describe the idea</Form.Label><Form.Control as="textarea" rows={5} value={form.description} maxLength={800} onChange={(event) => update('description', event.target.value)} placeholder="Who is it for, what should it feel like, and what made you imagine it?" /><div className="character-count">{form.description.length}/800</div></Form.Group><Row className="g-3"><Col sm={6}><Form.Group controlId="custom-occasion"><Form.Label>Occasion <small>optional</small></Form.Label><Form.Select value={form.occasion} onChange={(event) => update('occasion', event.target.value)}><option value="">Select one</option><option>Birthday</option><option>Wedding</option><option>Anniversary</option><option>Housewarming</option><option>Corporate event</option><option>Memorial</option><option>Just because</option></Form.Select></Form.Group></Col><Col sm={6}><Form.Group controlId="custom-date-needed"><Form.Label>Needed by <small>optional</small></Form.Label><Form.Control type="date" min={new Date().toISOString().slice(0, 10)} value={form.neededBy} onChange={(event) => update('neededBy', event.target.value)} /></Form.Group></Col></Row></div>;
}

function StepDetails({ form, update }) {
  return <div className="wizard-step"><p className="eyebrow">The personal layer</p><h3>Which details should live inside it?</h3><Form.Group className="form-field" controlId="custom-personalization"><Form.Label>Names, dates, photos, logo or special elements</Form.Label><Form.Control as="textarea" rows={5} value={form.personalization} maxLength={600} onChange={(event) => update('personalization', event.target.value)} placeholder="e.g. Names Aarya & Kabir, wedding date, ivory flowers, one printed photograph…" /><div className="character-count">{form.personalization.length}/600</div></Form.Group><Form.Group className="form-field" controlId="custom-palette"><Form.Label>Colour or theme direction <small>optional</small></Form.Label><Form.Control value={form.palette} onChange={(event) => update('palette', event.target.value)} placeholder="e.g. Deep green geode with restrained gold" /></Form.Group><Row className="g-3"><Col sm={6}><Form.Group controlId="custom-budget"><Form.Label>Comfortable budget <small>optional</small></Form.Label><Form.Select value={form.budget} onChange={(event) => update('budget', event.target.value)}><option value="">Choose a range</option><option>Under ₹1,500</option><option>₹1,500 – ₹3,000</option><option>₹3,000 – ₹6,000</option><option>₹6,000 – ₹10,000</option><option>₹10,000+</option><option>Need guidance</option></Form.Select></Form.Group></Col><Col sm={6}><Form.Group controlId="custom-reference"><Form.Label>Reference link <small>optional</small></Form.Label><Form.Control type="url" value={form.referenceUrl} onChange={(event) => update('referenceUrl', event.target.value)} placeholder="Pinterest, Drive or Instagram URL" /></Form.Group></Col></Row><p className="form-tip"><Icon name="upload" /> You can share full-resolution photos with the studio after the first review, so precious files aren’t compressed unnecessarily.</p></div>;
}

function StepContact({ form, update }) {
  return <div className="wizard-step"><p className="eyebrow">Stay in the loop</p><h3>How should we continue the conversation?</h3><Row className="g-3"><Col sm={6}><Form.Group controlId="inquiry-name"><Form.Label>Your name</Form.Label><Form.Control value={form.name} onChange={(event) => update('name', event.target.value)} autoComplete="name" /></Form.Group></Col><Col sm={6}><Form.Group controlId="inquiry-phone"><Form.Label>Mobile number</Form.Label><Form.Control inputMode="numeric" value={form.phone} onChange={(event) => update('phone', event.target.value.replace(/\D/g, '').slice(0, 10))} autoComplete="tel" placeholder="10-digit number" /></Form.Group></Col><Col xs={12}><Form.Group controlId="inquiry-email"><Form.Label>Email address</Form.Label><Form.Control type="email" value={form.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" /></Form.Group></Col><Col xs={12}><Form.Group controlId="inquiry-contact"><Form.Label>Preferred contact</Form.Label><div className="inline-choices">{['WhatsApp', 'Phone call', 'Email'].map((option) => <Form.Check key={option} inline type="radio" name="contactPreference" id={`contact-${option}`} label={option} checked={form.contactPreference === option} onChange={() => update('contactPreference', option)} />)}</div></Form.Group></Col></Row><Alert variant="info" className="soft-alert privacy-inline"><Icon name="shield" /> Your contact details are used only to respond to this request.</Alert></div>;
}

function StepReview({ form, edit }) {
  const rows = [['Piece', form.productType], ['Occasion', form.occasion || 'Not specified'], ['Your idea', form.description], ['Personal details', form.personalization], ['Palette', form.palette || 'Artist guidance requested'], ['Budget', form.budget || 'To discuss'], ['Needed by', form.neededBy || 'No fixed date'], ['Contact', `${form.name} · ${form.phone} · ${form.email}`], ['Preferred contact', form.contactPreference]];
  return <div className="wizard-step review-step"><p className="eyebrow">Review your request</p><h3>Does this sound like your idea?</h3><div className="review-list">{rows.map(([label, value], index) => <div key={label}><span>{label}</span><p>{value}</p>{[1, 3, 6].includes(index) && <button type="button" onClick={() => edit(index < 2 ? 0 : index < 5 ? 1 : 2)}>Edit</button>}</div>)}</div><Alert variant="info" className="soft-alert"><strong>Sending this is free.</strong> The studio will review the brief and contact you before any design is confirmed or payment is requested.</Alert></div>;
}
