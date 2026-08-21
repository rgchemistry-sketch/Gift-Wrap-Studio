import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import ProductCard from '../components/ProductCard';
import { formatCurrency } from '../data/catalog';
import { useCatalog } from '../data/useCatalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { resolveStudioContact } from '../utils/studio-contact';
import { shouldDisableBuyingAction } from '../utils/buying-flow';
import '../buying-flow.css';

export default function CartPage() {
  const navigate = useNavigate();
  const { user, requireAuth } = useAuth();
  const {
    cart,
    subtotal,
    updateQuantity,
    removeFromCart,
    removeCartCustomization,
    claimedOfferCode,
    welcomeOffer,
    studioSettings,
    notify,
    removeWelcomeOffer,
    revalidateCart,
  } = useShop();
  const {
    products: catalog,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useCatalog();
  const [liveCatalogReady, setLiveCatalogReady] = useState(false);
  const suggestions = [...catalog]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.inStock) - Number(a.inStock))
    .slice(0, 3);
  const claimedOffer = claimedOfferCode;
  const unavailableItems = cart.filter((line) => line.unavailable);
  const customizationUnavailableItems = cart.filter((line) => line.customizationUnavailable);
  const bagNeedsAttention = unavailableItems.length > 0 || customizationUnavailableItems.length > 0;
  const contact = resolveStudioContact(studioSettings);
  const bagCheckPending = !catalogError && (!liveCatalogReady || catalogLoading);
  const checkoutButtonLabel = catalogError
    ? 'Retry the bag check to continue'
    : bagCheckPending
      ? 'Checking your bag…'
      : bagNeedsAttention
        ? 'Resolve bag updates to continue'
        : 'Continue to order request';

  const refreshLiveCart = async () => {
    setLiveCatalogReady(false);
    const liveProducts = await refreshCatalog({ force: true });
    if (!Array.isArray(liveProducts)) return false;
    revalidateCart(liveProducts);
    setLiveCatalogReady(true);
    return true;
  };

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

  const continueToCheckout = async () => {
    if (catalogError) {
      const refreshed = await refreshLiveCart();
      if (!refreshed) notify('We still couldn’t refresh your bag. Please check your connection and try again.', 'warning');
      return;
    }
    if (bagCheckPending) return;
    if (customizationUnavailableItems.length) {
      notify('Choose whether to keep each affected piece without personalization or remove it before continuing.', 'warning');
      return;
    }
    if (unavailableItems.length) {
      notify('Remove unavailable pieces from your bag before continuing.', 'warning');
      return;
    }
    if (user) {
      navigate('/checkout');
      return;
    }
    requireAuth({
      message: 'Log in or create an account to continue with your order. Everything in your bag will be waiting for you.',
      onAuthenticated: () => navigate('/checkout'),
      onAccountMismatch: () => {
        notify('Your signed-in account changed. Please review this account’s bag before continuing.', 'warning');
      },
    });
  };

  if (!cart.length) {
    return (
      <>
        <Container className="empty-bag page-section">
          <div className="empty-bag__art"><Icon name="bag" size={42} /><span aria-hidden="true">✦</span></div>
          <p className="eyebrow">Your gift bag</p>
          <h1>Room for something meaningful.</h1>
          <p>Your bag is empty. Explore the studio collection or begin a piece made entirely from your idea.</p>
          <div className="empty-bag__actions"><Button as={Link} to="/shop" className="button-burgundy">Explore the collection</Button><Link to="/custom-order" className="text-link">Start a custom order <Icon name="arrow" /></Link></div>
        </Container>
        {suggestions.length > 0 && <section className="page-section cart-suggestions"><Container fluid="xl"><header className="section-heading"><p className="eyebrow">A lovely place to begin</p><h2>Studio favourites.</h2></header><Row className="g-4">{suggestions.map((product, index) => <Col sm={6} lg={4} key={product.id}><ProductCard product={product} index={index} /></Col>)}</Row></Container></section>}
      </>
    );
  }

  return (
    <section className="cart-page page-section">
      <Container fluid="xl">
        <div className="cart-title"><div><p className="eyebrow">Your gift bag</p><h1>Chosen with care.</h1></div><Link to="/shop" className="text-link">Continue browsing <Icon name="arrow" /></Link></div>
        {catalogError && <Alert variant="warning" className="soft-alert">We couldn’t refresh live prices right now. You can keep editing your bag and <button type="button" className="plain-link" onClick={refreshLiveCart}>try again</button>.</Alert>}
        <Row className="g-5">
          <Col lg={8}>
            <div className="cart-lines">
              {cart.map((line) => (
                <article className="cart-line" key={line.lineId}>
                  <Link to={`/product/${line.product.slug}`} className="cart-line__image"><SmartImage src={line.product.image} alt={line.product.title} fallbackLabel={line.product.category} /></Link>
                  <div className="cart-line__content">
                    <div className="cart-line__head"><div><p className="eyebrow">{line.product.category}</p><h2><Link to={`/product/${line.product.slug}`}>{line.product.title}</Link></h2></div><strong>{line.unavailable ? 'Unavailable' : formatCurrency(line.product.price * line.quantity)}</strong></div>
                    {line.priceUpdatedFrom != null && Number(line.priceUpdatedFrom) !== Number(line.product.price) && <Alert variant="info" className="soft-alert"><Icon name="spark" size={14} /> Price updated from {formatCurrency(line.priceUpdatedFrom)} to {formatCurrency(line.product.price)}.</Alert>}
                    {line.unavailable && <Alert variant="warning" className="soft-alert"><strong>{line.unavailableReason || 'This piece is unavailable.'}</strong> <button type="button" className="plain-link" onClick={() => removeFromCart(line.lineId)}>Remove it from my bag</button></Alert>}
                    {line.customizationUnavailable && (
                      <Alert variant="warning" className="soft-alert">
                        <strong>{line.customizationUnavailableReason || 'Personalization is no longer available for this piece.'}</strong>{' '}
                        Your saved details are still here.{' '}
                        <button type="button" className="plain-link" onClick={() => removeCartCustomization(line.lineId)}>Keep it without personalization</button>{' '}
                        <button type="button" className="plain-link" onClick={() => removeFromCart(line.lineId)}>Remove the piece</button>
                      </Alert>
                    )}
                    {line.customization && Object.keys(line.customization).length > 0 && (
                      <div className="cart-customization">
                        <span>Personalized</span>
                        <p>{[line.customization.name, line.customization.date, line.customization.colour, line.customization.finish].filter(Boolean).join(' · ')}</p>
                        {line.customization.media?.pending && <small><Icon name="upload" size={13} /> Photo must be reattached or uploaded after sign-in.</small>}
                      </div>
                    )}
                    <div className="cart-line__actions">
                      <div className="quantity-control" role="group" aria-label={`Quantity for ${line.product.title}`}>
                        <button type="button" onClick={() => updateQuantity(line.lineId, line.quantity - 1)} aria-label="Decrease quantity" disabled={line.quantity <= 1}><Icon name="minus" size={15} /></button>
                        <span aria-live="polite">{line.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(line.lineId, line.quantity + 1)} aria-label="Increase quantity" disabled={line.quantity >= 10}><Icon name="plus" size={15} /></button>
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
            <aside className="order-summary" aria-labelledby="cart-summary-title">
              <p className="eyebrow">Order estimate</p>
              <h2 id="cart-summary-title">Your summary</h2>
              {claimedOffer && <Alert variant={welcomeOffer?.eligible === false ? 'warning' : 'success'} className="offer-claimed"><Icon name="spark" /> {welcomeOffer?.eligible === false ? `${claimedOffer} is not available for this account.` : `${claimedOffer} saved. Eligibility will be checked before final confirmation.`} <button type="button" className="plain-link" onClick={removeWelcomeOffer}>Remove offer</button></Alert>}
              <dl><div><dt>Pieces ({cart.reduce((count, line) => count + line.quantity, 0)})</dt><dd>{formatCurrency(subtotal)}</dd></div><div><dt>Delivery</dt><dd>Confirmed by studio</dd></div><div className="summary-total"><dt>Current item total</dt><dd>{formatCurrency(subtotal)}</dd></div></dl>
              <Button type="button" onClick={continueToCheckout} disabled={shouldDisableBuyingAction({ catalogError, checkPending: bagCheckPending, needsAttention: bagNeedsAttention })} className="button-burgundy w-100" aria-describedby="cart-summary-note">{checkoutButtonLabel}{!bagCheckPending && !catalogError && !bagNeedsAttention && <Icon name="arrow" />}</Button>
              <p className="summary-note" id="cart-summary-note"><Icon name="lock" size={14} /> No payment is taken on this page. The studio confirms customization, delivery and final amount first.</p>
              {contact.phoneHref && <div className="summary-contact"><p>Need help with your design?</p><a href={contact.phoneHref}>Call the studio · {contact.phoneLabel}</a></div>}
            </aside>
          </Col>
        </Row>
      </Container>
    </section>
  );
}
