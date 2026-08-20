import { Link } from 'react-router-dom';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import { useShop } from '../context/ShopContext';
import { resolveStudioContact } from '../utils/studio-contact';

export default function CorporatePage() {
  const { studioSettings } = useShop();
  const contact = resolveStudioContact(studioSettings);
  return (
    <>
      <section className="corporate-hero">
        <Container fluid="xl"><Row className="align-items-center gy-5"><Col lg={6}><p className="eyebrow light-eyebrow">Corporate gifting, reconsidered</p><h1>Your brand,<br /><em>made memorable.</em></h1><p>Handcrafted employee awards, logo plaques, desk pieces and event keepsakes that feel personal—not pulled from a catalogue.</p><div className="hero-actions"><Button as={Link} to="/custom-order" className="button-gold">Discuss your brief <Icon name="arrow" /></Button>{contact.phoneHref && <a href={contact.phoneHref} className="text-link text-link--light">Call the studio</a>}</div></Col><Col lg={6}><div className="corporate-hero__visual"><SmartImage src="/assets/corporate-gifts.webp" alt="Premium personalized corporate resin gifts" fallbackLabel="Made for your brand" /><span><strong>Small batch to bulk</strong>Designed and packed by our studio</span></div></Col></Row></Container>
      </section>
      <section className="page-section corporate-options"><Container fluid="xl"><header className="section-heading split-heading"><div><p className="eyebrow">Thoughtful at every scale</p><h2>Recognition they’ll<br />want to keep.</h2></div><p>From a single leadership memento to an event-wide gift run, we adapt the design and production plan around your occasion.</p></header><div className="corporate-option-grid">{[['01','Logo plaques','A refined desktop or wall piece carrying your mark with restraint.'],['02','Employee awards','Milestones and achievements translated into objects with presence.'],['03','Premium gift sets','Curated resin pieces, coordinated packaging and personal notes.'],['04','Event souvenirs','Branded keepsakes for conferences, launches and meaningful gatherings.']].map(([number,title,text])=><article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p><Icon name="spark" /></article>)}</div></Container></section>
      <section className="corporate-feature"><Container fluid="xl"><Row className="g-0"><Col lg={6}><SmartImage src="/assets/personalized-plaque.webp" alt="Close-up of personalized logo plaque" fallbackLabel="Your mark, thoughtfully placed" loading="lazy" /></Col><Col lg={6} className="corporate-feature__copy"><p className="eyebrow light-eyebrow">Made around the brief</p><h2>Consistent enough for a team. Personal enough for a person.</h2><p>Choose brand colours, names, designations, dates, logos, floral accents and finishes. We test the composition, confirm the production window and package every piece securely.</p><ul className="check-list"><li><Icon name="check" /> Digital direction approved before production</li><li><Icon name="check" /> Quantity-aware recommendations and timelines</li><li><Icon name="check" /> PAN India dispatch planning</li><li><Icon name="check" /> Premium individual or grouped packaging</li></ul></Col></Row></Container></section>
      <section className="page-section corporate-process"><Container fluid="xl"><header className="centered-heading section-heading"><p className="eyebrow">A clear production path</p><h2>From brief to handover.</h2></header><div className="process-line">{[['01','Share the scope','Quantity, date, recipients, budget and brand direction.'],['02','Review the concept','We propose formats, finishes and practical production timing.'],['03','Approve a sample','The final direction is confirmed before the full batch begins.'],['04','Receive with confidence','Quality checked, securely packaged and dispatched as planned.']].map(([n,t,p])=><div className="process-step" key={n}><span>{n}</span><h3>{t}</h3><p>{p}</p></div>)}</div><div className="section-cta"><Button as={Link} to="/custom-order" className="button-burgundy">Start a corporate brief <Icon name="arrow" /></Button></div></Container></section>
    </>
  );
}
