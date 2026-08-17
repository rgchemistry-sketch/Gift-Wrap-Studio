import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';
import Offcanvas from 'react-bootstrap/Offcanvas';
import Dropdown from 'react-bootstrap/Dropdown';
import Icon from './Icon';
import { ToastStack } from './Feedback';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { resolveStudioContact } from '../utils/studio-contact';
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
const OfferPopup = lazy(() => import('./OfferPopup'));

const configuredValue = (settings, group, key, legacyKey, fallback) => {
  if (!settings) return fallback;
  if (Object.prototype.hasOwnProperty.call(group, key)) return group[key] ?? '';
  if (legacyKey && Object.prototype.hasOwnProperty.call(settings, legacyKey)) {
    return settings[legacyKey] ?? '';
  }
  return fallback;
};

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Gift N Wrap Studio home">
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
  const location = useLocation();
  const navigate = useNavigate();
  const { cartCount, notify, studioSettings, welcomeOffer } = useShop();
  const { user, openAuth, signOut, signingOut, authModalOpen } = useAuth();
  const announcement = studioSettings?.announcement || {};
  const contact = resolveStudioContact(studioSettings);
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

  const handleSignOut = async () => {
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
    window.scrollTo({ top: 0, behavior: 'instant' });

    const normalizedPath = location.pathname === '/'
      ? '/'
      : location.pathname.replace(/\/+$/, '');
    const canonicalUrl = new URL(normalizedPath, CANONICAL_ORIGIN).href;
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
  }, [location.pathname]);

  const submitSearch = (event) => {
    event.preventDefault();
    const clean = query.trim();
    if (clean) navigate(`/shop?q=${encodeURIComponent(clean)}`);
  };

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
            <Nav className="mx-auto desktop-nav d-none d-lg-flex" aria-label="Main navigation">
              {navItems.map(([label, to]) => (
                <Nav.Link key={label} as={NavLink} to={to} end={to === '/shop'}>{label}</Nav.Link>
              ))}
            </Nav>
            <div className="navbar-tools">
              <button className="icon-button" type="button" onClick={() => setSearchOpen((value) => !value)} aria-label="Search products" aria-expanded={searchOpen}>
                <Icon name="search" />
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
        <div className={`header-search ${searchOpen ? 'is-open' : ''}`} aria-hidden={!searchOpen}>
          <Container fluid="xl">
            <Form role="search" onSubmit={submitSearch}>
              <Icon name="search" />
              <Form.Control
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search clocks, keepsakes, trays…"
                aria-label="Search the studio"
                tabIndex={searchOpen ? 0 : -1}
              />
              <Button type="submit" variant="link" className="text-link" tabIndex={searchOpen ? 0 : -1}>Search <Icon name="arrow" size={16} /></Button>
            </Form>
          </Container>
        </div>
      </header>

      <Offcanvas show={menuOpen} onHide={() => setMenuOpen(false)} placement="start" className="mobile-menu">
        <Offcanvas.Header>
          <Brand />
          <button type="button" className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <nav aria-label="Mobile navigation">
            {navItems.map(([label, to], index) => (
              <NavLink key={label} to={to} className="mobile-menu__link">
                <span>0{index + 1}</span>{label}<Icon name="arrow" />
              </NavLink>
            ))}
            <NavLink to="/custom-order" className="mobile-menu__feature">
              <span><Icon name="spark" /> Have an idea?</span>
              <strong>Commission something completely new.</strong>
            </NavLink>
          </nav>
          <div className="mobile-menu__footer">
            {user ? <><button type="button" className="plain-link" onClick={() => navigate('/account')}><Icon name="user" /> My account</button>{user.role === 'admin' && <button type="button" className="plain-link" onClick={() => navigate('/admin')}><Icon name="shield" /> Admin dashboard</button>}<button type="button" className="plain-link" onClick={handleSignOut} disabled={signingOut}><Icon name="close" /> {signingOut ? 'Signing out…' : 'Sign out'}</button></> : <><button type="button" className="plain-link" onClick={() => openAuth('', 'login')}><Icon name="user" /> Log in</button><button type="button" className="plain-link" onClick={() => openAuth('', 'signup')}><Icon name="spark" /> Create account</button></>}
            {contact.phoneHref && <a href={contact.phoneHref}><Icon name="phone" /> {contact.phoneLabel}</a>}
          </div>
        </Offcanvas.Body>
      </Offcanvas>

      <main id="main-content" tabIndex="-1">
        <Outlet />
      </main>

      <Footer settings={studioSettings} />
      {authModalOpen && <Suspense fallback={null}><AuthModal /></Suspense>}
      {welcomeOffer && <Suspense fallback={null}><OfferPopup /></Suspense>}
      <ToastStack />
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
            <Link to="/shop">Shop all pieces</Link>
            <Link to="/custom-order">Custom orders</Link>
            <Link to="/corporate-gifts">Corporate gifts</Link>
            <Link to="/our-story">Our story</Link>
          </div>
          <div>
            <p className="footer-heading">Helpful</p>
            <Link to="/care-and-delivery">Care & delivery</Link>
            <Link to="/contact">Contact the studio</Link>
            <Link to="/contact#faq">Common questions</Link>
            <Link to="/account">Track an order</Link>
          </div>
          <div className="footer-contact">
            <p className="footer-heading">Visit & contact</p>
            {contact.phoneHref && <a href={contact.phoneHref}><Icon name="phone" /> {contact.phoneLabel}</a>}
            {contact.email && <a href={`mailto:${contact.email}`}><Icon name="mail" /> {contact.email}</a>}
            <a href="https://maps.app.goo.gl/Tfcr1XpcvsaZqgJ28?g_st=iw" target="_blank" rel="noreferrer"><Icon name="map" /> Open studio location</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Gift N Wrap Studio</span>
          <span>Custom orders welcome · PAN India delivery</span>
        </div>
      </Container>
    </footer>
  );
}
