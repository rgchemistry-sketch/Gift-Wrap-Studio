import { Link } from 'react-router-dom';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import ProductCard from '../components/ProductCard';
import { demoProducts, formatCurrency } from '../data/catalog';
import { useShop } from '../context/ShopContext';

export default function CartPage() {
  const { cart, subtotal, updateQuantity, removeFromCart, claimedOfferCode, welcomeOffer, studioSettings } = useShop();
  const claimedOffer = claimedOfferCode || (window.sessionStorage.getItem('gnw-first-offer-claimed') === 'true' ? welcomeOffer?.code || 'FIRST10' : '');
  const contactPhone = studioSettings?.contact?.phone || '+919588281126';
  const contactDigits = String(contactPhone).replace(/\D/g, '');
  const contactLocal = contactDigits.length > 10 ? contactDigits.slice(-10) : contactDigits;
  const contactLabel = contactLocal.length === 10 ? `${contactLocal.slice(0, 5)} ${contactLocal.slice(5)}` : contactPhone;

  if (!cart.length) {
    return (
      <>
        <Container className="empty-bag page-section">
          <div className="empty-bag__art"><Icon name="bag" size={42} /><span aria-hidden="true">✦</span></div>
          <p className="eyebrow">Your gift bag</p>
          <h1>Room for something meaningful.</h1>
          <p>Your bag is empty. Explore the studio collection or begin a piece made entirely from your idea.</p>
          <div><Button as={Link} to="/shop" className="button-burgundy">Explore the collection</Button><Link to="/custom-order" className="text-link">Start a custom order <Icon name="arrow" /></Link></div>
        </Container>
        <section className="page-section cart-suggestions"><Container fluid="xl"><header className="section-heading"><p className="eyebrow">A lovely place to begin</p><h2>Studio favourites.</h2></header><Row className="g-4">{demoProducts.slice(0, 3).map((product, index) => <Col sm={6} lg={4} key={product.id}><ProductCard product={product} index={index} /></Col>)}</Row></Container></section>
      </>
    );
  }

  return (
    <section className="cart-page page-section">
      <Container fluid="xl">
        <div className="cart-title"><div><p className="eyebrow">Your gift bag</p><h1>Chosen with care.</h1></div><Link to="/shop" className="text-link">Continue browsing <Icon name="arrow" /></Link></div>
        <Row className="g-5">
          <Col lg={8}>
            <div className="cart-lines">
              {cart.map((line) => (
                <article className="cart-line" key={line.lineId}>
                  <Link to={`/product/${line.product.slug}`} className="cart-line__image"><SmartImage src={line.product.image} alt={line.product.title} fallbackLabel={line.product.category} /></Link>
                  <div className="cart-line__content">
                    <div className="cart-line__head"><div><p className="eyebrow">{line.product.category}</p><h2><Link to={`/product/${line.product.slug}`}>{line.product.title}</Link></h2></div><strong>{formatCurrency((line.product.price + (line.customizationFee || 0)) * line.quantity)}</strong></div>
                    {line.customization && Object.keys(line.customization).length > 0 && (
                      <div className="cart-customization">
                        <span>Personalized</span>
                        <p>{[line.customization.name, line.customization.date, line.customization.colour, line.customization.finish].filter(Boolean).join(' · ')}</p>
                        {line.customization.media?.pending && <small><Icon name="upload" size={13} /> Photo must be reattached or uploaded after sign-in.</small>}
                      </div>
                    )}
                    <div className="cart-line__actions">
                      <div className="quantity-control" aria-label={`Quantity for ${line.product.title}`}>
                        <button type="button" onClick={() => updateQuantity(line.lineId, line.quantity - 1)} aria-label="Decrease quantity"><Icon name="minus" size={15} /></button>
                        <span>{line.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(line.lineId, line.quantity + 1)} aria-label="Increase quantity"><Icon name="plus" size={15} /></button>
                      </div>
                      <button type="button" className="plain-link" onClick={() => removeFromCart(line.lineId)}>Remove</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="cart-reassurance"><div><Icon name="package" /><p><strong>Prepared for gifting</strong><small>Premium gift packaging and a thank-you card are included.</small></p></div><div><Icon name="shield" /><p><strong>Protected for the journey</strong><small>Each piece is quality checked and securely packed before dispatch.</small></p></div></div>
          </Col>
          <Col lg={4}>
            <aside className="order-summary">
              <p className="eyebrow">Order estimate</p>
              <h2>Your summary</h2>
              {claimedOffer && <Alert variant="success" className="offer-claimed"><Icon name="spark" /> {claimedOffer} saved. Eligibility will be checked before final confirmation.</Alert>}
              <dl><div><dt>Pieces ({cart.reduce((count, line) => count + line.quantity, 0)})</dt><dd>{formatCurrency(subtotal)}</dd></div><div><dt>Delivery</dt><dd>Confirmed by studio</dd></div><div className="summary-total"><dt>Current item total</dt><dd>{formatCurrency(subtotal)}</dd></div></dl>
              <Button as={Link} to="/checkout" className="button-burgundy w-100">Continue to order request <Icon name="arrow" /></Button>
              <p className="summary-note"><Icon name="lock" size={14} /> No payment is taken on this page. The studio confirms customization, delivery and final amount first.</p>
              <div className="summary-contact"><p>Need help with your design?</p><a href={`tel:${contactPhone.replace(/[^+\d]/g, '')}`}>Call the studio · {contactLabel}</a></div>
            </aside>
          </Col>
        </Row>
      </Container>
    </section>
  );
}
