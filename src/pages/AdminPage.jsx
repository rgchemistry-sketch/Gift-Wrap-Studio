import { useCallback, useEffect, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Table from 'react-bootstrap/Table';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import { api } from '../api/client';
import { demoProducts, formatCurrency, normalizeProduct } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';

const demoSummary = {
  metrics: { ordersPending: 8, activeCustomRequests: 5, monthlyRevenue: 48750, products: 28 },
  recentOrders: [
    { id: 'preview-1', orderNumber: 'GNW-PREVIEW-01', customer: { name: 'Preview buyer' }, status: 'placed', total: 2199, createdAt: new Date().toISOString(), items: [{ name: 'Memory Photo Frame' }] },
    { id: 'preview-2', orderNumber: 'GNW-PREVIEW-02', customer: { name: 'Preview buyer' }, status: 'in_progress', total: 4299, createdAt: new Date(Date.now() - 86400000).toISOString(), items: [{ name: 'Geode Wall Clock' }] },
  ],
  lowStock: demoProducts.slice(0, 3).map((product, index) => ({ ...product, stock: index + 1 })),
  inquiries: [
    { id: 'iq-preview', name: 'Preview inquiry', productType: 'Wedding keepsake', budget: '₹3,000 – ₹6,000', status: 'new' },
  ],
  messages: [
    { id: 'msg-preview', name: 'Preview visitor', email: 'preview@example.com', subject: 'Product question', message: 'Is this design available in another colour?', status: 'new', createdAt: new Date().toISOString() },
  ],
};

const adminNav = [
  ['dashboard', 'spark', 'Overview'],
  ['orders', 'package', 'Orders'],
  ['products', 'bag', 'Products'],
  ['requests', 'heart', 'Custom requests'],
  ['messages', 'mail', 'Messages'],
  ['settings', 'shield', 'Studio settings'],
];

export default function AdminPage() {
  const [section, setSection] = useState('dashboard');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const { user, signOut, setUser, signingOut } = useAuth();
  const { notify } = useShop();
  const navigate = useNavigate();
  const demoEnabled = import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [dashboardResult, productsResult, ordersResult, inquiriesResult, contactsResult] = await Promise.all([
        api.getAdminSummary(),
        api.getAdminProducts(),
        api.getAdminOrders(),
        api.getAdminInquiries(),
        api.getAdminContacts(),
      ]);
      const dashboard = dashboardResult.data || dashboardResult;
      const listFrom = (result, keys = []) => {
        const data = result.data ?? result;
        if (Array.isArray(data)) return data;
        for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
        return [];
      };
      const productsList = listFrom(productsResult, ['products', 'items']);
      const recentOrders = listFrom(ordersResult, ['orders', 'items']);
      const inquiries = listFrom(inquiriesResult, ['inquiries', 'items']);
      const messages = listFrom(contactsResult, ['contacts', 'messages', 'items']);
      setSummary({
        metrics: {
          products: Number(dashboard.products || productsList.length),
          totalOrders: Number(dashboard.orders || recentOrders.length),
          activeCustomRequests: Number(dashboard.newInquiries || 0),
          newMessages: Number(dashboard.newMessages || 0),
        },
        productsList,
        recentOrders,
        inquiries,
        messages,
        lowStock: productsList.filter((product) => {
          const available = product.stock ?? product.inventory;
          return available != null && Number.isFinite(Number(available)) && Number(available) <= 3;
        }),
      });
      setPreview(false);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.status === 401 || requestError.status === 403) {
        setUser(null);
        navigate('/account', { replace: true, state: { deniedFrom: '/admin' } });
      } else if (demoEnabled) {
        setSummary(demoSummary);
        setPreview(true);
      } else {
        setSummary(null);
        setPreview(false);
      }
    } finally { setLoading(false); }
  }, [demoEnabled, navigate, setUser]);
  useEffect(()=>{load();},[load]);

  const updateStatus = async (orderId,status) => {
    if(preview){notify('Status changes are disabled while viewing preview data.','neutral');return;}
    try{await api.updateOrderStatus(orderId,status);notify('Order status updated.');await load();}catch(requestError){notify(requestError.message,'error');}
  };

  const updateInquiryStatus = async (inquiryId,status) => {
    if(preview){notify('Request changes are disabled while viewing preview data.','neutral');return;}
    try{await api.updateInquiryStatus(inquiryId,status);notify('Custom request stage updated.');await load();}catch(requestError){notify(requestError.message,'error');}
  };

  const updateMessageStatus = async (contactId,status) => {
    if(preview){notify('Message changes are disabled while viewing preview data.','neutral');return;}
    try{await api.updateContactStatus(contactId,status);notify('Message status updated.');await load();}catch(requestError){notify(requestError.message,'error');}
  };

  return <section className="admin-page">
    <Container fluid="xl">
      <header className="admin-topbar"><div><p className="eyebrow">Gift N Wrap Studio</p><h1>Studio desk</h1></div><div className="admin-topbar__actions"><span className="admin-live-dot"/>{preview?'Preview data':'Live workspace'}<Button as={Link} to="/" variant="outline-dark" size="sm">Storefront</Button><Button as={Link} to="/account" variant="outline-dark" size="sm">My account</Button><Button variant="dark" size="sm" disabled={signingOut} onClick={async()=>{try{await signOut();navigate('/');}catch(requestError){notify(requestError.message,'error');}}}>{signingOut?'Signing out…':'Sign out'}</Button><span className="admin-avatar">{(user.name||'A').charAt(0)}</span></div></header>
      {preview&&<Alert variant="warning" className="soft-alert admin-preview-alert"><strong>Studio preview:</strong> {error} Changes are disabled until the admin service reconnects. <button type="button" className="plain-link" onClick={load}>Retry</button></Alert>}
      <div className="admin-layout">
        <aside className="admin-sidebar"><nav aria-label="Admin sections">{adminNav.map(([key,icon,label])=><button type="button" key={key} className={section===key?'is-active':''} onClick={()=>setSection(key)}><Icon name={icon}/><span>{label}</span>{key==='orders'&&Number(summary?.metrics?.ordersPending||summary?.counts?.pendingOrders)>0&&<Badge pill>{summary?.metrics?.ordersPending||summary?.counts?.pendingOrders}</Badge>}</button>)}</nav><div className="admin-sidebar__note"><Icon name="shield"/><p><strong>Admin protected</strong><small>Role checks are also enforced by the server.</small></p></div></aside>
        <main className="admin-content">
          {loading?<div className="account-loading"><Spinner/><span>Opening the studio desk…</span></div>:!summary?<Alert variant="danger" className="soft-alert"><strong>The live admin workspace could not load.</strong> {error} <button type="button" className="plain-link" onClick={load}>Retry</button></Alert>:<>
            {section==='dashboard'&&<Dashboard summary={summary} setSection={setSection}/>}
            {section==='orders'&&<Orders summary={summary} preview={preview} updateStatus={updateStatus}/>}
            {section==='products'&&<Products summary={summary} preview={preview}/>}
            {section==='requests'&&<Requests summary={summary} preview={preview} updateInquiryStatus={updateInquiryStatus}/>}
            {section==='messages'&&<Messages summary={summary} preview={preview} updateMessageStatus={updateMessageStatus}/>}
            {section==='settings'&&<Settings preview={preview} notify={notify}/>}
          </>}
        </main>
      </div>
    </Container>
  </section>;
}

function Dashboard({summary,setSection}){
  const metrics=summary.metrics||summary.counts||{};
  const cards=[['Total orders',metrics.totalOrders??metrics.ordersPending??metrics.pendingOrders??0,'package','orders'],['New custom requests',metrics.activeCustomRequests??metrics.inquiries??0,'heart','requests'],['New messages',metrics.newMessages??0,'mail','messages'],['Published pieces',metrics.products??metrics.productCount??0,'bag','products']];
  return <><div className="admin-section-head"><div><p className="eyebrow">Today in the studio</p><h2>Overview</h2></div><span>{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}</span></div><div className="admin-metrics">{cards.map(([label,value,icon,target])=><button type="button" onClick={()=>setSection(target)} key={label}><span><Icon name={icon}/></span><p><small>{label}</small><strong>{value}</strong></p><Icon name="arrow"/></button>)}</div><div className="admin-dashboard-grid"><div className="admin-panel"><div className="admin-panel__head"><div><p className="eyebrow">Recent activity</p><h3>Orders needing attention</h3></div><button type="button" className="plain-link" onClick={()=>setSection('orders')}>View all</button></div><MiniOrders orders={summary.recentOrders||summary.orders||[]}/></div><div className="admin-panel"><div className="admin-panel__head"><div><p className="eyebrow">Inventory</p><h3>Low stock pieces</h3></div><button type="button" className="plain-link" onClick={()=>setSection('products')}>Manage</button></div><div className="low-stock-list">{(summary.lowStock||summary.lowStockProducts||[]).slice(0,4).map(raw=>{const product=normalizeProduct(raw);return <div key={product.id}><SmartImage src={product.image} alt="" fallbackLabel={product.category}/><p><strong>{product.title}</strong><small>{raw.stock??raw.inventory??0} remaining</small></p><span>{raw.stock??raw.inventory??0}</span></div>})}</div></div></div></>;
}

function MiniOrders({orders}){if(!orders.length)return <AdminEmpty text="No orders need attention right now."/>;return <div className="mini-orders">{orders.slice(0,5).map(order=><div key={order.id||order._id||order.orderNumber}><span className={`order-status status-${order.status}`}>{String(order.status||'placed').replaceAll('_',' ')}</span><p><strong>{order.orderNumber||String(order.id||order._id).slice(-6)}</strong><small>{order.buyerName||order.customer?.name||order.user?.name||order.buyerEmail||'Buyer'} · {order.items?.[0]?.name||order.items?.[0]?.product?.title||'Studio piece'}</small></p><b>{order.total?formatCurrency(order.total):'Review'}</b></div>)}</div>}

function Orders({summary,preview,updateStatus}){
  const [query, setQuery] = useState('');
  const orders=summary.recentOrders||summary.orders||[];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOrders = normalizedQuery
    ? orders.filter((order) => `${order.orderNumber || ''} ${order.buyerName || ''} ${order.buyerEmail || ''} ${order.customer?.name || ''} ${order.items?.map((item) => item.name).join(' ') || ''}`.toLowerCase().includes(normalizedQuery))
    : orders;
  return <><div className="admin-section-head"><div><p className="eyebrow">Fulfilment</p><h2>Orders</h2></div><div className="admin-search"><Icon name="search"/><input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search order or buyer" aria-label="Search orders"/></div></div><div className="admin-panel admin-table-panel">{filteredOrders.length?<Table responsive hover className="admin-table"><thead><tr><th>Order</th><th>Buyer</th><th>Placed</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredOrders.map(order=><tr key={order.id||order._id||order.orderNumber}><td><strong>{order.orderNumber||String(order.id||order._id).slice(-6).toUpperCase()}</strong><small>{order.items?.length||0} pieces</small></td><td>{order.buyerName||order.customer?.name||order.user?.name||order.buyerEmail||'Buyer'}</td><td>{order.createdAt?new Date(order.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'—'}</td><td>{order.total?formatCurrency(order.total):'Pending'}</td><td><Form.Select size="sm" value={order.status||'placed'} disabled={preview} onChange={event=>updateStatus(order.id||order._id,event.target.value)} aria-label={`Status for ${order.orderNumber||'order'}`}><option value="placed">Placed</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="ready">Ready</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></Form.Select></td></tr>)}</tbody></Table>:<AdminEmpty text={query?'No orders match that search.':'No orders have been placed yet.'}/>}</div></>;
}

function Products({summary}){
  const rawProducts = Array.isArray(summary.productsList) ? summary.productsList : Array.isArray(summary.lowStock) ? summary.lowStock : demoProducts;
  const products=rawProducts.slice(0,12).map(normalizeProduct);
  return <><div className="admin-section-head"><div><p className="eyebrow">Catalogue</p><h2>Products</h2></div><span className="admin-readonly-note"><Icon name="lock" size={14}/> Catalogue editing is API-managed in this release</span></div><div className="admin-product-grid">{products.map(product=><article key={product.id}><SmartImage src={product.image} alt="" fallbackLabel={product.category}/><div><span className={product.inStock?'in-stock':'out-stock'}>{product.inStock?'Published':'Unavailable'}</span><h3>{product.title}</h3><p>{product.category} · {formatCurrency(product.price)}</p><span className="admin-item-readonly">Read-only overview</span></div></article>)}</div></>;
}

function Requests({summary,preview,updateInquiryStatus}){
  const requests=summary.inquiries||summary.customRequests||[];
  return <><div className="admin-section-head"><div><p className="eyebrow">Bespoke work</p><h2>Custom requests</h2></div></div><div className="request-board">{['new','contacted','quoted','accepted','closed'].map(status=><section key={status}><h3>{status==='new'?'New ideas':status==='contacted'?'Contacted':status==='quoted'?'Quoted':status==='accepted'?'Accepted':'Closed'} <span>{requests.filter(item=>(item.status||'new')===status).length}</span></h3>{requests.filter(item=>(item.status||'new')===status).map(item=><article key={item.id||item._id}><p className="eyebrow">{item.productType||'Custom piece'}</p><h4>{item.name}</h4><p>{item.description||item.idea||'Open brief'}</p><small>{item.budget||'Budget to discuss'}</small><Form.Select size="sm" value={item.status||'new'} disabled={preview} onChange={(event)=>updateInquiryStatus(item.id||item._id,event.target.value)} aria-label={`Stage for ${item.name}'s request`}><option value="new">New</option><option value="contacted">Contacted</option><option value="quoted">Quoted</option><option value="accepted">Accepted</option><option value="closed">Closed</option></Form.Select></article>)}{!requests.some(item=>(item.status||'new')===status)&&<span className="request-empty">Nothing here</span>}</section>)}</div></>;
}

function Messages({summary,preview,updateMessageStatus}){
  const messages = summary.messages || [];
  return <><div className="admin-section-head"><div><p className="eyebrow">Studio inbox</p><h2>Contact messages</h2></div></div><div className="admin-panel admin-table-panel">{messages.length?<Table responsive hover className="admin-table"><thead><tr><th>From</th><th>Subject</th><th>Message</th><th>Received</th><th>Status</th></tr></thead><tbody>{messages.map(message=><tr key={message.id||message._id}><td><strong>{message.name}</strong><small>{message.email}</small></td><td>{message.subject||'Studio question'}</td><td className="admin-message-cell">{message.message}</td><td>{message.createdAt?new Date(message.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'—'}</td><td><Form.Select size="sm" value={message.status||'new'} disabled={preview} onChange={(event)=>updateMessageStatus(message.id||message._id,event.target.value)} aria-label={`Status for message from ${message.name}`}><option value="new">New</option><option value="read">Read</option><option value="replied">Replied</option><option value="archived">Archived</option></Form.Select></td></tr>)}</tbody></Table>:<AdminEmpty text="No contact messages yet."/>}</div></>;
}

function Settings(){return <><div className="admin-section-head"><div><p className="eyebrow">Studio controls</p><h2>Settings</h2></div></div><div className="admin-settings"><Alert variant="info" className="soft-alert"><Icon name="shield"/> Operational settings are environment-managed in this release. The values below are shown for reference and cannot be changed here.</Alert><section className="admin-panel"><h3>Order timing</h3><p>Shown to buyers before they send a request.</p><div className="admin-setting-row"><Form.Group><Form.Label>Ready pieces</Form.Label><Form.Control defaultValue="3–10 business days" disabled/></Form.Group><Form.Group><Form.Label>Custom pieces</Form.Label><Form.Control defaultValue="5–15 business days" disabled/></Form.Group></div></section><section className="admin-panel"><h3>First-order offer</h3><p>Eligibility is checked by the server before the final total.</p><div className="admin-setting-row"><Form.Group><Form.Label>Offer code</Form.Label><Form.Control defaultValue="FIRST10" disabled/></Form.Group><Form.Group><Form.Label>Discount</Form.Label><Form.Control defaultValue="10%" disabled/></Form.Group></div></section></div></>}

function AdminEmpty({text}){return <div className="admin-empty"><Icon name="spark"/><p>{text}</p></div>}
