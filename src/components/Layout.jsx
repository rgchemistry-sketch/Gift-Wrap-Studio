import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';
import Offcanvas from 'react-bootstrap/Offcanvas';
import Dropdown from 'react-bootstrap/Dropdown';
import Icon from './Icon';
import OfferPopup from './OfferPopup';
import { FloatingWhatsAppButton } from './StorefrontInquiry';
import { ToastStack } from './Feedback';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { routeScrollIntent } from '../utils/route-scroll';
import { DEFAULT_STUDIO_CONTACT, resolveStudioContact } from '../utils/studio-contact';
import '../details.css';

const navItems = [
  ['Shop', '/shop'],
  ['Personalized', '/shop?category=Personalized+gifts'],
  ['Wedding', '/shop?occasion=Wedding'],
  ['Corporate', '/corporate-gifts'],
  ['Our story', '/our-story'],
];

const CANONICAL_ORIGIN = 'https://www.giftnwrapstudio.com';
const AuthModal = lazy(() => import('./AuthModal'));

const pageMetaFor = (pathname) => {
  if (pathname === '/') return ['Home', 'Gift N Wrap Studio · Handmade Resin Art'];
  if (pathname.startsWith('/product/')) return ['Product details', 'Studio piece · Gift N Wrap Studio'];
  const routeMeta = {
    '/shop': ['Shop', 'Shop handmade resin art · Gift N Wrap Studio'],
    '/cart': ['Gift bag', 'Your gift bag · Gift N Wrap Studio'],
    '/checkout': ['Order request', 'Order request · Gift N Wrap Studio'],
    '/custom-order': ['Custom order', 'Custom resin art · Gift N Wrap Studio'],
    '/corporate-gifts': ['Corporate gifts', 'Corporate gifts · Gift N Wrap Studio'],
    '/our-story': ['Our story', 'Our story · Gift N Wrap Studio'],
    '/contact': ['Contact', 'Contact the studio · Gift N Wrap Studio'],
    '/care-and-delivery': ['Care and delivery', 'Care and delivery · Gift N Wrap Studio'],
    '/terms-and-conditions': ['Terms and conditions', 'Terms & Conditions · Gift N Wrap Studio'],
    '/privacy-policy': ['Privacy policy', 'Privacy Policy · Gift N Wrap Studio'],
    '/cancellation-and-refund-policy': ['Cancellation and refund policy', 'Cancellation & Refund Policy · Gift N Wrap Studio'],
    '/shipping-policy': ['Shipping policy', 'Shipping & Delivery Policy · Gift N Wrap Studio'],
    '/account': ['Your account', 'Your account · Gift N Wrap Studio'],
  };
  return routeMeta[pathname] || ['Page', 'Gift N Wrap Studio'];
};

const configuredValue = (settings, group, key, legacyKey, fallback) => {
  if (!settings) return fallback;
  if (Object.prototype.hasOwnProperty.call(group, key)) return group[key] ?? '';
  if (legacyKey && Object.prototype.hasOwnProperty.call(settings, legacyKey)) {
    return settings[legacyKey] ?? '';
  }
  return fallback;
};

function Brand({ onNavigate }) {
  return (
    <Link to="/" className="brand" onClick={onNavigate} aria-label="Gift N Wrap Studio home">
      <span className="brand__seal" aria-hidden="true">G<span>·</span>W</span>
      <span className="brand__words">
        <strong>Gift N Wrap</strong>
        <small>Resin Art Studio</small>
      </span>
    </Link>
  );
}

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchPrompt, setSearchPrompt] = useState(false);
  const searchInputRef = useRef(null);
  const searchToggleRef = useRef(null);
  const searchPanelRef = useRef(null);
  const mainContentRef = useRef(null);
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);
  const previousScrollLocationRef = useRef(null);
  const pendingHashScrollRef = useRef('');
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { cartCount, notify, studioSettings } = useShop();
  const { user, openAuth, signOut, signingOut, authModalOpen } = useAuth();
  const announcement = studioSettings?.announcement || {};
  const contact = resolveStudioContact(studioSettings);
  const floatingWhatsAppPhone = contact.phone || DEFAULT_STUDIO_CONTACT.phone;
  const announcementEnabled = announcement.enabled ?? true;
  const announcementText = configuredValue(
    studioSettings,
    announcement,
    'text',
    'announcementText',
    'Every piece handmade with care',
  );
  const announcementLinkLabel = configuredValue(
    studioSettings,
    announcement,
    'linkLabel',
    'announcementLinkLabel',
    'PAN India delivery',
  );
  const announcementLinkUrl = configuredValue(
    studioSettings,
    announcement,
    'linkUrl',
    'announcementLinkUrl',
    '/shop',
  );
  const [pageLabel, pageTitle] = pageMetaFor(location.pathname);

  const handleSignOut = async () => {
    setMenuOpen(false);
    try {
      await signOut();
      navigate('/');
    } catch {
      navigate('/account');
      notify('Sign out could not be confirmed. Please try again.', 'error');
    }
  };

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
    setQuery('');
    setSearchPrompt(false);
  }, [location.pathname]);

  useEffect(() => {
    let hashFrame;
    let hashTimer;
    let hashPollTimer;
    let hashSettleTimer;
    let hashObserver;
    let hashObserverDeadline;
    const previous = previousScrollLocationRef.current;
    const hashScrollKey = JSON.stringify([location.pathname, location.hash]);
    let intent = routeScrollIntent({
      previous,
      pathname: location.pathname,
      hash: location.hash,
      navigationType,
    });
    if (location.hash && pendingHashScrollRef.current === hashScrollKey) {
      intent = { type: 'hash', hash: location.hash.slice(1) };
    }
    const currentScrollLocation = {
      pathname: location.pathname,
      hash: location.hash,
    };
    previousScrollLocationRef.current = currentScrollLocation;

    if (intent.type === 'hash') {
      pendingHashScrollRef.current = hashScrollKey;
      let targetId = intent.hash;
      try { targetId = decodeURIComponent(targetId); } catch { /* use the literal hash */ }
      const finishHashScroll = () => {
        if (pendingHashScrollRef.current === hashScrollKey) {
          pendingHashScrollRef.current = '';
        }
        hashObserver?.disconnect();
        if (hashFrame) window.cancelAnimationFrame(hashFrame);
        if (hashTimer) window.clearTimeout(hashTimer);
        if (hashPollTimer) window.clearTimeout(hashPollTimer);
        if (hashSettleTimer) window.clearTimeout(hashSettleTimer);
        if (hashObserverDeadline) window.clearTimeout(hashObserverDeadline);
      };
      const scrollToHash = () => {
        const target = document.getElementById(targetId);
        if (!target) return false;
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (hashFrame) window.cancelAnimationFrame(hashFrame);
        if (hashTimer) window.clearTimeout(hashTimer);
        if (hashPollTimer) window.clearTimeout(hashPollTimer);
        if (hashSettleTimer) window.clearTimeout(hashSettleTimer);
        hashSettleTimer = window.setTimeout(() => {
          document.getElementById(targetId)?.scrollIntoView({
            block: 'start',
            behavior: 'instant',
          });
          finishHashScroll();
        }, 300);
        return true;
      };
      const pollForHash = () => {
        if (!scrollToHash()) {
          hashPollTimer = window.setTimeout(pollForHash, 100);
        }
      };
      hashFrame = window.requestAnimationFrame(scrollToHash);
      hashTimer = window.setTimeout(pollForHash, 160);
      if (typeof MutationObserver !== 'undefined') {
        hashObserver = new MutationObserver(scrollToHash);
        hashObserver.observe(mainContentRef.current || document.body, {
          childList: true,
          subtree: true,
        });
      }
      hashObserverDeadline = window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView({
          block: 'start',
          behavior: 'instant',
        });
        finishHashScroll();
      }, 4_000);
    } else {
      if (pendingHashScrollRef.current !== hashScrollKey) {
        pendingHashScrollRef.current = '';
      }
      if (intent.type === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
    }

    return () => {
      if (hashFrame) window.cancelAnimationFrame(hashFrame);
      if (hashTimer) window.clearTimeout(hashTimer);
      if (hashPollTimer) window.clearTimeout(hashPollTimer);
      if (hashSettleTimer) window.clearTimeout(hashSettleTimer);
      hashObserver?.disconnect();
      if (hashObserverDeadline) window.clearTimeout(hashObserverDeadline);
    };
  }, [location.hash, location.pathname, navigationType]);

  useEffect(() => {
    if (previousPathRef.current === location.pathname) return undefined;
    previousPathRef.current = location.pathname;
    const focusFrame = window.requestAnimationFrame(() => {
      mainContentRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [location.pathname]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSearchOpen(false);
      window.requestAnimationFrame(() => searchToggleRef.current?.focus());
    };
    const closeOutside = (event) => {
      if (
        searchPanelRef.current?.contains(event.target)
        || searchToggleRef.current?.contains(event.target)
      ) return;
      setSearchOpen(false);
      setSearchPrompt(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [searchOpen]);

  useEffect(() => {

    const normalizedPath = location.pathname === '/'
      ? '/'
      : location.pathname.replace(/\/+$/, '');
    const canonicalUrl = new URL(normalizedPath, CANONICAL_ORIGIN).href;
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
    document.title = pageTitle;
  }, [location.pathname, pageTitle]);

  const submitSearch = (event) => {
    event.preventDefault();
    const clean = query.trim();
    if (!clean) {
      setSearchPrompt(true);
      searchInputRef.current?.focus();
      return;
    }
    setSearchOpen(false);
    setSearchPrompt(false);
    setQuery('');
    navigate(`/shop?q=${encodeURIComponent(clean)}`);
  };

  const activeShopItem = (() => {
    if (location.pathname !== '/shop') return '';
    const params = new URLSearchParams(location.search);
    if (params.get('category') === 'Personalized gifts') return 'Personalized';
    if (params.get('occasion') === 'Wedding') return 'Wedding';
    return 'Shop';
  })();

  const navItemIsActive = (label, to) => to.startsWith('/shop')
    ? activeShopItem === label
    : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <div className="site-shell">
      {announcementEnabled && (announcementText || (announcementLinkLabel && announcementLinkUrl)) && <div className="announcement-bar">
        <Container fluid="xl" className="announcement-bar__inner">
          {announcementText && <span><Icon name="spark" size={14} /> {announcementText}</span>}
          {announcementLinkLabel && announcementLinkUrl && (announcementLinkUrl.startsWith('/') ? <Link to={announcementLinkUrl}>{announcementLinkLabel} <Icon name="arrow" size={14} /></Link> : <a href={announcementLinkUrl} target="_blank" rel="noreferrer">{announcementLinkLabel} <Icon name="arrow" size={14} /></a>)}
        </Container>
      </div>}

      <header className="site-header">
        <Container fluid="xl">
          <Navbar expand="lg" className="studio-navbar">
            <button className="icon-button nav-menu-button d-lg-none" type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Icon name="menu" />
            </button>
            <Navbar.Brand as="div"><Brand /></Navbar.Brand>
            <Nav as="nav" className="mx-auto desktop-nav d-none d-lg-flex" aria-label="Main navigation">
              {navItems.map(([label, to]) => (
                <Nav.Link key={label} as={Link} to={to} className={navItemIsActive(label, to) ? 'active' : undefined} aria-current={navItemIsActive(label, to) ? 'page' : undefined}>{label}</Nav.Link>
              ))}
            </Nav>
            <div className="navbar-tools">
              <button ref={searchToggleRef} className="icon-button" type="button" onClick={() => setSearchOpen((value) => { if (value) setSearchPrompt(false); return !value; })} aria-label={searchOpen ? 'Close product search' : 'Search products'} aria-expanded={searchOpen} aria-controls="header-product-search">
                <Icon name={searchOpen ? 'close' : 'search'} />
              </button>
              {user ? (
                <Dropdown align="end" className="account-menu d-none d-sm-block">
                  <Dropdown.Toggle className="account-menu__toggle" aria-label={`Account menu for ${user.name || user.email}`}>
                    {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" />}
                    <span>{user.name?.split(' ')[0] || 'Account'}</span>
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <div className="account-menu__identity"><strong>{user.name || 'Gift N Wrap account'}</strong><small>{user.email}</small></div>
                    <Dropdown.Item onClick={() => navigate('/account')}>My account</Dropdown.Item>
                    {user.role === 'admin' && <Dropdown.Item onClick={() => navigate('/admin')}>Admin dashboard</Dropdown.Item>}
                    <Dropdown.Divider />
                    <Dropdown.Item onClick={handleSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              ) : (
                <div className="auth-entry d-none d-sm-flex">
                  <button type="button" onClick={() => openAuth('', 'login')}>Log in</button>
                  <button type="button" className="auth-entry__signup" onClick={() => openAuth('', 'signup')}>Sign up</button>
                </div>
              )}
              <Link to="/cart" className="icon-button cart-tool" aria-label={`Shopping bag with ${cartCount} items`}>
                <Icon name="bag" />
                {cartCount > 0 && <Badge pill>{cartCount > 9 ? '9+' : cartCount}</Badge>}
              </Link>
            </div>
          </Navbar>
        </Container>
        <div ref={searchPanelRef} id="header-product-search" className={`header-search ${searchOpen ? 'is-open' : ''}`} aria-hidden={!searchOpen}>
          <Container fluid="xl">
            <Form role="search" onSubmit={submitSearch}>
              <Icon name="search" />
              <Form.Control
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (searchPrompt) setSearchPrompt(false);
                }}
                placeholder="Search clocks, keepsakes, trays…"
                aria-label="Search the studio"
                aria-invalid={searchPrompt}
                aria-describedby={searchPrompt ? 'header-search-prompt' : undefined}
                tabIndex={searchOpen ? 0 : -1}
              />
              <Button type="submit" variant="link" className="text-link" tabIndex={searchOpen ? 0 : -1}>Search <Icon name="arrow" size={16} /></Button>
              {searchPrompt && <p id="header-search-prompt" className="header-search__prompt" role="status">Type what you would like to find.</p>}
            </Form>
          </Container>
        </div>
      </header>

      <Offcanvas show={menuOpen} onHide={() => setMenuOpen(false)} placement="start" className="mobile-menu">
        <Offcanvas.Header>
          <Brand onNavigate={() => setMenuOpen(false)} />
          <button type="button" className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <div className="mobile-menu__account" aria-label="Account actions">
            {user ? (
              <button type="button" className="mobile-menu__account-main" onClick={() => { setMenuOpen(false); navigate('/account'); }}>
                <span className="mobile-menu__account-icon">{user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" />}</span>
                <span><strong>My account</strong><small>{user.name || user.email}</small></span>
                <Icon name="arrow" />
              </button>
            ) : (
              <>
                <p><Icon name="user" /> Your studio account</p>
                <div>
                  <button type="button" onClick={() => { setMenuOpen(false); openAuth('', 'login'); }}>Log in</button>
                  <button type="button" className="is-primary" onClick={() => { setMenuOpen(false); openAuth('', 'signup'); }}>Create account</button>
                </div>
              </>
            )}
          </div>
          <nav aria-label="Mobile navigation">
            {navItems.map(([label, to], index) => (
              <Link key={label} to={to} className={`mobile-menu__link ${navItemIsActive(label, to) ? 'active' : ''}`} aria-current={navItemIsActive(label, to) ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
                <span>0{index + 1}</span>{label}<Icon name="arrow" />
              </Link>
            ))}
            <Link to="/custom-order" className="mobile-menu__feature" onClick={() => setMenuOpen(false)}>
              <span><Icon name="spark" /> Have an idea?</span>
              <strong>Commission something completely new.</strong>
            </Link>
            <div className="mobile-menu__utility">
              <Link to="/contact" onClick={() => setMenuOpen(false)}><Icon name="mail" /> Contact the studio</Link>
              <Link to="/care-and-delivery" onClick={() => setMenuOpen(false)}><Icon name="package" /> Care & delivery</Link>
            </div>
          </nav>
          <div className="mobile-menu__footer">
            {user && <>{user.role === 'admin' && <button type="button" className="plain-link" onClick={() => { setMenuOpen(false); navigate('/admin'); }}><Icon name="shield" /> Admin dashboard</button>}<button type="button" className="plain-link" onClick={handleSignOut} disabled={signingOut}><Icon name="logout" /> {signingOut ? 'Signing out…' : 'Sign out'}</button></>}
            {contact.phoneHref && <a href={contact.phoneHref}><Icon name="phone" /> {contact.phoneLabel}</a>}
          </div>
        </Offcanvas.Body>
      </Offcanvas>

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{pageLabel} page</p>
      {location.pathname === '/' && <FloatingWhatsAppButton phone={floatingWhatsAppPhone} />}

      <main ref={mainContentRef} id="main-content" tabIndex="-1">
        <Outlet />
      </main>

      <Footer settings={studioSettings} />
      {authModalOpen && <Suspense fallback={null}><AuthModal /></Suspense>}
      <OfferPopup />
      <ToastStack aboveBuyBar={location.pathname.startsWith('/product/')} />
    </div>
  );
}

function Footer({ settings }) {
  const contact = resolveStudioContact(settings);
  return (
    <footer className="site-footer">
      <div className="footer-marquee" aria-hidden="true">
        <span>Handcrafted with love</span><i>✦</i><span>Designed to impress</span><i>✦</i><span>Made to last</span>
      </div>
      <Container fluid="xl">
        <div className="footer-grid">
          <div className="footer-intro">
            <Brand />
            <p>We preserve names, flowers, photographs and stories in thoughtful resin art—one handmade piece at a time.</p>
            <div className="d-flex flex-column align-items-start gap-2">
              {contact.instagramUrl && <a href={contact.instagramUrl} target="_blank" rel="noreferrer" className="social-link"><Icon name="instagram" /> {contact.instagramLabel || 'Instagram'}</a>}
            </div>
          </div>
          <div>
            <p className="footer-heading">Explore</p>
            <nav className="footer-links" aria-label="Explore">
              <Link to="/shop">Shop all pieces</Link>
              <Link to="/custom-order">Custom orders</Link>
              <Link to="/corporate-gifts">Corporate gifts</Link>
              <Link to="/our-story">Our story</Link>
            </nav>
          </div>
          <div>
            <p className="footer-heading">Helpful</p>
            <nav className="footer-links" aria-label="Helpful links">
              <Link to="/care-and-delivery">Care & delivery</Link>
              <Link to="/contact">Contact the studio</Link>
              <Link to="/contact#faq">Common questions</Link>
            </nav>
          </div>
          <div className="footer-contact">
            <p className="footer-heading">Visit & contact</p>
            <nav className="footer-links" aria-label="Studio contact links">
              {contact.phoneHref && <a href={contact.phoneHref}><Icon name="phone" /> {contact.phoneLabel}</a>}
              {contact.email && <a href={`mailto:${contact.email}`}><Icon name="mail" /> {contact.email}</a>}
              <a href="https://maps.app.goo.gl/Tfcr1XpcvsaZqgJ28?g_st=iw" target="_blank" rel="noreferrer"><Icon name="map" /> Open studio location</a>
            </nav>
          </div>
        </div>
        <div className="footer-bottom">
          <div><span>© {new Date().getFullYear()} Gift N Wrap Studio</span><span>Custom orders welcome · PAN India delivery</span></div>
          <nav className="footer-legal" aria-label="Legal and policy links">
            <Link to="/terms-and-conditions">Terms</Link>
            <Link to="/privacy-policy">Privacy</Link>
            <Link to="/cancellation-and-refund-policy">Cancellation & refunds</Link>
            <Link to="/shipping-policy">Shipping</Link>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
