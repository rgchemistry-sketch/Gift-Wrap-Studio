import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Table from 'react-bootstrap/Table';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import AdminSectionState from '../components/admin/AdminSectionState';
import ProductManager from '../components/admin/ProductManager';
import SettingsEditor from '../components/admin/SettingsEditor';
import UsersManager from '../components/admin/UsersManager';
import { api } from '../api/client';
import { demoProducts, formatCurrency, normalizeProduct } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';

const demoSummary = {
  metrics: { ordersPending: 8, activeCustomRequests: 5, monthlyRevenue: 48750, products: 28, registeredUsers: 2 },
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
  ['users', 'user', 'Registered users'],
  ['settings', 'shield', 'Studio settings'],
];

const adminSectionKeys = new Set(adminNav.map(([key]) => key));
const adminSectionLabels = Object.fromEntries(adminNav.map(([key, , label]) => [key, label]));
const sectionErrorKeys = {
  dashboard: 'dashboard',
  products: 'products',
  orders: 'orders',
  requests: 'inquiries',
  messages: 'messages',
};
const sectionDataKeys = {
  products: 'productsList',
  orders: 'recentOrders',
  requests: 'inquiries',
  messages: 'messages',
};

const adminSectionHref = (section) => section === 'dashboard'
  ? '/admin'
  : `/admin?section=${encodeURIComponent(section)}`;

const ADMIN_PAGE_LIMIT = 50;
const attentionOrderStatuses = new Set(['placed', 'confirmed', 'in_progress', 'ready', 'shipped']);

const orderNeedsAttention = (order) => attentionOrderStatuses.has(order?.status || 'placed');

const listFrom = (result, keys = []) => {
  const data = result?.data ?? result;
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
};

const paginationFrom = (result, itemCount = 0) => {
  const data = result?.data;
  const raw = result?.pagination || result?.meta || data?.pagination || data?.meta || {};
  const total = Number(raw.total ?? itemCount);
  const limit = Number(raw.limit ?? ADMIN_PAGE_LIMIT);
  const page = Math.max(1, Number(raw.page || 1));
  const pages = Math.max(1, Number(raw.pages ?? raw.totalPages ?? (Math.ceil(total / limit) || 1)));
  return { page, pages, total, limit };
};

const collectionConfig = {
  orders: { getter: api.getAdminOrders, stateKey: 'recentOrders', listKeys: ['orders', 'items'] },
  inquiries: { getter: api.getAdminInquiries, stateKey: 'inquiries', listKeys: ['inquiries', 'items'] },
  messages: { getter: api.getAdminContacts, stateKey: 'messages', listKeys: ['contacts', 'messages', 'items'] },
};

export default function AdminPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sectionErrors, setSectionErrors] = useState({});
  const [preview, setPreview] = useState(false);
  const [collectionLoading, setCollectionLoading] = useState({});
  const [workingItem, setWorkingItem] = useState('');
  const { user, signOut, setUser, signingOut } = useAuth();
  const { notify } = useShop();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const section = requestedSection && adminSectionKeys.has(requestedSection)
    ? requestedSection
    : 'dashboard';
  const contentRef = useRef(null);
  const previousSectionRef = useRef(section);
  const demoEnabled = import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true';

  const selectSection = useCallback((nextSection) => {
    if (!adminSectionKeys.has(nextSection)) return;
    navigate(adminSectionHref(nextSection));
  }, [navigate]);

  useEffect(() => {
    if (requestedSection && !adminSectionKeys.has(requestedSection)) {
      navigate('/admin', { replace: true });
    }
  }, [navigate, requestedSection]);

  useEffect(() => {
    if (previousSectionRef.current === section) return undefined;
    previousSectionRef.current = section;
    const focusFrame = window.requestAnimationFrame(() => contentRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [section]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    const jobs = [
      ['dashboard', 'overview', api.getAdminSummary()],
      ['products', 'products', api.getAdminProducts()],
      ['orders', 'orders', api.getAdminOrders({ page: 1, limit: ADMIN_PAGE_LIMIT })],
      ['inquiries', 'custom requests', api.getAdminInquiries({ page: 1, limit: ADMIN_PAGE_LIMIT })],
      ['messages', 'messages', api.getAdminContacts({ page: 1, limit: ADMIN_PAGE_LIMIT })],
    ];
    try {
      const settled = await Promise.allSettled(jobs.map(([, , request]) => request));
      const authFailure = settled.find(
        (result) => result.status === 'rejected' && [401, 403].includes(result.reason?.status),
      );
      if (authFailure) {
        setUser(null);
        navigate('/account', { replace: true, state: { deniedFrom: '/admin' } });
        return;
      }

      const fulfilled = {};
      const unavailable = [];
      const nextSectionErrors = {};
      settled.forEach((result, index) => {
        const [key, label] = jobs[index];
        if (result.status === 'fulfilled') fulfilled[key] = result.value;
        else {
          unavailable.push(label);
          nextSectionErrors[key] = result.reason?.message || `${label} could not load.`;
        }
      });
      setSectionErrors(nextSectionErrors);

      if (!Object.keys(fulfilled).length) {
        const message = settled.find((result) => result.status === 'rejected')?.reason?.message
          || 'The admin service did not return any data.';
        setError(message);
        if (demoEnabled) {
          setSummary(demoSummary);
          setPreview(true);
        } else {
          setSummary((current) => current);
          setPreview(false);
        }
        return;
      }

      setSummary((current) => {
        const dashboard = fulfilled.dashboard?.data || fulfilled.dashboard || {};
        const productsList = fulfilled.products
          ? listFrom(fulfilled.products, ['products', 'items'])
          : current?.productsList || [];
        const recentOrders = fulfilled.orders
          ? listFrom(fulfilled.orders, ['orders', 'items'])
          : current?.recentOrders || [];
        const inquiries = fulfilled.inquiries
          ? listFrom(fulfilled.inquiries, ['inquiries', 'items'])
          : current?.inquiries || [];
        const messages = fulfilled.messages
          ? listFrom(fulfilled.messages, ['contacts', 'messages', 'items'])
          : current?.messages || [];
        const orderPagination = fulfilled.orders
          ? paginationFrom(fulfilled.orders, recentOrders.length)
          : current?.pagination?.orders || paginationFrom(null, recentOrders.length);
        const inquiryPagination = fulfilled.inquiries
          ? paginationFrom(fulfilled.inquiries, inquiries.length)
          : current?.pagination?.inquiries || paginationFrom(null, inquiries.length);
        const messagePagination = fulfilled.messages
          ? paginationFrom(fulfilled.messages, messages.length)
          : current?.pagination?.messages || paginationFrom(null, messages.length);
        const currentMetrics = current?.metrics || {};
        const pendingMetric = dashboard.ordersPending ?? dashboard.pendingOrders;
        const pendingLoaded = recentOrders.filter(orderNeedsAttention).length;
        const publishedProducts = productsList.filter((product) => !product.archivedAt && (product.active ?? true)).length;
        const lowStock = productsList.filter((product) => {
          const available = product.stock ?? product.inventory;
          const active = product.active ?? product.inStock ?? true;
          return !product.archivedAt && active && available != null
            && Number.isFinite(Number(available)) && Number(available) <= 3;
        });

        return {
          metrics: {
            products: Number(dashboard.products ?? (fulfilled.products ? publishedProducts : currentMetrics.products ?? publishedProducts)),
            totalOrders: Number(dashboard.orders ?? (fulfilled.orders ? orderPagination.total : currentMetrics.totalOrders ?? orderPagination.total)),
            ordersPending: Number(pendingMetric ?? pendingLoaded),
            ordersPendingPartial: pendingMetric == null && orderPagination.total > recentOrders.length,
            ordersPendingExact: pendingMetric != null,
            activeCustomRequests: Number(dashboard.newInquiries ?? currentMetrics.activeCustomRequests ?? inquiries.filter((item) => (item.status || 'new') === 'new').length),
            newMessages: Number(dashboard.newMessages ?? currentMetrics.newMessages ?? messages.filter((item) => (item.status || 'new') === 'new').length),
            registeredUsers: Number(dashboard.registeredUsers ?? dashboard.buyers ?? currentMetrics.registeredUsers ?? dashboard.users ?? dashboard.userCount ?? 0),
            newUsersThisMonth: Number(dashboard.newUsersThisMonth ?? currentMetrics.newUsersThisMonth ?? 0),
          },
          productsList,
          recentOrders,
          inquiries,
          messages,
          lowStock,
          pagination: {
            orders: orderPagination,
            inquiries: inquiryPagination,
            messages: messagePagination,
          },
        };
      });
      setPreview(false);
      if (unavailable.length) {
        setError(`Some sections could not refresh: ${unavailable.join(', ')}.`);
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [demoEnabled, navigate, setUser]);
  useEffect(()=>{load();},[load]);

  const loadCollection = useCallback(async (kind, page) => {
    const config = collectionConfig[kind];
    if (!config) return;
    setCollectionLoading((current) => ({ ...current, [kind]: true }));
    try {
      const result = await config.getter({ page, limit: ADMIN_PAGE_LIMIT });
      const items = listFrom(result, config.listKeys);
      const pagination = paginationFrom(result, items.length);
      setSectionErrors((current) => ({ ...current, [kind]: '' }));
      setSummary((current) => {
        if (!current) return current;
        const nextMetrics = { ...current.metrics };
        if (kind === 'orders') {
          nextMetrics.totalOrders = pagination.total;
          if (pagination.page === 1 && !nextMetrics.ordersPendingExact) {
            nextMetrics.ordersPending = items.filter(orderNeedsAttention).length;
            nextMetrics.ordersPendingPartial = pagination.total > items.length;
          }
        }
        return {
          ...current,
          metrics: nextMetrics,
          [config.stateKey]: items,
          pagination: { ...current.pagination, [kind]: pagination },
        };
      });
    } catch (requestError) {
      if ([401, 403].includes(requestError.status)) {
        setUser(null);
        navigate('/account', { replace: true, state: { deniedFrom: '/admin' } });
      } else {
        setSectionErrors((current) => ({ ...current, [kind]: requestError.message }));
        notify(requestError.message, 'error');
      }
    } finally {
      setCollectionLoading((current) => ({ ...current, [kind]: false }));
    }
  }, [navigate, notify, setUser]);

  const applyStatusLocally = (stateKey, id, status) => {
    setSummary((current) => {
      if (!current) return current;
      const items = current[stateKey] || [];
      const previous = items.find((item) => String(item.id || item._id) === String(id));
      if (!previous) return current;
      const previousStatus = previous.status || 'new';
      const metrics = { ...current.metrics };
      if (stateKey === 'recentOrders') {
        metrics.ordersPending = Math.max(0, Number(metrics.ordersPending || 0)
          + Number(attentionOrderStatuses.has(status)) - Number(attentionOrderStatuses.has(previousStatus)));
      } else if (stateKey === 'inquiries') {
        metrics.activeCustomRequests = Math.max(0, Number(metrics.activeCustomRequests || 0)
          + Number(status === 'new') - Number(previousStatus === 'new'));
      } else if (stateKey === 'messages') {
        metrics.newMessages = Math.max(0, Number(metrics.newMessages || 0)
          + Number(status === 'new') - Number(previousStatus === 'new'));
      }
      return {
        ...current,
        metrics,
        [stateKey]: items.map((item) => String(item.id || item._id) === String(id) ? { ...item, status } : item),
      };
    });
  };

  const updateStatus = async (orderId,status) => {
    if(preview){notify('Status changes are disabled while viewing preview data.','neutral');return;}
    setWorkingItem(`order:${orderId}`);
    try{await api.updateOrderStatus(orderId,status);applyStatusLocally('recentOrders',orderId,status);notify('Order status updated.');}catch(requestError){notify(requestError.message,'error');}
    finally{setWorkingItem('');}
  };

  const updateInquiryStatus = async (inquiryId,status) => {
    if(preview){notify('Request changes are disabled while viewing preview data.','neutral');return;}
    setWorkingItem(`inquiry:${inquiryId}`);
    try{await api.updateInquiryStatus(inquiryId,status);applyStatusLocally('inquiries',inquiryId,status);notify('Custom request stage updated.');}catch(requestError){notify(requestError.message,'error');}
    finally{setWorkingItem('');}
  };

  const updateMessageStatus = async (contactId,status) => {
    if(preview){notify('Message changes are disabled while viewing preview data.','neutral');return;}
    setWorkingItem(`message:${contactId}`);
    try{await api.updateContactStatus(contactId,status);applyStatusLocally('messages',contactId,status);notify('Message status updated.');}catch(requestError){notify(requestError.message,'error');}
    finally{setWorkingItem('');}
  };

  const activeErrorKey = sectionErrorKeys[section];
  const activeSectionError = activeErrorKey ? sectionErrors[activeErrorKey] : '';
  const activeDataKey = sectionDataKeys[section];
  const activeSectionHasData = activeDataKey
    ? Boolean(summary?.[activeDataKey]?.length)
    : true;
  const activeSectionUnavailable = Boolean(activeSectionError && activeDataKey && !activeSectionHasData);
  const activeSectionLabel = adminSectionLabels[section] || 'Admin section';
  const adminName = user?.name || 'Studio administrator';
  const adminEmail = user?.email || 'Administrator account';
  const adminInitial = String(user?.name || user?.email || 'A').charAt(0).toUpperCase();

  return <section className="admin-page">
    <Container fluid="xl">
      <header className="admin-topbar">
        <div><p className="eyebrow">Gift N Wrap Studio</p><h1>Studio desk</h1></div>
        <div className="admin-topbar__actions">
          <span className="admin-workspace-state"><span className="admin-live-dot" aria-hidden="true"/><span>{preview ? 'Preview data' : 'Live workspace'}</span></span>
          <Button as={Link} to="/" variant="outline-dark" size="sm">Storefront</Button>
          <Button as={Link} to="/account" variant="outline-dark" size="sm">My account</Button>
          <Button variant="dark" size="sm" disabled={signingOut} onClick={async()=>{try{await signOut();navigate('/');}catch(requestError){notify(requestError.message,'error');}}}>{signingOut?'Signing out…':'Sign out'}</Button>
          <span className="admin-identity" title={adminEmail}>
            <span className="admin-avatar" aria-hidden="true">{adminInitial}</span>
            <span className="admin-identity__copy"><strong>{adminName}</strong><small>{adminEmail}</small></span>
          </span>
        </div>
      </header>
      {preview&&<Alert variant="warning" className="soft-alert admin-preview-alert"><strong>Studio preview:</strong> {error} Changes are disabled until the admin service reconnects. <button type="button" className="plain-link" onClick={load}>Retry</button></Alert>}
      {!preview&&summary&&error&&<Alert variant="warning" className="soft-alert admin-preview-alert"><strong>Partial workspace:</strong> {error} The available sections remain usable. <button type="button" className="plain-link" onClick={()=>load({quiet:true})}>Retry missing data</button></Alert>}
      <div className="admin-layout">
        <aside className="admin-sidebar"><nav aria-label="Admin sections">{adminNav.map(([key,icon,label])=>{const pending=Number(summary?.metrics?.ordersPending??summary?.counts?.pendingOrders??0);const partial=Boolean(summary?.metrics?.ordersPendingPartial);return <Link to={adminSectionHref(key)} key={key} className={section===key?'is-active':''} aria-current={section===key?'page':undefined}><Icon name={icon}/><span>{label}</span>{key==='orders'&&pending>0&&<Badge pill title={partial?'Count from the latest loaded orders':'Orders needing attention'} aria-label={`${pending} orders needing attention${partial?' in the latest loaded page':''}`}>{pending}{partial?'*':''}</Badge>}</Link>;})}</nav><div className="admin-sidebar__note"><Icon name="shield"/><p><strong>Admin protected</strong><small>Role checks are also enforced by the server.</small></p></div></aside>
        <div ref={contentRef} className="admin-content" tabIndex={-1} aria-label={`${activeSectionLabel} admin section`}>
          {loading?<div className="account-loading" role="status" aria-live="polite"><Spinner aria-hidden="true"/><span>Opening the studio desk…</span></div>:!summary?<Alert variant="danger" className="soft-alert"><strong>The live admin workspace could not load.</strong> {error} <button type="button" className="plain-link" onClick={load}>Retry</button></Alert>:activeSectionUnavailable?<><div className="admin-section-head"><div><p className="eyebrow">Temporarily unavailable</p><h2>{activeSectionLabel}</h2></div></div><AdminSectionState title={`${activeSectionLabel} could not load`} message={activeSectionError} actionLabel="Try again" onAction={()=>load({quiet:true})}/></>:<>
            {activeSectionError&&<Alert variant="warning" className="soft-alert admin-section-alert"><strong>{activeSectionLabel} may be out of date.</strong> {activeSectionError} <button type="button" className="plain-link" onClick={()=>load({quiet:true})}>Retry this section</button></Alert>}
            {section==='dashboard'&&<Dashboard summary={summary} setSection={selectSection}/>}
            {section==='orders'&&<Orders summary={summary} preview={preview} updateStatus={updateStatus} loading={collectionLoading.orders} workingItem={workingItem} onPageChange={(page)=>loadCollection('orders',page)}/>}
            {section==='products'&&<ProductManager products={summary.productsList} preview={preview} notify={notify} onRefresh={()=>load({quiet:true})}/>}
            {section==='requests'&&<Requests summary={summary} preview={preview} updateInquiryStatus={updateInquiryStatus} loading={collectionLoading.inquiries} workingItem={workingItem} onPageChange={(page)=>loadCollection('inquiries',page)}/>}
            {section==='messages'&&<Messages summary={summary} preview={preview} updateMessageStatus={updateMessageStatus} loading={collectionLoading.messages} workingItem={workingItem} onPageChange={(page)=>loadCollection('messages',page)}/>}
            {section==='users'&&<UsersManager dashboardMetrics={summary.metrics}/>}
            {section==='settings'&&<SettingsEditor preview={preview} notify={notify}/>}
          </>}
        </div>
      </div>
    </Container>
  </section>;
}

function Dashboard({summary,setSection}){
  const metrics=summary.metrics||summary.counts||{};
  const attentionOrders=(summary.recentOrders||summary.orders||[]).filter(orderNeedsAttention);
  const lowStock=summary.lowStock||summary.lowStockProducts||[];
  const cards=[['Total orders',metrics.totalOrders??metrics.ordersPending??metrics.pendingOrders??0,'package','orders'],['New custom requests',metrics.activeCustomRequests??metrics.inquiries??0,'heart','requests'],['New messages',metrics.newMessages??0,'mail','messages'],['Published pieces',metrics.products??metrics.productCount??0,'bag','products'],['Registered users',metrics.registeredUsers??metrics.users??metrics.userCount??0,'user','users']];
  return <><div className="admin-section-head"><div><p className="eyebrow">Today in the studio</p><h2>Overview</h2></div><span>{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}</span></div><div className="admin-metrics">{cards.map(([label,value,icon,target])=><button type="button" onClick={()=>setSection(target)} key={label} aria-label={`${label}: ${value}`}><span><Icon name={icon}/></span><p><small>{label}</small><strong>{value}</strong></p><Icon name="arrow"/></button>)}</div><div className="admin-dashboard-grid"><div className="admin-panel"><div className="admin-panel__head"><div><p className="eyebrow">Recent activity</p><h3>Orders needing attention</h3></div><button type="button" className="plain-link" onClick={()=>setSection('orders')}>Open orders</button></div><MiniOrders orders={attentionOrders}/></div><div className="admin-panel"><div className="admin-panel__head"><div><p className="eyebrow">Inventory</p><h3>Low stock pieces</h3></div><button type="button" className="plain-link" onClick={()=>setSection('products')}>Manage</button></div>{lowStock.length?<div className="low-stock-list">{lowStock.slice(0,4).map(raw=>{const product=normalizeProduct(raw);return <div key={product.id}><SmartImage src={product.image} alt="" fallbackLabel={product.category}/><p><strong>{product.title}</strong><small>{raw.stock??raw.inventory??0} remaining</small></p><span>{raw.stock??raw.inventory??0}</span></div>})}</div>:<AdminEmpty text="No published pieces are low in stock."/>}</div></div></>;
}

function MiniOrders({orders}){if(!orders.length)return <AdminEmpty text="No orders need attention right now."/>;return <div className="mini-orders">{orders.slice(0,5).map(order=><div key={order.id||order._id||order.orderNumber}><span className={`order-status status-${order.status}`}>{String(order.status||'placed').replaceAll('_',' ')}</span><p><strong>{order.orderNumber||String(order.id||order._id).slice(-6)}</strong><small>{order.buyerName||order.customer?.name||order.user?.name||order.buyerEmail||'Buyer'} · {order.items?.[0]?.name||order.items?.[0]?.product?.title||'Studio piece'}</small></p><b>{order.total?formatCurrency(order.total):'Review'}</b></div>)}</div>}

function Orders({summary,preview,updateStatus,loading,workingItem,onPageChange}){
  const [query, setQuery] = useState('');
  const orders=summary.recentOrders||summary.orders||[];
  const pagination=summary.pagination?.orders||paginationFrom(null,orders.length);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOrders = normalizedQuery
    ? orders.filter((order) => `${order.orderNumber || ''} ${order.buyerName || ''} ${order.buyerEmail || ''} ${order.customer?.name || ''} ${order.items?.map((item) => item.name || item.product?.title || '').join(' ') || ''}`.toLowerCase().includes(normalizedQuery))
    : orders;
  return <><div className="admin-section-head"><div><p className="eyebrow">Fulfilment</p><h2>Orders</h2><p className="admin-section-copy">Search applies to the {orders.length} orders on this page.</p></div><div className="admin-search"><Icon name="search"/><input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search this page" aria-label="Search orders on this page"/></div></div><div className="admin-panel admin-table-panel" aria-busy={loading}>{filteredOrders.length?<Table responsive hover className="admin-table"><thead><tr><th>Order</th><th>Buyer</th><th>Placed</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredOrders.map(order=>{const id=order.id||order._id;return <tr key={id||order.orderNumber}><td><strong>{order.orderNumber||String(id).slice(-6).toUpperCase()}</strong><small>{order.items?.length||0} pieces</small></td><td>{order.buyerName||order.customer?.name||order.user?.name||order.buyerEmail||'Buyer'}</td><td>{order.createdAt?new Date(order.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'—'}</td><td>{order.total!=null?formatCurrency(order.total):'Pending'}</td><td><Form.Select size="sm" value={order.status||'placed'} disabled={preview||loading||workingItem===`order:${id}`} onChange={event=>updateStatus(id,event.target.value)} aria-label={`Status for ${order.orderNumber||'order'}`}><option value="placed">Placed</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="ready">Ready</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></Form.Select></td></tr>})}</tbody></Table>:<AdminEmpty text={query?'No orders on this page match that search.':'No orders have been placed yet.'}/>}<AdminPager pagination={pagination} visibleCount={filteredOrders.length} filtered={Boolean(normalizedQuery)} noun="orders" loading={loading} onPageChange={onPageChange}/></div></>;
}

function _LegacyProducts({summary}){
  const rawProducts = Array.isArray(summary.productsList) ? summary.productsList : Array.isArray(summary.lowStock) ? summary.lowStock : demoProducts;
  const products=rawProducts.slice(0,12).map(normalizeProduct);
  return <><div className="admin-section-head"><div><p className="eyebrow">Catalogue</p><h2>Products</h2></div><span className="admin-readonly-note"><Icon name="lock" size={14}/> Catalogue editing is API-managed in this release</span></div><div className="admin-product-grid">{products.map(product=><article key={product.id}><SmartImage src={product.image} alt="" fallbackLabel={product.category}/><div><span className={product.inStock?'in-stock':'out-stock'}>{product.inStock?'Published':'Unavailable'}</span><h3>{product.title}</h3><p>{product.category} · {formatCurrency(product.price)}</p><span className="admin-item-readonly">Read-only overview</span></div></article>)}</div></>;
}

function Requests({summary,preview,updateInquiryStatus,loading,workingItem,onPageChange}){
  const requests=summary.inquiries||summary.customRequests||[];
  const pagination=summary.pagination?.inquiries||paginationFrom(null,requests.length);
  return <><div className="admin-section-head"><div><p className="eyebrow">Bespoke work</p><h2>Custom requests</h2><p className="admin-section-copy">Board counts reflect the current page of requests.</p></div></div><div className="request-board" aria-busy={loading}>{['new','contacted','quoted','accepted','closed'].map(status=><section key={status}><h3>{status==='new'?'New ideas':status==='contacted'?'Contacted':status==='quoted'?'Quoted':status==='accepted'?'Accepted':'Closed'} <span>{requests.filter(item=>(item.status||'new')===status).length}</span></h3>{requests.filter(item=>(item.status||'new')===status).map(item=>{const id=item.id||item._id;return <article key={id}><p className="eyebrow">{item.productType||item.category||'Custom piece'}</p><h4>{item.name}</h4><p>{item.description||item.idea||'Open brief'}</p><small>{item.budget||'Budget to discuss'}</small><Form.Select size="sm" value={item.status||'new'} disabled={preview||loading||workingItem===`inquiry:${id}`} onChange={(event)=>updateInquiryStatus(id,event.target.value)} aria-label={`Stage for ${item.name}'s request`}><option value="new">New</option><option value="contacted">Contacted</option><option value="quoted">Quoted</option><option value="accepted">Accepted</option><option value="closed">Closed</option></Form.Select></article>})}{!requests.some(item=>(item.status||'new')===status)&&<span className="request-empty">Nothing here</span>}</section>)}</div><AdminPager pagination={pagination} visibleCount={requests.length} noun="requests" loading={loading} onPageChange={onPageChange}/></>;
}

function Messages({summary,preview,updateMessageStatus,loading,workingItem,onPageChange}){
  const messages = summary.messages || [];
  const pagination=summary.pagination?.messages||paginationFrom(null,messages.length);
  return <><div className="admin-section-head"><div><p className="eyebrow">Studio inbox</p><h2>Contact messages</h2><p className="admin-section-copy">Reviewing up to {pagination.limit} messages per page.</p></div></div><div className="admin-panel admin-table-panel" aria-busy={loading}>{messages.length?<Table responsive hover className="admin-table"><thead><tr><th>From</th><th>Subject</th><th>Message</th><th>Received</th><th>Status</th></tr></thead><tbody>{messages.map(message=>{const id=message.id||message._id;return <tr key={id}><td><strong>{message.name}</strong><small>{message.email}</small></td><td>{message.subject||'Studio question'}</td><td className="admin-message-cell" title={message.message}>{message.message}</td><td>{message.createdAt?new Date(message.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'—'}</td><td><Form.Select size="sm" value={message.status||'new'} disabled={preview||loading||workingItem===`message:${id}`} onChange={(event)=>updateMessageStatus(id,event.target.value)} aria-label={`Status for message from ${message.name}`}><option value="new">New</option><option value="read">Read</option><option value="replied">Replied</option><option value="archived">Archived</option></Form.Select></td></tr>})}</tbody></Table>:<AdminEmpty text="No contact messages yet."/>}<AdminPager pagination={pagination} visibleCount={messages.length} noun="messages" loading={loading} onPageChange={onPageChange}/></div></>;
}

function AdminPager({pagination,visibleCount,filtered=false,noun,loading,onPageChange}){
  const page=Math.max(1,Number(pagination?.page||1));
  const pages=Math.max(1,Number(pagination?.pages||pagination?.totalPages||1));
  const total=Math.max(0,Number(pagination?.total??visibleCount??0));
  const limit=Math.max(1,Number(pagination?.limit||ADMIN_PAGE_LIMIT));
  const first=total?(page-1)*limit+1:0;
  const last=Math.min(total,(page-1)*limit+Number(visibleCount||0));
  const countLabel=filtered?`${visibleCount} matching on this page · ${total} total ${noun}`:`Showing ${first}–${last} of ${total} ${noun}`;
  return <footer className="users-pagination admin-collection-pagination"><span>{loading?'Loading page…':countLabel}</span><div><Button type="button" size="sm" variant="outline-dark" disabled={loading||page<=1} onClick={()=>onPageChange(page-1)}>Previous</Button><span>Page {page} of {pages}</span><Button type="button" size="sm" variant="outline-dark" disabled={loading||page>=pages} onClick={()=>onPageChange(page+1)}>Next</Button></div></footer>;
}

function AdminEmpty({text}){return <div className="admin-empty"><Icon name="spark"/><p>{text}</p></div>}
