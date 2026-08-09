import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { demoProducts, formatCurrency } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';

const tabs = [
  ['overview', 'Overview'],
  ['orders', 'Orders & requests'],
  ['saved', 'Saved pieces'],
  ['profile', 'Profile & addresses'],
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
  const { user, loading: authLoading, openAuth, signOut } = useAuth();
  const { wishlist } = useShop();
  const [tab, setTab] = useState('overview');
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const loadOrders = useCallback(async () => {
    if (!user) return;
    setOrdersLoading(true);
    setError('');
    try {
      const result = await api.getBuyerOrders();
      setOrders(result.data || result.orders || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setOrdersLoading(false);
    }
  }, [user]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const savedProducts = useMemo(() => demoProducts.filter((product) => wishlist.includes(product.id)), [wishlist]);

  if (authLoading) return <div className="route-loader" role="status"><span /><span /><span /></div>;
  if (!user) {
    return (
      <Container className="account-signin page-section">
        <div className="account-signin__visual"><span>G<span>·</span>W</span><i aria-hidden="true">✦</i></div>
        <div><p className="eyebrow">Your studio account</p><h1>Every thoughtful detail, remembered.</h1><p>Sign in to keep customization details together and follow your handmade order from studio review to delivery.</p><ul className="check-list"><li><Icon name="check" /> Secure Google sign-in</li><li><Icon name="check" /> Order and request updates</li><li><Icon name="check" /> Your bag and saved pieces stay on this device</li></ul><Button className="button-burgundy" onClick={() => openAuth()}>Continue with Google <Icon name="arrow" /></Button><p className="privacy-note">Your shopping bag is already saved on this device.</p></div>
      </Container>
    );
  }

  const displayName = user.name?.split(' ')[0] || 'there';
  const latestOrder = orders[0];

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <section className="account-page page-section">
      <Container fluid="xl">
        {location.state?.deniedFrom && <Alert variant="warning" className="soft-alert">That workspace is reserved for the studio administrator. You’re safely signed in to your buyer account.</Alert>}
        <header className="account-header">
          <div><p className="eyebrow">My Gift N Wrap</p><h1>Good to see you, {displayName}.</h1><p>Everything made, saved and requested for you lives here.</p></div>
          <div className="account-header__actions">{user.role === 'admin' && <Button as={Link} to="/admin" variant="outline-dark">Open admin</Button>}<button type="button" className="plain-link" onClick={handleSignOut}>Sign out</button></div>
        </header>
        <div className="account-tabs" role="tablist" aria-label="Account sections">{tabs.map(([key,label])=><button type="button" key={key} role="tab" aria-selected={tab===key} className={tab===key?'is-active':''} onClick={()=>setTab(key)}>{label}</button>)}</div>
        {error && <Alert variant="warning" className="soft-alert">{error} <button type="button" className="plain-link" onClick={loadOrders}>Retry</button></Alert>}
        {tab === 'overview' && <Overview user={user} latestOrder={latestOrder} orders={orders} savedCount={savedProducts.length} loading={ordersLoading} goTo={setTab} />}
        {tab === 'orders' && <OrdersPanel orders={orders} loading={ordersLoading} />}
        {tab === 'saved' && <SavedPanel products={savedProducts} />}
        {tab === 'profile' && <ProfilePanel user={user} />}
      </Container>
    </section>
  );
}

function Overview({ user, latestOrder, orders, savedCount, loading, goTo }) {
  return <div className="account-panel"><div className="account-stat-grid"><button type="button" onClick={()=>goTo('orders')}><span><Icon name="package"/></span><p><strong>{orders.length}</strong><small>Orders & requests</small></p><Icon name="arrow"/></button><button type="button" onClick={()=>goTo('saved')}><span><Icon name="heart"/></span><p><strong>{savedCount}</strong><small>Saved pieces</small></p><Icon name="arrow"/></button><button type="button" onClick={()=>goTo('profile')}><span><Icon name="map"/></span><p><strong>{user.addresses?.length || 0}</strong><small>Saved addresses</small></p><Icon name="arrow"/></button></div><Row className="g-4"><Col lg={8}>{loading?<div className="account-loading"><Spinner/><span>Gathering your studio updates…</span></div>:latestOrder?<OrderCard order={latestOrder}/>:<div className="account-empty"><span><Icon name="spark"/></span><div><p className="eyebrow">No requests yet</p><h2>Your first keepsake can begin whenever you’re ready.</h2><p>Choose a studio design to personalize or bring us a completely new idea.</p><Button as={Link} to="/shop" className="button-burgundy">Explore pieces</Button><Link to="/custom-order" className="text-link">Start a custom design <Icon name="arrow"/></Link></div></div>}</Col><Col lg={4}><aside className="account-help"><Icon name="phone"/><p className="eyebrow">Direct studio help</p><h2>A real person, close to every order.</h2><p>For a date-sensitive gift or customization question, speak with our studio.</p><a href="tel:+919588281126">95882 81126 <Icon name="arrow"/></a></aside></Col></Row></div>;
}

function OrdersPanel({ orders, loading }) {
  if(loading)return <div className="account-loading"><Spinner/><span>Loading your requests…</span></div>;
  if(!orders.length)return <div className="account-empty account-empty--wide"><span><Icon name="package"/></span><div><p className="eyebrow">Orders & requests</p><h2>Nothing here yet.</h2><p>When you send a custom or catalogue order request, its design and delivery progress will appear here.</p><Button as={Link} to="/shop" className="button-burgundy">Find a piece</Button></div></div>;
  return <div className="orders-list">{orders.map(order=><OrderCard key={order.id||order._id||order.orderNumber} order={order}/>)}</div>;
}

function OrderCard({ order }) {
  const status = order.status || 'placed';
  const normalizedStatus = status;
  const currentIndex = statusOrder.indexOf(normalizedStatus);
  const items = order.items || [];
  return <article className="order-card"><div className="order-card__head"><div><p className="eyebrow">{order.orderNumber||`Request ${String(order._id||order.id||'').slice(-6).toUpperCase()}`}</p><h2>{items[0]?.product?.title||items[0]?.name||'Custom studio order'}{items.length>1&&` + ${items.length-1} more`}</h2></div><span className={`order-status status-${status}`}>{statusLabels[status]||status.replaceAll('_',' ')}</span></div>{status==='cancelled'?<Alert variant="secondary" className="soft-alert">This request was closed. Contact the studio if you’d like to revisit the design.</Alert>:<div className="order-timeline" aria-label={`Order status: ${statusLabels[status]||status}`} >{statusOrder.map((key,index)=><div className={`${index<=currentIndex?'is-complete':''} ${index===currentIndex?'is-current':''}`} key={key}><i>{index<currentIndex?<Icon name="check" size={12}/>:index+1}</i><span>{statusLabels[key]}</span></div>)}</div>}<div className="order-card__foot"><p><small>Request total</small><strong>{order.total?formatCurrency(order.total):'Pending studio review'}</strong></p><p><small>Last updated</small><strong>{order.updatedAt?new Date(order.updatedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Recently'}</strong></p><a href="tel:+919588281126" className="text-link">Ask the studio <Icon name="arrow"/></a></div></article>;
}

function SavedPanel({ products }) {
  if(!products.length)return <div className="account-empty account-empty--wide"><span><Icon name="heart"/></span><div><p className="eyebrow">Saved pieces</p><h2>Your inspiration shelf is empty.</h2><p>Tap the heart on any piece to keep it close while you decide.</p><Button as={Link} to="/shop" className="button-burgundy">Explore the collection</Button></div></div>;
  return <Row className="g-4 account-saved-grid">{products.map((product,index)=><Col sm={6} lg={3} key={product.id}><ProductCard product={product} index={index}/></Col>)}</Row>;
}

function ProfilePanel({ user }) {
  return <Row className="g-4 account-profile"><Col lg={6}><div className="profile-card"><p className="eyebrow">Personal details</p><h2>Your Google profile</h2><dl><div><dt>Name</dt><dd>{user.name||'Not provided'}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Account type</dt><dd>{user.role==='admin'?'Studio administrator':'Buyer'}</dd></div></dl><p><Icon name="lock"/> Name and email are managed through your signed-in Google account.</p></div></Col><Col lg={6}><div className="profile-card"><p className="eyebrow">Delivery addresses</p><h2>Saved for next time</h2>{user.addresses?.length?user.addresses.map((address,index)=><address key={address.id||index}>{address.label&&<strong>{address.label}</strong>}{address.line1}<br/>{address.line2&&<>{address.line2}<br/></>}{address.city}, {address.state} {address.postalCode}</address>):<div className="profile-empty"><Icon name="map"/><p>No saved address yet. Your first confirmed delivery address can appear here for a quicker next request.</p></div>}</div></Col></Row>;
}
