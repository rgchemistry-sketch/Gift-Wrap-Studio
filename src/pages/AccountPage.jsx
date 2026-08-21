import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../components/Icon';
import ProductCard from '../components/ProductCard';
import { api } from '../api/client';
import { formatCurrency } from '../data/catalog';
import { useCatalog } from '../data/useCatalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { resolveStudioContact } from '../utils/studio-contact';
import '../form-experience.css';

const tabs = [
  ['overview', 'Overview'],
  ['orders', 'Orders & requests'],
  ['saved', 'Saved pieces'],
  ['profile', 'Profile & delivery'],
];

const statusOrder = ['placed', 'confirmed', 'in_progress', 'ready', 'shipped', 'delivered'];
const statusLabels = {
  placed: 'Request placed',
  confirmed: 'Details confirmed',
  in_progress: 'Handcrafting',
  ready: 'Ready to dispatch',
  shipped: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export default function AccountPage() {
  const { user, loading: authLoading, openAuth, signOut, signingOut } = useAuth();
  const { wishlist, studioSettings } = useShop();
  const {
    products: catalog,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useCatalog();
  const [tab, setTab] = useState('overview');
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const contact = resolveStudioContact(studioSettings);
  const panelRef = useRef(null);

  const loadOrders = useCallback(async () => {
    if (!user) return;
    setOrdersLoading(true);
    setError('');
    try {
      setOrders(await api.getAllBuyerOrders());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setOrdersLoading(false);
    }
  }, [user]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(location.search).get('tab');
    setTab(tabs.some(([key]) => key === requestedTab) ? requestedTab : 'overview');
  }, [location.search]);

  // The wishlist stores live catalogue ids, so it has to be matched against the live
  // catalogue — matching fixture ids left every saved piece invisible.
  const savedProducts = useMemo(
    () => catalog.filter((product) => wishlist.includes(product.id)),
    [catalog, wishlist],
  );

  const selectTab = (nextTab, { focusPanel = true } = {}) => {
    setTab(nextTab);
    const params = new URLSearchParams(location.search);
    if (nextTab === 'overview') params.delete('tab');
    else params.set('tab', nextTab);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
    if (focusPanel) window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  };

  const handleTabKeyDown = (event, currentKey) => {
    const currentIndex = tabs.findIndex(([key]) => key === currentKey);
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextKey = tabs[nextIndex][0];
    selectTab(nextKey, { focusPanel: false });
    window.requestAnimationFrame(() => document.getElementById(`account-tab-${nextKey}`)?.focus());
  };

  if (authLoading) return <div className="route-loader" role="status"><span /><span /><span /></div>;
  if (!user) {
    return (
      <Container className="account-signin page-section">
        <div className="account-signin__visual"><span>G<span>·</span>W</span><i aria-hidden="true">✦</i></div>
        <div><p className="eyebrow">Your studio account</p><h1>Every thoughtful detail, remembered.</h1><p>Log in with a secure email code or Google to keep customization details together and follow your handmade order from studio review to delivery.</p><ul className="check-list"><li><Icon name="check" /> Password-free verified sign-in</li><li><Icon name="check" /> Order and request updates</li><li><Icon name="check" /> Your bag and saved pieces stay on this device</li></ul><div className="account-signin__actions"><Button className="button-burgundy" onClick={() => openAuth('', 'signup')}>Create account <Icon name="arrow" /></Button><Button variant="outline-dark" onClick={() => openAuth('', 'login')}>Log in</Button></div><p className="privacy-note">New here? Choose Create account. Returning customers can use Log in.</p></div>
      </Container>
    );
  }

  const displayName = user.name?.split(' ')[0] || 'there';
  const latestOrder = orders[0];

  const handleSignOut = async () => {
    setSignOutError('');
    try {
      await signOut();
      navigate('/');
    } catch (requestError) {
      setSignOutError(requestError.message);
    }
  };

  return (
    <section className="account-page page-section">
      <Container fluid="xl">
        {location.state?.deniedFrom && <Alert variant="warning" className="soft-alert">That workspace is reserved for the studio administrator. You’re safely signed in to your buyer account.</Alert>}
        <header className="account-header">
          <div><p className="eyebrow">My Gift N Wrap</p><h1>Good to see you, {displayName}.</h1><p>Everything made, saved and requested for you lives here.</p></div>
          <div className="account-header__actions">{user.role === 'admin' && <Button as={Link} to="/admin" variant="outline-dark">Open admin</Button>}<button type="button" className="plain-link" disabled={signingOut} onClick={handleSignOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div>
        </header>
        {signOutError && <Alert variant="warning" className="soft-alert">{signOutError} <button type="button" className="plain-link" disabled={signingOut} onClick={handleSignOut}>Retry sign out</button></Alert>}
        <div className="account-tabs" role="tablist" aria-label="Account sections">{tabs.map(([key,label])=><button type="button" role="tab" id={`account-tab-${key}`} aria-selected={tab===key} aria-controls="account-panel" tabIndex={tab===key?0:-1} key={key} className={tab===key?'is-active':''} onKeyDown={(event)=>handleTabKeyDown(event,key)} onClick={()=>selectTab(key)}>{label}</button>)}</div>
        {error && (tab === 'overview' || tab === 'orders') && <Alert variant="warning" className="soft-alert">{error} <button type="button" className="plain-link" onClick={loadOrders}>Retry</button></Alert>}
        <div ref={panelRef} className="account-tab-panel" role="tabpanel" id="account-panel" aria-labelledby={`account-tab-${tab}`} tabIndex="-1" aria-busy={tab === 'saved' ? catalogLoading : (tab === 'overview' || tab === 'orders') && ordersLoading}>
          {tab === 'overview' && <Overview latestOrder={latestOrder} orders={orders} savedCount={catalogLoading && wishlist.length ? '—' : savedProducts.length} loading={ordersLoading} error={error} goTo={selectTab} contact={contact} />}
          {tab === 'orders' && <OrdersPanel orders={orders} loading={ordersLoading} error={error} contact={contact} />}
          {tab === 'saved' && <SavedPanel products={savedProducts} hasSavedItems={wishlist.length > 0} loading={catalogLoading} error={catalogError} retry={() => refreshCatalog({ force: true })} />}
          {tab === 'profile' && <ProfilePanel user={user} />}
        </div>
      </Container>
    </section>
  );
}

function Overview({ latestOrder, orders, savedCount, loading, error, goTo, contact }) {
  return <div className="account-panel"><div className="account-stat-grid"><button type="button" onClick={()=>goTo('orders')}><span><Icon name="package"/></span><p><strong>{orders.length}</strong><small>Orders & requests</small></p><Icon name="arrow"/></button><button type="button" onClick={()=>goTo('saved')}><span><Icon name="heart"/></span><p><strong>{savedCount}</strong><small>Saved pieces</small></p><Icon name="arrow"/></button><button type="button" onClick={()=>goTo('profile')}><span><Icon name="map"/></span><p><strong>Per order</strong><small>Delivery details</small></p><Icon name="arrow"/></button></div><Row className="g-4"><Col lg={contact.phoneHref ? 8 : 12}>{loading?<div className="account-loading" role="status"><Spinner/><span>Gathering your studio updates…</span></div>:error&&!latestOrder?<div className="account-empty"><span><Icon name="package"/></span><div><p className="eyebrow">Studio updates unavailable</p><h2>We couldn’t gather your requests.</h2><p>Use Retry above. Nothing in your account has been changed.</p></div></div>:latestOrder?<OrderCard order={latestOrder} contact={contact}/>:<div className="account-empty"><span><Icon name="spark"/></span><div><p className="eyebrow">No requests yet</p><h2>Your first keepsake can begin whenever you’re ready.</h2><p>Choose a studio design to personalize or bring us a completely new idea.</p><div className="account-empty__actions"><Button as={Link} to="/shop" className="button-burgundy">Explore pieces</Button><Link to="/custom-order" className="text-link">Start a custom design <Icon name="arrow"/></Link></div></div></div>}</Col>{contact.phoneHref && <Col lg={4}><aside className="account-help"><Icon name="phone"/><p className="eyebrow">Direct studio help</p><h2>A real person, close to every order.</h2><p>For a date-sensitive gift or customization question, speak with our studio.</p><a href={contact.phoneHref}>{contact.phoneLabel} <Icon name="arrow"/></a></aside></Col>}</Row></div>;
}

function OrdersPanel({ orders, loading, error, contact }) {
  if(loading)return <div className="account-loading" role="status"><Spinner/><span>Loading your requests…</span></div>;
  if(error&&!orders.length)return <div className="account-empty account-empty--wide"><span><Icon name="package"/></span><div><p className="eyebrow">Orders & requests</p><h2>Your requests couldn’t be loaded.</h2><p>Use Retry above. Nothing in your account has been changed.</p></div></div>;
  if(!orders.length)return <div className="account-empty account-empty--wide"><span><Icon name="package"/></span><div><p className="eyebrow">Orders & requests</p><h2>Nothing here yet.</h2><p>When you send a custom or catalogue order request, its design and delivery progress will appear here.</p><div className="account-empty__actions"><Button as={Link} to="/shop" className="button-burgundy">Find a piece</Button></div></div></div>;
  return <div className="orders-list">{orders.map(order=><OrderCard key={order.id||order._id||order.orderNumber} order={order} contact={contact}/>)}</div>;
}

function OrderCard({ order, contact }) {
  const status = order.status || 'placed';
  const normalizedStatus = status;
  const currentIndex = statusOrder.indexOf(normalizedStatus);
  const items = order.items || [];
  return <article className="order-card"><div className="order-card__head"><div><p className="eyebrow">{order.orderNumber||`Request ${String(order._id||order.id||'').slice(-6).toUpperCase()}`}</p><h2>{items[0]?.product?.title||items[0]?.name||'Custom studio order'}{items.length>1&&` + ${items.length-1} more`}</h2></div><span className={`order-status status-${status}`}>{statusLabels[status]||status.replaceAll('_',' ')}</span></div>{status==='cancelled'?<Alert variant="secondary" className="soft-alert">This request was closed. Contact the studio if you’d like to revisit the design.</Alert>:<div className="order-timeline" aria-label={`Order status: ${statusLabels[status]||status}`} >{statusOrder.map((key,index)=><div className={`${index<=currentIndex?'is-complete':''} ${index===currentIndex?'is-current':''}`} key={key}><i>{index<currentIndex?<Icon name="check" size={12}/>:index+1}</i><span>{statusLabels[key]}</span></div>)}</div>}<div className="order-card__foot"><p><small>Request total</small><strong>{order.total != null?formatCurrency(order.total):'Pending studio review'}</strong></p><p><small>Last updated</small><strong>{order.updatedAt?new Date(order.updatedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Recently'}</strong></p>{contact.phoneHref && <a href={contact.phoneHref} className="text-link">Ask the studio <Icon name="arrow"/></a>}</div></article>;
}

function SavedPanel({ products, hasSavedItems, loading, error, retry }) {
  if(hasSavedItems && loading)return <div className="account-loading" role="status"><Spinner/><span>Gathering your saved pieces…</span></div>;
  if(hasSavedItems && error && !products.length)return <div className="account-empty account-empty--wide" role="alert"><span><Icon name="heart"/></span><div><p className="eyebrow">Saved pieces</p><h2>Your inspiration shelf didn’t load.</h2><p>{error} Your saved choices are still remembered.</p><div className="account-empty__actions"><Button type="button" className="button-burgundy" onClick={retry}>Try again</Button></div></div></div>;
  if(!hasSavedItems)return <div className="account-empty account-empty--wide"><span><Icon name="heart"/></span><div><p className="eyebrow">Saved pieces</p><h2>Your inspiration shelf is empty.</h2><p>Tap the heart on any piece to keep it close while you decide.</p><div className="account-empty__actions"><Button as={Link} to="/shop" className="button-burgundy">Explore the collection</Button></div></div></div>;
  if(!products.length)return <div className="account-empty account-empty--wide"><span><Icon name="heart"/></span><div><p className="eyebrow">Saved pieces</p><h2>Those pieces have left the current collection.</h2><p>Explore what is on the studio table now, or begin a custom version of what you loved.</p><div className="account-empty__actions"><Button as={Link} to="/shop" className="button-burgundy">See current pieces</Button></div></div></div>;
  return <>{error && <Alert variant="warning" className="soft-alert account-saved-alert">We couldn’t refresh every saved piece. <button type="button" className="plain-link" onClick={retry}>Try again</button></Alert>}<Row className="g-4 account-saved-grid">{products.map((product,index)=><Col sm={6} lg={3} key={product.id}><ProductCard product={product} index={index}/></Col>)}</Row></>;
}

function ProfilePanel({ user }) {
  const providerLabels = (user.providers || user.authProviders || [user.lastAuthProvider])
    .filter(Boolean)
    .map((provider) => ({ google: 'Google', email: 'Email code' }[provider] || 'Legacy sign-in'));
  return <Row className="g-4 account-profile"><Col lg={6}><div className="profile-card"><p className="eyebrow">Personal details</p><h2>Your verified profile</h2><dl><div><dt>Name</dt><dd>{user.name||'Not provided'}</dd></div><div><dt>Email</dt><dd>{user.email}{user.emailVerified !== false&&' · Verified'}</dd></div><div><dt>Sign-in</dt><dd>{providerLabels.length?[...new Set(providerLabels)].join(', '):'Verified account'}</dd></div><div><dt>Account type</dt><dd>{user.role==='admin'?'Studio administrator':'Buyer'}</dd></div></dl><p><Icon name="lock"/> Your identity is verified by the sign-in method you chose. We never store a password.</p></div></Col><Col lg={6}><div className="profile-card"><p className="eyebrow">Delivery details</p><h2>Kept with each order</h2><div className="profile-empty"><Icon name="map"/><h3>No default address is stored.</h3><p>Choose a piece, then enter the delivery address at checkout. It stays securely with that order, and you can use a different address next time.</p><Button as={Link} to="/shop" variant="outline-dark">Choose a piece</Button></div></div></Col></Row>;
}
