import { Link } from 'react-router-dom';
import Accordion from 'react-bootstrap/Accordion';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Icon from '../components/Icon';
import ProductCard from '../components/ProductCard';
import SmartImage from '../components/SmartImage';
import { ProductCardSkeleton } from '../components/Feedback';
import { categories } from '../data/catalog';
import { useCatalog } from '../data/useCatalog';
import { useShop } from '../context/ShopContext';
import { resolveStudioContact } from '../utils/studio-contact';

const trustPoints = [
  ['spark', '100% handmade', 'Individually composed, never mass-produced'],
  ['shield', 'Premium finish', 'Quality checked before it leaves the studio'],
  ['package', 'Gift-ready', 'Beautifully wrapped and securely protected'],
  ['truck', 'PAN India delivery', 'Carefully packed for its journey to you'],
];

const occasions = [
  ['01', 'Birthdays', 'Personal keepsakes for their next chapter.', '/shop?occasion=Birthday'],
  ['02', 'Weddings', 'Names, dates and florals made everlasting.', '/shop?occasion=Wedding'],
  ['03', 'Housewarmings', 'Artful objects made to belong at home.', '/shop?occasion=Housewarming'],
  ['04', 'Corporate', 'Distinctive gifts with your brand, not a catalogue feel.', '/corporate-gifts'],
];

const faqs = [
  ['Can I customize every product?', 'Most made-to-order pieces can be customized. Each product page shows the available names, photos, colours, florals and finish options.'],
  ['Do you accept bulk and corporate orders?', 'Yes. We create wedding return gifts, employee awards, event keepsakes, hampers and branded pieces. Share your quantity, date and budget so we can recommend the right format.'],
  ['Can I add names and photos?', 'Absolutely. Where a piece supports them, you can enter names and dates and attach a reference photo while personalizing it. We review every file before production.'],
  ['Do you deliver across India?', 'Yes, we offer PAN India delivery. Products are gift packed, bubble wrapped and placed in a protective corrugated box.'],
  ['Can I request a completely new design?', 'Yes. Use our custom order form to share the idea, palette, references, budget and occasion. We will discuss feasibility and send a concept before handcrafting begins.'],
];

export default function HomePage() {
  const {
    products,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useCatalog();
  const { studioSettings } = useShop();
  const contact = resolveStudioContact(studioSettings);
  // Curated first, then whatever is in stock, so the shelf is never padded with placeholders.
  const bestsellers = [...products]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.inStock) - Number(a.inStock))
    .slice(0, 4);

  return (
    <>
      <section className="home-hero">
        <div className="hero-wash" aria-hidden="true" />
        <Container fluid="xl" className="home-hero__inner">
          <Row className="align-items-center gy-5">
            <Col lg={6} className="home-hero__copy">
              <p className="eyebrow hero-eyebrow"><span /> Welcome to Gift N Wrap Studio</p>
              <h1>Memories,<br /><em>preserved</em> in art.</h1>
              <p className="hero-lede">
                Premium handmade resin keepsakes and home accents, thoughtfully personalized to hold life’s most meaningful moments.
              </p>
              <div className="hero-actions">
                <Button as={Link} to="/shop" className="button-burgundy">Explore the collection <Icon name="arrow" /></Button>
                <Link to="/custom-order" className="text-link">Create something personal <Icon name="arrow" /></Link>
              </div>
              <div className="hero-proof">
                <div className="avatar-stack" aria-hidden="true"><span>G</span><span>N</span><span>W</span></div>
                <p><strong>Made one at a time</strong><small>With care, conversation and an artist’s eye</small></p>
              </div>
            </Col>
            <Col lg={6} className="home-hero__visual">
              <div className="hero-image hero-image--main">
                <SmartImage src="/assets/hero-resin-studio.webp" alt="Handmade resin art arranged in the Gift N Wrap Studio" fallbackLabel="The Resin Atelier" loading="eager" fetchPriority="high" sizes="(max-width: 991px) 100vw, 50vw" />
              </div>
              <div className="hero-image hero-image--detail">
                <SmartImage src="/assets/personalized-plaque.webp" alt="Close detail of a personalized resin plaque" fallbackLabel="Made for you" />
              </div>
              <div className="hero-note" aria-hidden="true">
                <Icon name="spark" />
                <span>Made by hand<br />made for you</span>
              </div>
              <div className="hero-petal hero-petal--one" aria-hidden="true" />
              <div className="hero-petal hero-petal--two" aria-hidden="true" />
            </Col>
          </Row>
        </Container>
        <div className="hero-script" aria-hidden="true">made with love</div>
      </section>

      <section className="trust-ribbon" aria-label="Why shop with us">
        <Container fluid="xl">
          <div className="trust-grid">
            {trustPoints.map(([icon, title, text]) => (
              <div className="trust-item" key={title}>
                <span><Icon name={icon} /></span>
                <p><strong>{title}</strong><small>{text}</small></p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="page-section category-section">
        <Container fluid="xl">
          <header className="section-heading split-heading">
            <div>
              <p className="eyebrow">Find your kind of beautiful</p>
              <h2>Objects with a story<br />already waiting inside.</h2>
            </div>
            <p>Explore our signature collections—each piece formed, finished and inspected by hand before it reaches you.</p>
          </header>
          <div className="category-editorial-grid">
            {categories.map((category, index) => (
              <Link
                to={`/shop?category=${encodeURIComponent(category.name)}`}
                className={`category-tile category-tile--${index + 1}`}
                key={category.slug}
              >
                <SmartImage src={category.image} alt="" fallbackLabel={category.name} loading="lazy" />
                <span className="category-tile__index">0{index + 1}</span>
                <div className="category-tile__content">
                  <p>{category.description}</p>
                  <h3>{category.name}</h3>
                  <span className="round-arrow"><Icon name="arrow" /></span>
                </div>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <section className="page-section bestsellers-section" aria-busy={catalogLoading}>
          <Container fluid="xl">
            <header className="section-heading centered-heading">
              <p className="eyebrow">From the studio table</p>
              <h2>Pieces people remember.</h2>
              <p>Thoughtful favourites for gifting, gathering and keeping close.</p>
            </header>
            {catalogLoading ? (
              <>
                <p className="visually-hidden" role="status">Loading studio favourites…</p>
                <Row className="g-4 product-grid">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Col xs={12} sm={6} lg={3} key={`bestseller-skeleton-${index}`}><ProductCardSkeleton /></Col>
                  ))}
                </Row>
              </>
            ) : catalogError && !bestsellers.length ? (
              <div className="catalog-inline-state" role="alert">
                <span><Icon name="spark" size={28} /></span>
                <h3>The studio shelf didn’t load.</h3>
                <p>Your place is still here. Try the collection again, or share the piece you have in mind.</p>
                <div><Button className="button-burgundy" onClick={() => refreshCatalog({ force: true })}>Try again</Button><Link to="/custom-order" className="text-link">Begin a custom piece <Icon name="arrow" /></Link></div>
              </div>
            ) : bestsellers.length ? (
              <>
                {catalogError && <Alert variant="warning" className="soft-alert catalog-alert">We couldn’t refresh every studio piece. <button type="button" className="plain-link" onClick={() => refreshCatalog({ force: true })}>Try again</button></Alert>}
                <Row className="g-4 product-grid">
                  {bestsellers.map((product, index) => (
                    <Col xs={12} sm={6} lg={3} key={product.id}><ProductCard product={product} index={index} /></Col>
                  ))}
                </Row>
                <div className="section-cta"><Link to="/shop" className="text-link text-link--large">See the entire collection <Icon name="arrow" /></Link></div>
              </>
            ) : (
              <div className="catalog-inline-state">
                <span><Icon name="spark" size={28} /></span>
                <h3>Fresh pieces are taking shape.</h3>
                <p>The ready collection is between releases, but the custom atelier is open.</p>
                <Link to="/custom-order" className="button-burgundy btn">Begin a custom piece <Icon name="arrow" /></Link>
              </div>
            )}
          </Container>
        </section>

      <section className="personalization-feature">
        <Container fluid="xl">
          <Row className="align-items-stretch g-0">
            <Col lg={6} className="personalization-feature__visual">
              <SmartImage src="/assets/wedding-keepsake.webp" alt="A personalized resin wedding keepsake" fallbackLabel="A piece of your story" loading="lazy" />
              <div className="material-note material-note--flower">real florals</div>
              <div className="material-note material-note--foil">gold foil</div>
              <div className="material-note material-note--name">your names</div>
            </Col>
            <Col lg={6} className="personalization-feature__copy">
              <p className="eyebrow light-eyebrow">Made personal, beautifully</p>
              <h2>Your story is the<br />most precious material.</h2>
              <p>
                Add names, photographs, dates, flowers, colours, logos or a line only the two of you understand. We compose every detail so the final piece feels considered—not simply customized.
              </p>
              <ul className="check-list">
                <li><Icon name="check" /> A guided design conversation</li>
                <li><Icon name="check" /> Concept approval before handcrafting</li>
                <li><Icon name="check" /> Honest timing for made-to-order work</li>
              </ul>
              <Button as={Link} to="/custom-order" className="button-ivory">Begin a custom order <Icon name="arrow" /></Button>
            </Col>
          </Row>
        </Container>
      </section>

      <section className="page-section occasion-section">
        <Container fluid="xl">
          <div className="occasion-layout">
            <div className="occasion-intro">
              <p className="eyebrow">Gift by occasion</p>
              <h2>For the days that become your favourite memories.</h2>
              <p>Start with the moment. We’ll help you find an object worthy of it.</p>
            </div>
            <div className="occasion-list">
              {occasions.map(([number, title, text, to]) => (
                <Link key={number} to={to} className="occasion-row">
                  <span>{number}</span><h3>{title}</h3><p>{text}</p><i><Icon name="arrow" /></i>
                </Link>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section className="process-section page-section">
        <Container fluid="xl">
          <header className="section-heading split-heading">
            <div><p className="eyebrow">Our process</p><h2>From a feeling<br />to a finished piece.</h2></div>
            <p>Handmade shouldn’t feel uncertain. We keep you close to the process, from first idea to doorstep.</p>
          </header>
          <div className="process-line">
            {[
              ['01', 'Share the idea', 'Tell us the person, occasion and details worth preserving.'],
              ['02', 'Shape the design', 'We discuss the composition, colours and customization.'],
              ['03', 'Approve the concept', 'You review the direction before our hands begin making.'],
              ['04', 'Made, checked & packed', 'Your piece is finished, quality checked and securely gift packed.'],
            ].map(([number, title, text]) => (
              <div className="process-step" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="studio-story">
        <Container fluid="xl">
          <Row className="align-items-center gy-5">
            <Col lg={6} className="studio-story__visual">
              <SmartImage src="/assets/serving-collection.webp" alt="Finishing details on a handmade resin piece" fallbackLabel="Crafted by hand" loading="lazy" />
              <span className="studio-story__caption">Precision in every pour · patience in every finish</span>
            </Col>
            <Col lg={{ span: 5, offset: 1 }} className="studio-story__copy">
              <p className="eyebrow">Our story</p>
              <h2>A small handmade venture, grown with trust.</h2>
              <p>Gift N Wrap Studio began with a love for turning ordinary materials into meaningful objects. That first spark grew into a resin atelier known for premium craftsmanship and personal attention.</p>
              <p>Every product is individually designed rather than mass-produced. The tiny variations that emerge are part of its beauty—and proof it was made for you.</p>
              <blockquote>“Create meaningful gifts that last forever.”</blockquote>
              <Link to="/our-story" className="text-link">Meet the studio <Icon name="arrow" /></Link>
            </Col>
          </Row>
        </Container>
      </section>

      <section className="faq-section page-section" id="faq">
        <Container fluid="xl">
          <Row className="gy-5">
            <Col lg={4}>
              <p className="eyebrow">Questions, answered</p>
              <h2>Before your piece takes shape.</h2>
              <p className="muted-copy">Still wondering about something? Speak directly with the studio—we’re happiest when every detail is clear.</p>
              <Link to="/contact" className="text-link">Contact us <Icon name="arrow" /></Link>
            </Col>
            <Col lg={{ span: 7, offset: 1 }}>
              <Accordion flush className="studio-accordion">
                {faqs.map(([question, answer], index) => (
                  <Accordion.Item eventKey={String(index)} key={question}>
                    <Accordion.Header>{question}</Accordion.Header>
                    <Accordion.Body>{answer}</Accordion.Body>
                  </Accordion.Item>
                ))}
              </Accordion>
            </Col>
          </Row>
        </Container>
      </section>

      <section className="contact-banner">
        <Container fluid="xl">
          <div className="contact-banner__inner">
            <div><p className="eyebrow light-eyebrow">Have something in mind?</p><h2>Let’s make a memory<br />you can hold.</h2></div>
            <div className="contact-banner__actions">
              <Button as={Link} to="/custom-order" className="button-gold">Start a custom order <Icon name="arrow" /></Button>
              {contact.phoneHref && <a href={contact.phoneHref}>or call {contact.phoneLabel}</a>}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
