import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Dropdown from 'react-bootstrap/Dropdown';
import Table from 'react-bootstrap/Table';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import AdminSectionState from '../components/admin/AdminSectionState';
import AdminStatusDropdown from '../components/admin/AdminStatusDropdown';
import { formatCurrency, normalizeProduct } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { optimizeCloudinaryImage } from '../utils/cloudinary-image';
import '../admin.css';

const importProductManager = () => import('../components/admin/ProductManager');
const ProductManager = lazy(importProductManager);
const SettingsEditor = lazy(() => import('../components/admin/SettingsEditor'));
const UsersManager = lazy(() => import('../components/admin/UsersManager'));

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
const ADMIN_PAGE_LIMIT = 50;
const PRODUCT_PAGE_LIMIT = 12;
const attentionOrderStatuses = new Set(['placed', 'confirmed', 'in_progress', 'ready', 'shipped']);

const orderStatusOptions = [
  { value: 'placed', label: 'Placed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'ready', label: 'Ready' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const inquiryStatusOptions = [
  { value: 'new', label: 'New idea' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'closed', label: 'Closed' },
];

const messageStatusOptions = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
];

const demoSummary = {
  metrics: {
    ordersPending: 2,
    totalOrders: 2,
    activeCustomRequests: 1,
    newMessages: 1,
    products: 28,
    registeredUsers: 2,
  },
  attentionOrders: [
    { id: 'preview-1', orderNumber: 'GNW-PREVIEW-01', buyerName: 'Preview buyer', status: 'placed', total: 2199, createdAt: new Date().toISOString(), items: [{ name: 'Memory Photo Frame' }] },
    { id: 'preview-2', orderNumber: 'GNW-PREVIEW-02', buyerName: 'Preview buyer', status: 'in_progress', total: 4299, createdAt: new Date(Date.now() - 86400000).toISOString(), items: [{ name: 'Geode Wall Clock' }] },
  ],
  recentOrders: [],
  productsList: [],
  lowStock: [],
  inquiries: [],
  messages: [],
};

const initialSummary = () => ({
  metrics: {},
  attentionOrders: [],
  recentOrders: [],
  productsList: [],
  lowStock: [],
  inquiries: [],
  messages: [],
  pagination: {
    products: { page: 1, pages: 1, total: 0, limit: PRODUCT_PAGE_LIMIT },
    orders: { page: 1, pages: 1, total: 0, limit: ADMIN_PAGE_LIMIT },
    inquiries: { page: 1, pages: 1, total: 0, limit: ADMIN_PAGE_LIMIT },
    messages: { page: 1, pages: 1, total: 0, limit: ADMIN_PAGE_LIMIT },
  },
});

const initialSectionState = {
  products: { loading: false, loaded: false, loadedAt: 0, error: '' },
  orders: { loading: false, loaded: false, loadedAt: 0, error: '' },
  requests: { loading: false, loaded: false, loadedAt: 0, error: '' },
  messages: { loading: false, loaded: false, loadedAt: 0, error: '' },
};

const sectionConfig = {
  products: {
    getter: (params) => api.getAdminProducts(params),
    stateKey: 'productsList',
    listKeys: ['products', 'items'],
    paginationKey: 'products',
    pageLimit: PRODUCT_PAGE_LIMIT,
  },
  orders: {
    getter: (params) => api.getAdminOrders(params),
    stateKey: 'recentOrders',
    listKeys: ['orders', 'items'],
    paginationKey: 'orders',
  },
  requests: {
    getter: (params) => api.getAdminInquiries(params),
    stateKey: 'inquiries',
    listKeys: ['inquiries', 'items'],
    paginationKey: 'inquiries',
  },
  messages: {
    getter: (params) => api.getAdminContacts(params),
    stateKey: 'messages',
    listKeys: ['contacts', 'messages', 'items'],
    paginationKey: 'messages',
  },
};

const adminSectionHref = (section) => section === 'dashboard'
  ? '/admin'
  : `/admin?section=${encodeURIComponent(section)}`;

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
  const limit = Math.max(1, Number(raw.limit ?? ADMIN_PAGE_LIMIT));
  const page = Math.max(1, Number(raw.page || 1));
  const pages = Math.max(1, Number(raw.pages ?? raw.totalPages ?? (Math.ceil(total / limit) || 1)));
  return { page, pages, total, limit };
};

const metricValue = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export default function AdminPage() {
  const [summary, setSummary] = useState(initialSummary);
  const [productQuery, setProductQuery] = useState({ q: '', status: 'current', page: 1 });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [sectionState, setSectionState] = useState(initialSectionState);
  const [preview, setPreview] = useState(false);
  const [workingItems, setWorkingItems] = useState({});
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const { user, signOut, setUser, signingOut } = useAuth();
  const { notify, applyStudioSettings } = useShop();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const section = requestedSection && adminSectionKeys.has(requestedSection)
    ? requestedSection
    : 'dashboard';
  const contentRef = useRef(null);
  const previousSectionRef = useRef(section);
  const dashboardRequestRef = useRef(0);
  const sectionRequestRef = useRef({});
  const productQueryRef = useRef(productQuery);
  const demoEnabled = import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true';

  const selectSection = useCallback((nextSection) => {
    if (adminSectionKeys.has(nextSection)) navigate(adminSectionHref(nextSection));
  }, [navigate]);

  const handleAuthorizationFailure = useCallback((requestError) => {
    if (![401, 403].includes(requestError?.status)) return false;
    setUser(null);
    navigate('/account', { replace: true, state: { deniedFrom: '/admin' } });
    return true;
  }, [navigate, setUser]);

  useEffect(() => {
    if (requestedSection && !adminSectionKeys.has(requestedSection)) {
      navigate('/admin', { replace: true });
    }
  }, [navigate, requestedSection]);

  useEffect(() => {
    if (previousSectionRef.current === section) return undefined;
    previousSectionRef.current = section;
    const focusFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      contentRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [section]);

  const loadDashboard = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++dashboardRequestRef.current;
    if (!quiet) setDashboardLoading(true);
    setDashboardError('');
    try {
      const result = await api.getAdminSummary();
      if (requestId !== dashboardRequestRef.current) return;
      const dashboard = result?.data || result || {};
      setSummary((current) => ({
        ...current,
        metrics: {
          ...current.metrics,
          products: metricValue(dashboard.products),
          totalOrders: metricValue(dashboard.orders ?? dashboard.totalOrders),
          ordersPending: metricValue(dashboard.ordersPending ?? dashboard.pendingOrders),
          ordersPendingExact: true,
          ordersPendingPartial: false,
          activeCustomRequests: metricValue(dashboard.newInquiries ?? dashboard.activeCustomRequests),
          newMessages: metricValue(dashboard.newMessages),
          registeredUsers: metricValue(dashboard.registeredUsers ?? dashboard.buyers ?? dashboard.users),
          newUsersThisMonth: metricValue(dashboard.newUsersThisMonth),
        },
        attentionOrders: Array.isArray(dashboard.recentOrders) ? dashboard.recentOrders : [],
        lowStock: Array.isArray(dashboard.lowStock) ? dashboard.lowStock : [],
      }));
      setDashboardReady(true);
      setPreview(false);
      setLastSyncedAt(new Date());
    } catch (requestError) {
      if (requestId !== dashboardRequestRef.current || handleAuthorizationFailure(requestError)) return;
      setDashboardError(requestError.message || 'The overview could not load.');
      if (demoEnabled) {
        setSummary((current) => ({
          ...current,
          metrics: demoSummary.metrics,
          attentionOrders: demoSummary.attentionOrders,
          lowStock: demoSummary.lowStock,
        }));
        setDashboardReady(true);
        setPreview(true);
      }
    } finally {
      if (requestId === dashboardRequestRef.current) setDashboardLoading(false);
    }
  }, [demoEnabled, handleAuthorizationFailure]);

  const loadSection = useCallback(async function loadAdminSection(sectionName, options = {}) {
    const config = sectionConfig[sectionName];
    if (!config) return;
    const page = Math.max(1, Number(options.page || 1));
    const limit = config.pageLimit || ADMIN_PAGE_LIMIT;
    const requestId = (sectionRequestRef.current[sectionName] || 0) + 1;
    sectionRequestRef.current[sectionName] = requestId;
    setSectionState((current) => ({
      ...current,
      [sectionName]: { ...current[sectionName], loading: true, error: '' },
    }));
    try {
      const result = await config.getter({ ...options, page, limit });
      if (sectionRequestRef.current[sectionName] !== requestId) return;
      const items = listFrom(result, config.listKeys);
      const pagination = paginationFrom(result, items.length);
      if (sectionName === 'products' && !items.length && page > pagination.pages) {
        const nextQuery = { ...options, page: pagination.pages };
        productQueryRef.current = nextQuery;
        setProductQuery(nextQuery);
        return loadAdminSection(sectionName, nextQuery);
      }
      setSummary((current) => {
        const nextMetrics = { ...current.metrics };
        if (sectionName === 'orders') nextMetrics.totalOrders = pagination.total;
        return {
          ...current,
          metrics: nextMetrics,
          [config.stateKey]: items,
          pagination: config.paginationKey
            ? { ...current.pagination, [config.paginationKey]: pagination }
            : current.pagination,
        };
      });
      setSectionState((current) => ({
        ...current,
        [sectionName]: { loading: false, loaded: true, loadedAt: Date.now(), error: '' },
      }));
      return { items, pagination };
    } catch (requestError) {
      if (sectionRequestRef.current[sectionName] !== requestId || handleAuthorizationFailure(requestError)) return;
      setSectionState((current) => ({
        ...current,
        [sectionName]: {
          ...current[sectionName],
          loading: false,
          error: requestError.message || `${adminSectionLabels[sectionName]} could not load.`,
        },
      }));
    }
  }, [handleAuthorizationFailure]);

  const requestProducts = useCallback((changes = {}) => {
    const nextQuery = {
      ...productQueryRef.current,
      ...changes,
      page: Math.max(1, Number(changes.page ?? productQueryRef.current.page ?? 1)),
    };
    productQueryRef.current = nextQuery;
    setProductQuery(nextQuery);
    return loadSection('products', nextQuery);
  }, [loadSection]);

  useEffect(() => {
    if (section === 'dashboard') {
      void loadDashboard();
      return undefined;
    }
    if (dashboardReady) return undefined;

    // Let a directly opened collection fetch its rows first. The overview metrics are useful
    // navigation context, but they should not compete with the section the administrator asked for.
    const deferredDashboard = window.setTimeout(() => {
      void loadDashboard({ quiet: true });
    }, 900);
    return () => window.clearTimeout(deferredDashboard);
  }, [dashboardReady, loadDashboard, section]);

  const activeCollectionState = sectionState[section];
  useEffect(() => {
    if (section === 'products') void importProductManager();
    if (
      !sectionConfig[section]
      || activeCollectionState?.loading
      || activeCollectionState?.error
    ) return;
    const isStale = !activeCollectionState?.loaded
      || Date.now() - Number(activeCollectionState.loadedAt || 0) > 30_000;
    if (!isStale) return;
    const paginationKey = sectionConfig[section].paginationKey;
    const page = paginationKey ? summary.pagination?.[paginationKey]?.page || 1 : 1;
    loadSection(section, section === 'products' ? productQueryRef.current : { page });
  }, [
    activeCollectionState?.error,
    activeCollectionState?.loaded,
    activeCollectionState?.loadedAt,
    activeCollectionState?.loading,
    loadSection,
    section,
    summary.pagination,
  ]);

  const applyStatusLocally = (stateKey, id, status) => {
    setSummary((current) => {
      const items = current[stateKey] || [];
      const previous = items.find((item) => String(item.id || item._id) === String(id));
      if (!previous) return current;
      const previousStatus = previous.status || 'new';
      const updated = { ...previous, status };
      const metrics = { ...current.metrics };
      let attentionOrders = current.attentionOrders;

      if (stateKey === 'recentOrders') {
        metrics.ordersPending = Math.max(
          0,
          Number(metrics.ordersPending || 0)
            + Number(attentionOrderStatuses.has(status))
            - Number(attentionOrderStatuses.has(previousStatus)),
        );
        const alreadyListed = attentionOrders.some(
          (order) => String(order.id || order._id) === String(id),
        );
        if (attentionOrderStatuses.has(status)) {
          attentionOrders = alreadyListed
            ? attentionOrders.map((order) => String(order.id || order._id) === String(id) ? updated : order)
            : [updated, ...attentionOrders].slice(0, 5);
        } else {
          attentionOrders = attentionOrders.filter(
            (order) => String(order.id || order._id) !== String(id),
          );
        }
      } else if (stateKey === 'inquiries') {
        metrics.activeCustomRequests = Math.max(
          0,
          Number(metrics.activeCustomRequests || 0)
            + Number(status === 'new')
            - Number(previousStatus === 'new'),
        );
      } else if (stateKey === 'messages') {
        metrics.newMessages = Math.max(
          0,
          Number(metrics.newMessages || 0)
            + Number(status === 'new')
            - Number(previousStatus === 'new'),
        );
      }

      return {
        ...current,
        metrics,
        attentionOrders,
        [stateKey]: items.map((item) => String(item.id || item._id) === String(id) ? updated : item),
      };
    });
  };

  const markWorking = (key, working) => {
    setWorkingItems((current) => {
      if (working) return { ...current, [key]: true };
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const updateStatus = async (orderId, status) => {
    const workingKey = `order:${orderId}`;
    markWorking(workingKey, true);
    try {
      await api.updateOrderStatus(orderId, status);
      applyStatusLocally('recentOrders', orderId, status);
      notify('Order status updated.');
      void loadDashboard({ quiet: true });
    } catch (requestError) {
      notify(requestError.message, 'error');
    } finally {
      markWorking(workingKey, false);
    }
  };

  const updateInquiryStatus = async (inquiryId, status) => {
    const workingKey = `inquiry:${inquiryId}`;
    markWorking(workingKey, true);
    try {
      await api.updateInquiryStatus(inquiryId, status);
      applyStatusLocally('inquiries', inquiryId, status);
      notify('Custom request stage updated.');
      void loadDashboard({ quiet: true });
    } catch (requestError) {
      notify(requestError.message, 'error');
    } finally {
      markWorking(workingKey, false);
    }
  };

  const updateMessageStatus = async (contactId, status) => {
    const workingKey = `message:${contactId}`;
    markWorking(workingKey, true);
    try {
      await api.updateContactStatus(contactId, status);
      applyStatusLocally('messages', contactId, status);
      notify('Message status updated.');
      void loadDashboard({ quiet: true });
    } catch (requestError) {
      notify(requestError.message, 'error');
    } finally {
      markWorking(workingKey, false);
    }
  };

  const refreshProducts = useCallback(async () => {
    await loadSection('products', productQueryRef.current);
    void loadDashboard({ quiet: true });
  }, [loadDashboard, loadSection]);

  const retryActiveSection = () => {
    if (section === 'dashboard') {
      loadDashboard();
      return;
    }
    const config = sectionConfig[section];
    if (!config) return;
    const page = config.paginationKey ? summary.pagination?.[config.paginationKey]?.page || 1 : 1;
    loadSection(section, section === 'products' ? productQueryRef.current : { page });
  };

  const signOutAdmin = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (requestError) {
      notify(requestError.message, 'error');
    }
  };

  const activeSectionLabel = adminSectionLabels[section] || 'Admin section';
  const adminName = user?.name || 'Studio administrator';
  const adminEmail = user?.email || 'Administrator account';
  const adminInitial = String(user?.name || user?.email || 'A').charAt(0).toUpperCase();
  const ordersPending = Number(summary.metrics?.ordersPending || 0);
  const workspaceLabel = dashboardLoading && !dashboardReady
    ? 'Syncing workspace'
    : dashboardError && !dashboardReady
      ? 'Connection issue'
      : preview
        ? 'Preview data'
        : 'Live workspace';

  return (
    <section className="admin-page">
      <Container fluid="xl" className="admin-page__container">
        <header className="admin-topbar">
          <div className="admin-topbar__brand">
            <span className="admin-brand-mark" aria-hidden="true">G<span>·</span>W</span>
            <div><p className="eyebrow">Gift N Wrap Studio</p><h1>Studio desk</h1></div>
          </div>
          <div className="admin-topbar__actions">
            <span className={`admin-workspace-state ${dashboardError && !dashboardReady ? 'has-error' : ''}`}>
              <span className="admin-live-dot" aria-hidden="true" />
              <span>{workspaceLabel}</span>
              {lastSyncedAt && !dashboardLoading && <small>Synced {lastSyncedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small>}
            </span>
            <Link to="/" className="btn btn-outline-dark btn-sm admin-storefront-link">
              Storefront <Icon name="arrow" size={14} />
            </Link>
            <Dropdown align="end" className="admin-account-dropdown">
              <Dropdown.Toggle
                id="admin-account-menu"
                className="admin-account-dropdown__toggle"
                aria-label={`${adminName} account menu`}
              >
                <span className="admin-avatar" aria-hidden="true">{adminInitial}</span>
                <span className="admin-identity__copy"><strong>{adminName}</strong><small>{adminEmail}</small></span>
                <Icon name="arrow" size={14} />
              </Dropdown.Toggle>
              <Dropdown.Menu className="admin-account-dropdown__menu">
                <div className="admin-account-dropdown__label">Workspace</div>
                <Dropdown.Item as={Link} to="/account"><Icon name="user" size={16} /> My account</Dropdown.Item>
                <Dropdown.Item as={Link} to="/"><Icon name="bag" size={16} /> Open storefront</Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item onClick={signOutAdmin} disabled={signingOut} className="is-danger">
                  <Icon name="close" size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </header>

        {preview && (
          <Alert variant="warning" className="soft-alert admin-preview-alert">
            <strong>Overview preview:</strong> {dashboardError} Live admin sections remain available.{' '}
            <button type="button" className="plain-link" onClick={() => loadDashboard()}>Retry</button>
          </Alert>
        )}

        <Dropdown className="admin-section-switcher">
          <Dropdown.Toggle id="admin-section-switcher" className="admin-section-switcher__toggle">
            <span><Icon name={adminNav.find(([key]) => key === section)?.[1] || 'spark'} /></span>
            <span><small>Viewing</small><strong>{activeSectionLabel}</strong></span>
            <Icon name="arrow" size={15} />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {adminNav.map(([key, icon, label]) => (
              <Dropdown.Item
                as={Link}
                to={adminSectionHref(key)}
                key={key}
                active={section === key}
                aria-current={section === key ? 'page' : undefined}
              >
                <Icon name={icon} size={17} />
                <span>{label}</span>
                {key === 'orders' && ordersPending > 0 && <Badge pill>{ordersPending}</Badge>}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>

        <div className="admin-layout">
          <aside className="admin-sidebar">
            <nav aria-label="Admin sections">
              {adminNav.map(([key, icon, label]) => (
                <Link to={adminSectionHref(key)} key={key} className={section === key ? 'is-active' : ''} aria-current={section === key ? 'page' : undefined}>
                  <Icon name={icon} />
                  <span>{label}</span>
                  {key === 'orders' && ordersPending > 0 && <Badge pill aria-label={`${ordersPending} orders needing attention`}>{ordersPending}</Badge>}
                </Link>
              ))}
            </nav>
            <div className="admin-sidebar__note">
              <Icon name="shield" />
              <p><strong>Protected workspace</strong><small>Every action is verified against your administrator role.</small></p>
            </div>
          </aside>

          <div ref={contentRef} className="admin-content" tabIndex={-1} aria-label={`${activeSectionLabel} admin section`}>
            {section === 'dashboard' ? (
              dashboardLoading && !dashboardReady ? (
                <DashboardSkeleton />
              ) : dashboardError && !dashboardReady ? (
                <>
                  <SectionHeading eyebrow="Workspace offline" title="Overview" />
                  <AdminSectionState title="The studio overview could not load" message={dashboardError} actionLabel="Try again" onAction={() => loadDashboard()} />
                </>
              ) : (
                <>
                  {dashboardError && !preview && <Alert variant="warning" className="soft-alert admin-section-alert"><strong>The overview may be out of date.</strong> {dashboardError}{' '}<button type="button" className="plain-link" onClick={() => loadDashboard({ quiet: true })}>Retry</button></Alert>}
                  <Dashboard summary={summary} setSection={selectSection} />
                </>
              )
            ) : sectionConfig[section] && activeCollectionState?.loading && !activeCollectionState.loaded ? (
              <>
                <SectionHeading eyebrow="Loading workspace" title={activeSectionLabel} />
                <AdminSectionState loading title={`Opening ${activeSectionLabel.toLowerCase()}`} message="Fetching only the records this section needs…" />
              </>
            ) : sectionConfig[section] && activeCollectionState?.error && !activeCollectionState.loaded ? (
              <>
                <SectionHeading eyebrow="Temporarily unavailable" title={activeSectionLabel} />
                <AdminSectionState title={`${activeSectionLabel} could not load`} message={activeCollectionState.error} actionLabel="Try again" onAction={retryActiveSection} />
              </>
            ) : (
              <>
                {activeCollectionState?.error && <Alert variant="warning" className="soft-alert admin-section-alert"><strong>{activeSectionLabel} may be out of date.</strong> {activeCollectionState.error}{' '}<button type="button" className="plain-link" onClick={retryActiveSection}>Retry</button></Alert>}
                {section === 'orders' && <Orders summary={summary} preview={false} updateStatus={updateStatus} loading={activeCollectionState.loading} workingItems={workingItems} onPageChange={(page) => loadSection('orders', { page })} />}
                {section === 'products' && <Suspense fallback={<AdminSectionState loading title="Opening the catalogue" message="Preparing product tools…" />}><ProductManager products={summary.productsList} preview={false} notify={notify} onRefresh={refreshProducts} query={productQuery.q} status={productQuery.status} pagination={summary.pagination.products} loading={activeCollectionState.loading} onQueryChange={requestProducts} /></Suspense>}
                {section === 'requests' && <Requests summary={summary} preview={false} updateInquiryStatus={updateInquiryStatus} loading={activeCollectionState.loading} workingItems={workingItems} onPageChange={(page) => loadSection('requests', { page })} />}
                {section === 'messages' && <Messages summary={summary} preview={false} updateMessageStatus={updateMessageStatus} loading={activeCollectionState.loading} workingItems={workingItems} onPageChange={(page) => loadSection('messages', { page })} />}
                {section === 'users' && <Suspense fallback={<AdminSectionState loading title="Opening customer registry" message="Preparing customer tools…" />}><UsersManager dashboardMetrics={summary.metrics} /></Suspense>}
                {section === 'settings' && <Suspense fallback={<AdminSectionState loading title="Opening studio settings" message="Preparing storefront controls…" />}><SettingsEditor preview={false} notify={notify} onPublished={applyStudioSettings} draftScope={user?.id} /></Suspense>}
              </>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

function SectionHeading({ eyebrow, title }) {
  return <div className="admin-section-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>;
}

function DashboardSkeleton() {
  return (
    <div className="admin-dashboard-skeleton" role="status" aria-live="polite">
      <div className="admin-section-head"><div><span className="admin-skeleton-line is-short" /><span className="admin-skeleton-line is-title" /></div></div>
      <div className="admin-metrics">{Array.from({ length: 5 }, (_, index) => <div className="admin-metric-skeleton" key={index}><span /><p><i /><b /></p></div>)}</div>
      <div className="admin-dashboard-grid"><div className="admin-panel admin-panel-skeleton" /><div className="admin-panel admin-panel-skeleton" /></div>
      <span className="visually-hidden">Opening the studio overview…</span>
    </div>
  );
}

function Dashboard({ summary, setSection }) {
  const metrics = summary.metrics || {};
  const attentionOrders = summary.attentionOrders || [];
  const lowStock = summary.lowStock || [];
  const cards = [
    ['Total orders', metrics.totalOrders ?? 0, 'package', 'orders', `${metrics.ordersPending ?? 0} need attention`],
    ['New custom requests', metrics.activeCustomRequests ?? 0, 'heart', 'requests', 'Awaiting a studio reply'],
    ['New messages', metrics.newMessages ?? 0, 'mail', 'messages', 'From the contact form'],
    ['Published pieces', metrics.products ?? 0, 'bag', 'products', 'Visible in the shop'],
    ['Registered users', metrics.registeredUsers ?? 0, 'user', 'users', 'Customer accounts'],
  ];

  return (
    <>
      <div className="admin-section-head admin-overview-head">
        <div><p className="eyebrow">Today in the studio</p><h2>Overview</h2><p className="admin-section-copy">A quiet view of what needs your attention next.</p></div>
        <span>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>
      <div className="admin-metrics">
        {cards.map(([label, value, icon, target, note]) => (
          <button type="button" onClick={() => setSection(target)} key={label} aria-label={`${label}: ${value}`}>
            <span><Icon name={icon} /></span>
            <p><small>{label}</small><strong>{Number(value).toLocaleString('en-IN')}</strong><em>{note}</em></p>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      <div className="admin-dashboard-grid">
        <div className="admin-panel"><div className="admin-panel__head"><div><p className="eyebrow">Recent activity</p><h3>Orders needing attention</h3></div><button type="button" className="plain-link" onClick={() => setSection('orders')}>Open orders</button></div><MiniOrders orders={attentionOrders} /></div>
        <div className="admin-panel">
          <div className="admin-panel__head"><div><p className="eyebrow">Inventory watch</p><h3>Low stock pieces</h3></div><button type="button" className="plain-link" onClick={() => setSection('products')}>Manage</button></div>
          {lowStock.length ? <div className="low-stock-list">{lowStock.slice(0, 4).map((raw) => { const product = normalizeProduct(raw); return <div key={product.id}><SmartImage src={optimizeCloudinaryImage(product.image, 160)} alt="" fallbackLabel={product.category} loading="lazy" decoding="async" /><p><strong>{product.title}</strong><small>{raw.stock ?? raw.inventory ?? 0} remaining</small></p><span>{raw.stock ?? raw.inventory ?? 0}</span></div>; })}</div> : <AdminEmpty text="No published pieces are low in stock." compact />}
        </div>
      </div>
    </>
  );
}

function MiniOrders({ orders }) {
  if (!orders.length) return <AdminEmpty text="No orders need attention right now." compact />;
  return <div className="mini-orders">{orders.slice(0, 5).map((order) => <div key={order.id || order._id || order.orderNumber}><span className={`order-status status-${order.status}`}>{String(order.status || 'placed').replaceAll('_', ' ')}</span><p><strong>{order.orderNumber || String(order.id || order._id).slice(-6)}</strong><small>{order.buyerName || order.customer?.name || order.user?.name || order.buyerEmail || 'Buyer'} · {order.items?.[0]?.name || order.items?.[0]?.product?.title || 'Studio piece'}</small></p><b>{order.total != null ? formatCurrency(order.total) : 'Review'}</b></div>)}</div>;
}

function Orders({ summary, preview, updateStatus, loading, workingItems, onPageChange }) {
  const [query, setQuery] = useState('');
  const orders = summary.recentOrders || [];
  const pagination = summary.pagination?.orders || paginationFrom(null, orders.length);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOrders = normalizedQuery ? orders.filter((order) => `${order.orderNumber || ''} ${order.buyerName || ''} ${order.buyerEmail || ''} ${order.customer?.name || ''} ${order.items?.map((item) => item.name || item.product?.title || '').join(' ') || ''}`.toLowerCase().includes(normalizedQuery)) : orders;

  return (
    <>
      <div className="admin-section-head"><div><p className="eyebrow">Fulfilment</p><h2>Orders</h2><p className="admin-section-copy">Review purchases and move each piece through the studio. Search covers this page only.</p></div><label className="admin-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this page" aria-label="Search orders on this page" /></label></div>
      {filteredOrders.length > 0 && <p className="admin-table-scroll-hint"><Icon name="arrow" size={14} /> Scroll sideways to see every column.</p>}
      <div className={`admin-panel admin-table-panel ${loading ? 'is-updating' : ''}`} aria-busy={loading}>
        {filteredOrders.length ? (
          <Table responsive hover className="admin-table admin-table--stacked admin-orders-table" aria-label="Orders on this page">
            <thead><tr><th scope="col">Order</th><th scope="col">Buyer</th><th scope="col">Placed</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
            <tbody>{filteredOrders.map((order) => {
              const id = order.id || order._id;
              const isWorking = Boolean(workingItems[`order:${id}`]);
              return (
                <tr key={id || order.orderNumber}>
                  <td data-label="Order"><strong>{order.orderNumber || String(id).slice(-6).toUpperCase()}</strong><small>{order.items?.length || 0} pieces</small></td>
                  <td data-label="Buyer"><span className="admin-table-primary">{order.buyerName || order.customer?.name || order.user?.name || 'Buyer'}</span><small>{order.buyerEmail || order.customer?.email || ''}</small></td>
                  <td data-label="Placed">{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
                  <td data-label="Amount"><strong>{order.total != null ? formatCurrency(order.total) : 'Pending'}</strong></td>
                  <td data-label="Status"><AdminStatusDropdown value={order.status || 'placed'} options={orderStatusOptions} disabled={preview || loading} busy={isWorking} onChange={(value) => updateStatus(id, value)} label={`Status for ${order.orderNumber || 'order'}`} /></td>
                </tr>
              );
            })}</tbody>
          </Table>
        ) : <AdminEmpty text={query ? 'No orders on this page match that search.' : 'No orders have been placed yet.'} />}
        <AdminPager pagination={pagination} visibleCount={filteredOrders.length} filtered={Boolean(normalizedQuery)} noun="orders" loading={loading} onPageChange={onPageChange} />
      </div>
    </>
  );
}

function Requests({ summary, preview, updateInquiryStatus, loading, workingItems, onPageChange }) {
  const requests = summary.inquiries || [];
  const pagination = summary.pagination?.inquiries || paginationFrom(null, requests.length);
  const columns = [['new', 'New ideas'], ['contacted', 'Contacted'], ['quoted', 'Quoted'], ['accepted', 'Accepted'], ['closed', 'Closed']];
  return (
    <>
      <div className="admin-section-head"><div><p className="eyebrow">Bespoke work</p><h2>Custom requests</h2><p className="admin-section-copy">A clear board from first idea to finished conversation. Stage counts reflect the current page.</p></div></div>
      <div className={`request-board ${loading ? 'is-updating' : ''}`} aria-busy={loading}>
        {columns.map(([status, label]) => { const items = requests.filter((item) => (item.status || 'new') === status); return <section key={status} className={`request-column request-column--${status}`}><h3><span className="request-column__dot" aria-hidden="true" />{label}<b>{items.length}</b></h3><div className="request-column__items">{items.map((item) => { const id = item.id || item._id; const brief = item.description || item.idea || 'Open brief'; return <article key={id}><p className="eyebrow">{item.productType || item.category || 'Custom piece'}</p><h4>{item.name}</h4><p>{brief}</p><small>{item.budget || 'Budget to discuss'}</small><details className="admin-content-disclosure"><summary>View full brief</summary><p>{brief}</p>{item.email && <a href={`mailto:${item.email}`}>{item.email}</a>}{item.phone && <a href={`tel:${item.phone}`}>{item.phone}</a>}</details><AdminStatusDropdown value={item.status || 'new'} options={inquiryStatusOptions} disabled={preview || loading} busy={Boolean(workingItems[`inquiry:${id}`])} onChange={(value) => updateInquiryStatus(id, value)} label={`Stage for ${item.name}'s request`} align="start" /></article>; })}{!items.length && <span className="request-empty">No requests in this stage</span>}</div></section>; })}
      </div>
      <AdminPager pagination={pagination} visibleCount={requests.length} noun="requests" loading={loading} onPageChange={onPageChange} />
    </>
  );
}

function Messages({ summary, preview, updateMessageStatus, loading, workingItems, onPageChange }) {
  const messages = summary.messages || [];
  const pagination = summary.pagination?.messages || paginationFrom(null, messages.length);
  return (
    <>
      <div className="admin-section-head"><div><p className="eyebrow">Studio inbox</p><h2>Contact messages</h2><p className="admin-section-copy">Questions from customers, kept calm and easy to scan.</p></div></div>
      {messages.length > 0 && <p className="admin-table-scroll-hint"><Icon name="arrow" size={14} /> Scroll sideways to see every column.</p>}
      <div className={`admin-panel admin-table-panel ${loading ? 'is-updating' : ''}`} aria-busy={loading}>
        {messages.length ? (
          <Table responsive hover className="admin-table admin-table--stacked admin-message-table" aria-label="Contact messages on this page">
            <thead><tr><th scope="col">From</th><th scope="col">Subject</th><th scope="col">Message</th><th scope="col">Received</th><th scope="col">Status</th></tr></thead>
            <tbody>{messages.map((message) => {
              const id = message.id || message._id;
              return (
                <tr key={id}>
                  <td data-label="From"><strong>{message.name}</strong><a href={`mailto:${message.email}`}>{message.email}</a></td>
                  <td data-label="Subject">{message.subject || 'Studio question'}</td>
                  <td data-label="Message" className="admin-message-cell"><span>{message.message}</span><details className="admin-content-disclosure"><summary>Read full message</summary><p>{message.message}</p></details></td>
                  <td data-label="Received">{message.createdAt ? new Date(message.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
                  <td data-label="Status"><AdminStatusDropdown value={message.status || 'new'} options={messageStatusOptions} disabled={preview || loading} busy={Boolean(workingItems[`message:${id}`])} onChange={(value) => updateMessageStatus(id, value)} label={`Status for message from ${message.name}`} /></td>
                </tr>
              );
            })}</tbody>
          </Table>
        ) : <AdminEmpty text="No contact messages yet." />}
        <AdminPager pagination={pagination} visibleCount={messages.length} noun="messages" loading={loading} onPageChange={onPageChange} />
      </div>
    </>
  );
}

function AdminPager({ pagination, visibleCount, filtered = false, noun, loading, onPageChange }) {
  const page = Math.max(1, Number(pagination?.page || 1));
  const pages = Math.max(1, Number(pagination?.pages || pagination?.totalPages || 1));
  const total = Math.max(0, Number(pagination?.total ?? visibleCount ?? 0));
  const limit = Math.max(1, Number(pagination?.limit || ADMIN_PAGE_LIMIT));
  const first = total ? (page - 1) * limit + 1 : 0;
  const last = Math.min(total, (page - 1) * limit + Number(visibleCount || 0));
  const countLabel = filtered ? `${visibleCount} matching on this page · ${total} total ${noun}` : `Showing ${first}–${last} of ${total} ${noun}`;
  return <footer className="users-pagination admin-collection-pagination"><span>{loading ? 'Loading page…' : countLabel}</span><div><Button type="button" size="sm" variant="outline-dark" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button type="button" size="sm" variant="outline-dark" disabled={loading || page >= pages} onClick={() => onPageChange(page + 1)}>Next</Button></div></footer>;
}

function AdminEmpty({ text, compact = false }) {
  return <div className={`admin-empty ${compact ? 'is-compact' : ''}`}><Icon name="spark" /><p>{text}</p></div>;
}
