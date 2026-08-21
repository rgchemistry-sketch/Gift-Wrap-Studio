import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Table from 'react-bootstrap/Table';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import Icon from '../components/Icon';
import SmartImage from '../components/SmartImage';
import AdminSectionState from '../components/admin/AdminSectionState';
import AdminStatusDropdown from '../components/admin/AdminStatusDropdown';
import AdminTableShell from '../components/admin/AdminTableShell';
import AdminPaymentDesk from '../components/admin/AdminPaymentDesk';
import { formatCurrency, normalizeProduct } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { optimizeCloudinaryImage } from '../utils/cloudinary-image';
import {
  buildInboxStatusUpdate,
  canRetryInquiryStatusWithoutSnapshot,
  orderContactSnapshot,
  parseOrderCustomization,
} from '../utils/admin-order-details';
import { adminOrderErrorMessage } from '../utils/admin-api-compat';
import {
  BULK_ORDER_STATUS_TARGETS,
  canMoveAllOrdersTo,
  canMoveOrderStatus,
  canUseBulkOrderActions,
  legalOrderStatusOptions,
} from '../utils/order-status-transitions';
import { adminSectionHref, resolveAdminSection } from '../utils/admin-navigation';
import '../admin.css';
import '../admin-request-board.css';
import '../payment-flow.css';

const importProductManager = () => import('../components/admin/ProductManager');
const ProductManager = lazy(importProductManager);
const SettingsEditor = lazy(() => import('../components/admin/SettingsEditor'));
const UsersManager = lazy(() => import('../components/admin/UsersManager'));
const SalesAnalyticsDashboard = lazy(() => import('../components/admin/SalesAnalyticsDashboard'));
const SalesOverviewSnapshot = lazy(() => import('../components/admin/SalesAnalyticsDashboard').then((module) => ({
  default: module.SalesOverviewSnapshot,
})));

const adminNav = [
  ['dashboard', 'spark', 'Overview'],
  ['sales', 'chart', 'Sales'],
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

const safeReferenceHref = (value) => {
  const candidate = String(value || '').trim();
  if (candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/\\')) {
    return candidate;
  }
  try {
    const reference = new URL(candidate);
    return ['http:', 'https:'].includes(reference.protocol) ? reference.href : '';
  } catch {
    return '';
  }
};

const adminDateLabel = (value, fallback = 'Not specified') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

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

const inquiryWorkspaceStages = [
  { value: 'new', label: 'New ideas', description: 'Awaiting a first reply' },
  { value: 'contacted', label: 'Contacted', description: 'Conversation started' },
  { value: 'quoted', label: 'Quoted', description: 'Proposal shared' },
  { value: 'accepted', label: 'Accepted', description: 'Ready to make' },
  { value: 'closed', label: 'Closed', description: 'Conversation complete' },
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
  const [orderQuery, setOrderQuery] = useState({ q: '', status: '', page: 1 });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [sectionState, setSectionState] = useState(initialSectionState);
  const [preview, setPreview] = useState(false);
  const [workingItems, setWorkingItems] = useState({});
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [statusNote, setStatusNote] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const { user, signOut, setUser, signingOut } = useAuth();
  const { notify, applyStudioSettings } = useShop();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const section = resolveAdminSection(requestedSection, adminSectionKeys);
  const contentRef = useRef(null);
  const previousSectionRef = useRef(section);
  const dashboardRequestRef = useRef(0);
  const sectionRequestRef = useRef({});
  const productQueryRef = useRef(productQuery);
  const orderQueryRef = useRef(orderQuery);
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
      if ((sectionName === 'products' || sectionName === 'orders') && !items.length && page > pagination.pages) {
        const nextQuery = { ...options, page: pagination.pages };
        if (sectionName === 'products') {
          productQueryRef.current = nextQuery;
          setProductQuery(nextQuery);
        } else {
          orderQueryRef.current = nextQuery;
          setOrderQuery(nextQuery);
        }
        return loadAdminSection(sectionName, nextQuery);
      }
      setSummary((current) => {
        const nextMetrics = { ...current.metrics };
        if (sectionName === 'orders' && !options.q && !options.status) {
          nextMetrics.totalOrders = pagination.total;
        }
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

  const requestOrders = useCallback((changes = {}) => {
    const nextQuery = {
      ...orderQueryRef.current,
      ...changes,
      page: Math.max(1, Number(changes.page ?? orderQueryRef.current.page ?? 1)),
    };
    orderQueryRef.current = nextQuery;
    setOrderQuery(nextQuery);
    return loadSection('orders', nextQuery);
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
    loadSection(
      section,
      section === 'products'
        ? productQueryRef.current
        : section === 'orders'
          ? orderQueryRef.current
          : { page },
    );
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

  const refreshFilteredOrders = () => {
    if (orderQueryRef.current.q || orderQueryRef.current.status) {
      void loadSection('orders', orderQueryRef.current);
    }
  };

  const updateStatus = async (orderId, status, note = '', {
    announce = true,
    expectedStatus = '',
    undo = false,
    successMessage = '',
    staleMessage = '',
  } = {}) => {
    const workingKey = `order:${orderId}`;
    markWorking(workingKey, true);
    try {
      await api.updateOrderStatus(orderId, {
        status,
        note: note.trim(),
        ...(expectedStatus ? { expectedStatus } : {}),
        ...(undo ? { undo: true } : {}),
      });
      applyStatusLocally('recentOrders', orderId, status);
      if (announce) notify(successMessage || 'Order status updated.');
      void loadDashboard({ quiet: true });
      refreshFilteredOrders();
      return true;
    } catch (requestError) {
      if (undo && requestError.status === 409) {
        notify(staleMessage || 'This order changed again, so Undo was not applied.', 'warning');
        void loadSection('orders', orderQueryRef.current);
      } else if (expectedStatus && requestError.status === 409) {
        notify('This order was changed in another admin session. We refreshed its current status; review it before trying again.', 'warning');
        setPendingStatusChange(null);
        setStatusNote('');
        void loadSection('orders', orderQueryRef.current);
        void loadDashboard({ quiet: true });
      } else {
        notify(requestError.message, 'error');
      }
      return false;
    } finally {
      markWorking(workingKey, false);
    }
  };

  const updateInquiryStatus = async (inquiryId, status, adminNote, {
    announce = true,
    expectedStatus = '',
    undo = false,
    successMessage = '',
    staleMessage = '',
  } = {}) => {
    const workingKey = `inquiry:${inquiryId}`;
    markWorking(workingKey, true);
    try {
      const update = buildInboxStatusUpdate({
        status,
        adminNote,
        expectedStatus,
        undo,
      });
      try {
        await api.updateInquiryStatus(inquiryId, update);
      } catch (requestError) {
        // During a rolling deployment an older API may reject the concurrency
        // metadata before touching the request. A single forward-only retry keeps
        // stage changes usable; Undo never gives up its snapshot protection.
        if (!canRetryInquiryStatusWithoutSnapshot({ error: requestError, expectedStatus, undo })) throw requestError;
        await api.updateInquiryStatus(inquiryId, buildInboxStatusUpdate({
          status,
          adminNote,
        }));
      }
      applyStatusLocally('inquiries', inquiryId, status);
      if (announce) notify(successMessage || 'Custom request stage updated.');
      void loadDashboard({ quiet: true });
      return true;
    } catch (requestError) {
      if (undo && requestError.status === 409) {
        notify(staleMessage || 'This custom request changed again, so Undo was not applied.', 'warning');
        void loadSection('requests', { page: summary.pagination?.inquiries?.page || 1 });
      } else if (expectedStatus && requestError.status === 409) {
        notify('This custom request was changed in another admin session. We refreshed its current stage; review it before trying again.', 'warning');
        setPendingStatusChange(null);
        setStatusNote('');
        void loadSection('requests', { page: summary.pagination?.inquiries?.page || 1 });
        void loadDashboard({ quiet: true });
      } else {
        notify(requestError.message, 'error');
      }
      return false;
    } finally {
      markWorking(workingKey, false);
    }
  };

  const updateMessageStatus = async (contactId, status, adminNote, {
    announce = true,
    expectedStatus = '',
    undo = false,
    successMessage = '',
    staleMessage = '',
  } = {}) => {
    const workingKey = `message:${contactId}`;
    markWorking(workingKey, true);
    try {
      await api.updateContactStatus(contactId, buildInboxStatusUpdate({
        status,
        adminNote,
        expectedStatus,
        undo,
      }));
      applyStatusLocally('messages', contactId, status);
      if (announce) notify(successMessage || 'Message status updated.');
      void loadDashboard({ quiet: true });
      return true;
    } catch (requestError) {
      if (undo && requestError.status === 409) {
        notify(staleMessage || 'This message changed again, so Undo was not applied.', 'warning');
        void loadSection('messages', { page: summary.pagination?.messages?.page || 1 });
      } else if (expectedStatus && requestError.status === 409) {
        notify('This message was changed in another admin session. We refreshed its current status; review it before trying again.', 'warning');
        setPendingStatusChange(null);
        setStatusNote('');
        void loadSection('messages', { page: summary.pagination?.messages?.page || 1 });
        void loadDashboard({ quiet: true });
      } else {
        notify(requestError.message, 'error');
      }
      return false;
    } finally {
      markWorking(workingKey, false);
    }
  };

  const requestStatusChange = (change) => {
    if (
      change?.kind === 'order'
      && !canMoveOrderStatus(change?.currentStatus || 'placed', change?.status)
    ) {
      notify('That order can no longer move to the selected status. Refreshing the order list…', 'warning');
      void loadSection('orders', orderQueryRef.current);
      return;
    }
    const immediate = (
      change?.kind === 'message' && change?.status === 'read'
    ) || (
      change?.kind === 'order'
      && BULK_ORDER_STATUS_TARGETS.includes(change?.status)
    ) || (
      change?.kind === 'inquiry' && change?.status === 'accepted' && change?.currentStatus !== 'closed'
    );
    if (immediate) {
      const updater = change.kind === 'order'
        ? updateStatus
        : change.kind === 'inquiry'
          ? updateInquiryStatus
          : updateMessageStatus;
      const nextLabel = (change.kind === 'order'
        ? orderStatusOptions
        : change.kind === 'inquiry'
          ? inquiryStatusOptions
          : messageStatusOptions
      ).find((option) => option.value === change.status)?.label || change.status;
      void updater(change.id, change.status, undefined, {
        announce: false,
        expectedStatus: change.currentStatus,
      }).then((succeeded) => {
        if (!succeeded) return;
        notify(`${change.subject || 'Record'} moved to ${String(nextLabel).toLowerCase()}.`, 'success', {
          duration: 8_000,
          action: {
            label: 'Undo',
            expiresMs: 8_000,
            onClick: () => {
              void updater(change.id, change.currentStatus, undefined, {
                announce: true,
                expectedStatus: change.status,
                undo: true,
                successMessage: `${change.subject || 'Record'} restored to ${String(change.currentStatus || 'new').replaceAll('_', ' ')}.`,
                staleMessage: `${change.subject || 'This record'} changed again, so Undo was not applied.`,
              });
            },
          },
        });
      });
      return;
    }
    setStatusNote('');
    setPendingStatusChange(change);
  };

  const runBulkStatusChanges = async (kind, changes) => {
    const uniqueChanges = [...new Map(
      changes
        .filter((change) => change?.id && change?.status)
        .map((change) => [String(change.id), change]),
    ).values()];
    if (!uniqueChanges.length) return { updatedChanges: [], failedChanges: [] };

    uniqueChanges.forEach(({ id }) => markWorking(`${kind}:${id}`, true));
    const results = await Promise.allSettled(uniqueChanges.map(({
      id,
      status,
      previousStatus,
      expectedStatus,
      undo,
    }) => {
      const snapshotStatus = expectedStatus || (!undo ? previousStatus : '');
      return kind === 'order'
        ? api.updateOrderStatus(id, {
          status,
          note: '',
          ...(snapshotStatus ? { expectedStatus: snapshotStatus } : {}),
          ...(undo ? { undo: true } : {}),
        })
        : api.updateContactStatus(id, {
          status,
          ...(snapshotStatus ? { expectedStatus: snapshotStatus } : {}),
          ...(undo ? { undo: true } : {}),
        });
    }));
    const updatedChanges = [];
    const failedChanges = [];
    results.forEach((result, index) => {
      const change = uniqueChanges[index];
      markWorking(`${kind}:${change.id}`, false);
      if (result.status !== 'fulfilled') {
        failedChanges.push({ ...change, error: result.reason });
        return;
      }
      updatedChanges.push(change);
      applyStatusLocally(
        kind === 'order' ? 'recentOrders' : 'messages',
        change.id,
        change.status,
      );
    });
    return { updatedChanges, failedChanges };
  };

  const updateBulkStatus = async (kind, ids, status) => {
    const uniqueIds = [...new Set(ids.map(String))].filter(Boolean);
    const stateKey = kind === 'order' ? 'recentOrders' : 'messages';
    const recordsById = new Map((summary[stateKey] || []).map((record) => [
      String(record.id || record._id),
      record,
    ]));
    const skippedIds = [];
    const changes = uniqueIds.flatMap((id) => {
      const record = recordsById.get(id);
      const previousStatus = record?.status || (kind === 'message' ? 'new' : '');
      if (!record || (
        kind === 'order'
        && !canMoveOrderStatus(previousStatus, status)
      )) {
        skippedIds.push(id);
        return [];
      }
      return [{ id, status, previousStatus, expectedStatus: previousStatus }];
    });
    const { updatedChanges, failedChanges } = await runBulkStatusChanges(kind, changes);
    const updated = updatedChanges.length;
    const failed = failedChanges.length + skippedIds.length;
    const conflicts = failedChanges.filter((change) => change.error?.status === 409).length;
    const otherFailures = failed - conflicts;

    if (updated) {
      const noun = kind === 'order' ? 'orders' : 'messages';
      const failureCopy = [
        conflicts ? `${conflicts} changed in another admin session and were refreshed` : '',
        otherFailures ? `${otherFailures} could not be changed` : '',
      ].filter(Boolean).join('; ');
      notify(`${updated} ${noun} updated${failureCopy ? `; ${failureCopy}` : ''}.`, failed ? 'warning' : 'success', {
        duration: 8_000,
        action: {
          label: 'Undo',
          expiresMs: 8_000,
          onClick: () => void (async () => {
            const undoChanges = updatedChanges.map((change) => ({
              id: change.id,
              status: change.previousStatus,
              expectedStatus: change.status,
              undo: true,
            }));
            const undoResult = await runBulkStatusChanges(kind, undoChanges);
            const undone = undoResult.updatedChanges.length;
            const undoFailed = undoResult.failedChanges.length;
            const staleUndo = undoResult.failedChanges.filter((change) => change.error?.status === 409).length;
            if (undone) {
              const failureCopy = staleUndo
                ? `${staleUndo} ${staleUndo === 1 ? 'was' : 'were'} left unchanged because ${staleUndo === 1 ? 'its status' : 'their statuses'} changed again`
                : `${undoFailed} could not be restored`;
              notify(`${undone} ${noun} restored${undoFailed ? `; ${failureCopy}` : ''}.`, undoFailed ? 'warning' : 'success');
              void loadDashboard({ quiet: true });
              if (kind === 'order') void loadSection('orders', orderQueryRef.current);
              else void loadSection('messages', { page: summary.pagination?.messages?.page || 1 });
            } else {
              notify(
                staleUndo
                  ? `Undo was not applied because the selected ${noun} changed again.`
                  : `The ${noun} could not be restored.`,
                staleUndo ? 'warning' : 'error',
              );
              if (kind === 'order') void loadSection('orders', orderQueryRef.current);
              else void loadSection('messages', { page: summary.pagination?.messages?.page || 1 });
            }
          })(),
        },
      });
      void loadDashboard({ quiet: true });
      if (kind === 'order' && !conflicts) refreshFilteredOrders();
      if (conflicts) {
        if (kind === 'order') void loadSection('orders', orderQueryRef.current);
        else void loadSection('messages', { page: summary.pagination?.messages?.page || 1 });
      }
    } else {
      const noun = kind === 'order' ? 'orders' : 'messages';
      notify(
        conflicts
          ? `The selected ${noun} changed in another admin session. We refreshed their current statuses; review them before trying again.`
          : `The selected ${noun} could not be updated.`,
        conflicts ? 'warning' : 'error',
      );
      if (conflicts) {
        if (kind === 'order') void loadSection('orders', orderQueryRef.current);
        else void loadSection('messages', { page: summary.pagination?.messages?.page || 1 });
        void loadDashboard({ quiet: true });
      }
    }

    return {
      updatedIds: updatedChanges.map((change) => String(change.id)),
      failedIds: [
        ...failedChanges.map((change) => String(change.id)),
        ...skippedIds,
      ],
    };
  };

  const submitStatusChange = async () => {
    if (!pendingStatusChange || statusSubmitting) return;
    setStatusSubmitting(true);
    const { kind, id, status, currentStatus } = pendingStatusChange;
    const updateOptions = { expectedStatus: currentStatus };
    const succeeded = kind === 'order'
      ? await updateStatus(id, status, statusNote, updateOptions)
      : kind === 'inquiry'
        ? await updateInquiryStatus(id, status, statusNote, updateOptions)
        : await updateMessageStatus(id, status, statusNote, updateOptions);
    setStatusSubmitting(false);
    if (succeeded) {
      setPendingStatusChange(null);
      setStatusNote('');
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
    const options = section === 'products'
      ? productQueryRef.current
      : section === 'orders'
        ? orderQueryRef.current
        : { page };
    loadSection(section, options);
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
      <a className="admin-skip-link" href="#admin-main">Skip to workspace</a>
      <Container fluid="xl" className="admin-page__container">
        <header className="admin-topbar">
          <div className="admin-topbar__brand">
            <span className="admin-brand-mark" aria-hidden="true">G<span>·</span>W</span>
            <div><p className="eyebrow">Gift N Wrap Studio</p><h1>Studio desk</h1></div>
          </div>
          <div className="admin-topbar__actions">
            <span
              className={`admin-workspace-state ${dashboardError && !dashboardReady ? 'has-error' : ''}`}
              role="status"
              aria-label={`${workspaceLabel}${lastSyncedAt && !dashboardLoading ? `, synced ${lastSyncedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="admin-live-dot" aria-hidden="true" />
              <span className="admin-workspace-state__label">{workspaceLabel}</span>
              {lastSyncedAt && !dashboardLoading && <small>Synced {lastSyncedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small>}
            </span>
            <Link to="/" className="btn btn-outline-dark btn-sm admin-storefront-link" aria-label="Open storefront">
              <span className="admin-storefront-link__label">Storefront</span> <Icon name="arrow" size={14} />
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
                  <Icon name="logout" size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}
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

          <div id="admin-main" ref={contentRef} className="admin-content" role="region" tabIndex={-1} aria-label={`${activeSectionLabel} admin section`}>
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
                  <Dashboard summary={summary} setSection={selectSection} onAuthorizationFailure={handleAuthorizationFailure} />
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
                {section === 'sales' && (
                  <>
                    <div className="admin-section-head admin-sales-section-head">
                      <div>
                        <p className="eyebrow">Commercial perspective</p>
                        <h2>Sales</h2>
                        <p className="admin-section-copy">Read revenue, products and customer momentum together—then export the same view for deeper planning.</p>
                      </div>
                      <span className="admin-sales-section-head__scope"><Icon name="chart" size={17} /> Revenue · Products · Customers</span>
                    </div>
                    <Suspense fallback={<AdminSectionState loading title="Opening sales intelligence" message="Preparing sales, product and customer trends…" />}>
                      <SalesAnalyticsDashboard onAuthorizationFailure={handleAuthorizationFailure} />
                    </Suspense>
                  </>
                )}
                {section === 'orders' && <Orders summary={summary} preview={false} updateStatus={(id, status, context) => requestStatusChange({ kind: 'order', id, status, ...context })} updateBulkStatus={updateBulkStatus} loading={activeCollectionState.loading} workingItems={workingItems} query={orderQuery.q} status={orderQuery.status} onQueryChange={requestOrders} />}
                {section === 'products' && <Suspense fallback={<AdminSectionState loading title="Opening the catalogue" message="Preparing product tools…" />}><ProductManager products={summary.productsList} preview={false} notify={notify} onRefresh={refreshProducts} query={productQuery.q} status={productQuery.status} pagination={summary.pagination.products} loading={activeCollectionState.loading} onQueryChange={requestProducts} /></Suspense>}
                {section === 'requests' && <Requests summary={summary} preview={false} updateInquiryStatus={(id, status, context) => requestStatusChange({ kind: 'inquiry', id, status, ...context })} loading={activeCollectionState.loading} workingItems={workingItems} onPageChange={(page) => loadSection('requests', { page })} />}
                {section === 'messages' && <Messages summary={summary} preview={false} updateMessageStatus={(id, status, context) => requestStatusChange({ kind: 'message', id, status, ...context })} updateBulkStatus={updateBulkStatus} loading={activeCollectionState.loading} workingItems={workingItems} onPageChange={(page) => loadSection('messages', { page })} />}
                {section === 'users' && <Suspense fallback={<AdminSectionState loading title="Opening customer registry" message="Preparing customer tools…" />}><UsersManager dashboardMetrics={summary.metrics} /></Suspense>}
                {section === 'settings' && <Suspense fallback={<AdminSectionState loading title="Opening studio settings" message="Preparing storefront controls…" />}><SettingsEditor preview={false} notify={notify} onPublished={applyStudioSettings} draftScope={user?.id} /></Suspense>}
              </>
            )}
          </div>
        </div>
      </Container>
      <StatusChangeModal
        change={pendingStatusChange}
        note={statusNote}
        submitting={statusSubmitting}
        onNoteChange={setStatusNote}
        onCancel={() => {
          if (!statusSubmitting) setPendingStatusChange(null);
        }}
        onConfirm={submitStatusChange}
      />
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

function Dashboard({ summary, setSection, onAuthorizationFailure }) {
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
      <Suspense fallback={<div className="admin-sales-snapshot admin-sales-snapshot--loading" role="status">Preparing this month’s sales pulse…</div>}>
        <SalesOverviewSnapshot onAuthorizationFailure={onAuthorizationFailure} onOpenSales={() => setSection('sales')} />
      </Suspense>
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

function Orders({ summary, preview, updateStatus, updateBulkStatus, loading, workingItems, query, status, onQueryChange }) {
  const [draftQuery, setDraftQuery] = useState(query);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [activeOrder, setActiveOrder] = useState(null);
  const orders = summary.recentOrders || [];
  const pagination = summary.pagination?.orders || paginationFrom(null, orders.length);
  const orderIds = orders
    .filter((order) => canUseBulkOrderActions(order.status || 'placed'))
    .map((order) => order.id || order._id)
    .filter(Boolean);
  const ordersById = new Map(orders.map((order) => [String(order.id || order._id), order]));
  const selectedOrders = [...selectedIds]
    .map((id) => ordersById.get(id))
    .filter(Boolean);
  const availableBulkTargets = BULK_ORDER_STATUS_TARGETS.filter(
    (targetStatus) => canMoveAllOrdersTo(selectedOrders, targetStatus),
  );
  const allSelected = orderIds.length > 0 && orderIds.every((id) => selectedIds.has(String(id)));
  const bulkBusy = [...selectedIds].some((id) => workingItems[`order:${id}`]);

  useEffect(() => setDraftQuery(query), [query]);
  useEffect(() => {
    const visibleEligible = new Set((summary.recentOrders || [])
      .filter((order) => canUseBulkOrderActions(order.status || 'placed'))
      .map((order) => order.id || order._id)
      .filter(Boolean)
      .map(String));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleEligible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [summary.recentOrders]);

  const submitSearch = (event) => {
    event.preventDefault();
    onQueryChange({ q: draftQuery.trim(), page: 1 });
  };

  return (
    <>
      <div className="admin-section-head admin-orders-head">
        <div><p className="eyebrow">Fulfilment</p><h2>Orders</h2><p className="admin-section-copy">Find any order across the full workspace, then move each piece through the studio.</p></div>
        <form className="admin-search" onSubmit={submitSearch} role="search">
          <Icon name="search" />
          <input type="search" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Order, buyer, email or piece" aria-label="Search all orders" />
          {query && <button type="button" className="admin-search__clear" onClick={() => { setDraftQuery(''); onQueryChange({ q: '', page: 1 }); }} aria-label="Clear order search"><Icon name="close" size={14} /></button>}
          <button type="submit" className="admin-search__submit">Search</button>
        </form>
      </div>
      <div className="admin-order-filters" role="group" aria-label="Filter orders by status">
        {[{ value: '', label: 'All orders' }, ...orderStatusOptions].map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={(status || '') === option.value ? 'is-active' : ''}
            aria-pressed={(status || '') === option.value}
            onClick={() => onQueryChange({ status: option.value, page: 1 })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {selectedIds.size > 0 && (
        <div className="admin-bulk-actions" role="group" aria-label="Bulk order actions">
          <strong>{bulkBusy ? 'Updating selected orders…' : `${selectedIds.size} selected`}</strong>
          <span>Move together:</span>
          {availableBulkTargets.map((targetStatus) => {
            const option = orderStatusOptions.find(({ value }) => value === targetStatus);
            return (
              <button type="button" key={targetStatus} disabled={loading || bulkBusy} onClick={async () => { const result = await updateBulkStatus('order', [...selectedIds], targetStatus); setSelectedIds(new Set(result.failedIds)); }}>{option?.label || targetStatus}</button>
            );
          })}
          <button type="button" className="plain-link" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}
      <AdminTableShell loading={loading}>
        {orders.length ? (
          <Table responsive hover className="admin-table admin-table--stacked admin-orders-table" aria-label="Orders on this page">
            <thead><tr><th scope="col" className="admin-select-column"><input type="checkbox" checked={allSelected} disabled={bulkBusy || !orderIds.length} onChange={(event) => setSelectedIds(event.target.checked ? new Set(orderIds.map(String)) : new Set())} aria-label={allSelected ? 'Clear all visible orders' : 'Select all visible orders'} /></th><th scope="col">Order</th><th scope="col">Buyer</th><th scope="col">Placed</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
            <tbody>{orders.map((order) => {
              const id = order.id || order._id;
              const isWorking = Boolean(workingItems[`order:${id}`]);
              const currentStatus = order.status || 'placed';
              const statusOptions = legalOrderStatusOptions(currentStatus, orderStatusOptions);
              const bulkEligible = canUseBulkOrderActions(currentStatus);
              const selected = selectedIds.has(String(id));
              const pieceCount = (order.items || []).reduce(
                (total, item) => total + Math.max(0, Number(item?.quantity) || 0),
                0,
              );
              return (
                <tr key={id || order.orderNumber}>
                  <td data-label="Select" className="admin-select-column"><input type="checkbox" checked={selected} disabled={isWorking || !bulkEligible} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(String(id)); else next.delete(String(id)); return next; })} aria-label={bulkEligible ? `Select order ${order.orderNumber || String(id).slice(-6).toUpperCase()}` : `${order.orderNumber || 'Order'} has no available bulk move`} /></td>
                  <td data-label="Order"><strong>{order.orderNumber || String(id).slice(-6).toUpperCase()}</strong><small>{pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}</small><button type="button" className="admin-order-open" onClick={() => setActiveOrder(order)}>View complete order <Icon name="arrow" size={13} /></button></td>
                  <td data-label="Buyer"><span className="admin-table-primary">{order.buyerName || order.customer?.name || order.user?.name || 'Buyer'}</span><small>{order.buyerEmail || order.customer?.email || ''}</small></td>
                  <td data-label="Placed">{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
                  <td data-label="Amount"><strong>{order.total != null ? formatCurrency(order.total) : 'Pending'}</strong></td>
                  <td data-label="Status"><AdminStatusDropdown value={currentStatus} options={statusOptions} disabled={preview || loading || statusOptions.length <= 1} busy={isWorking} onChange={(value) => updateStatus(id, value, { subject: order.orderNumber || 'this order', currentStatus })} label={`Status for ${order.orderNumber || 'order'}`} /></td>
                </tr>
              );
            })}</tbody>
          </Table>
        ) : <AdminEmpty text={query ? `No orders match “${query}”. Try an order number, buyer email or piece name.` : status ? `No ${orderStatusOptions.find((option) => option.value === status)?.label.toLowerCase() || status} orders right now.` : 'No orders have been placed yet.'} />}
        <AdminPager pagination={pagination} visibleCount={orders.length} filtered={Boolean(query || status)} noun="orders" loading={loading} onPageChange={(page) => onQueryChange({ page })} />
      </AdminTableShell>
      <OrderDetailsModal
        order={activeOrder}
        onHide={() => setActiveOrder(null)}
        onOrderChanged={() => onQueryChange({})}
      />
    </>
  );
}

function OrderDetailsModal({ order, onHide, onOrderChanged }) {
  const orderId = order?.id || order?._id || order?.orderNumber || '';
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!orderId) {
      setRecord(null);
      setLoading(false);
      setError('');
      return () => { active = false; };
    }
    setRecord(null);
    setLoading(true);
    setError('');
    api.getAdminOrder(orderId)
      .then((result) => {
        if (active) setRecord(result?.data || result?.order || result);
      })
      .catch((requestError) => {
        if (active) setError(adminOrderErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadAttempt, orderId]);

  if (!order) return null;
  const hasCompleteRecord = Boolean(record);
  const details = record || order;
  const address = details.shippingAddress || {};
  const contact = orderContactSnapshot(details);
  const items = Array.isArray(details.items) ? details.items : [];
  const phone = String(address.phone || '').trim();
  const phoneHref = phone.replace(/[^\d+]/g, '');
  const displayOrderNumber = details.orderNumber || String(orderId).slice(-8).toUpperCase();
  const statusLabel = orderStatusOptions.find(({ value }) => value === (details.status || 'placed'))?.label || String(details.status || 'placed').replaceAll('_', ' ');
  const addressLines = [
    address.recipientName,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter(Boolean);
  const summaryOnlyLabel = loading ? 'Loading…' : 'Unavailable in summary';
  const refreshOrder = () => {
    setLoadAttempt((attempt) => attempt + 1);
    onOrderChanged?.();
  };

  return (
    <Modal show onHide={onHide} size="xl" centered scrollable className="admin-order-modal" aria-labelledby="admin-order-title">
      <Modal.Header closeButton>
        <div className="admin-order-modal__title">
          <p className="eyebrow">Complete order record</p>
          <Modal.Title id="admin-order-title">{displayOrderNumber}</Modal.Title>
          <div className="admin-order-modal__subhead">
            <span className={`admin-request-modal__status status-${details.status || 'placed'}`}><i aria-hidden="true" />{statusLabel}</span>
            <time dateTime={details.createdAt || undefined}>Placed {adminDateLabel(details.createdAt, 'recently')}</time>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body>
        {loading && <div className="admin-order-modal__loading" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true" /> Loading the secure order record…</div>}
        {error && <Alert variant="warning" className="admin-order-modal__error"><strong>Showing the verified order-list summary.</strong> {error} <Button type="button" size="sm" variant="outline-dark" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button></Alert>}
        <div className={`admin-order-modal__layout ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
          <div className="admin-order-modal__main">
            <section className="admin-order-modal__section" aria-labelledby="admin-order-items-heading">
              <div className="admin-order-modal__section-head"><div><p className="eyebrow">What they ordered</p><h3 id="admin-order-items-heading">{items.length} {items.length === 1 ? 'line item' : 'line items'}</h3></div><strong>{details.total != null ? formatCurrency(details.total) : 'Total pending'}</strong></div>
              <div className="admin-order-items">
                {items.map((item, index) => {
                  const quantity = Math.max(1, Number(item.quantity) || 1);
                  const rawUnitPrice = item.unitPrice ?? item.price;
                  const hasUnitPrice = rawUnitPrice !== undefined
                    && rawUnitPrice !== null
                    && rawUnitPrice !== ''
                    && Number.isFinite(Number(rawUnitPrice));
                  const unitPrice = hasUnitPrice ? Number(rawUnitPrice) : 0;
                  const customization = parseOrderCustomization(item.customization);
                  return (
                    <article className="admin-order-item" key={`${item.productId || item.slug || item.name || 'item'}-${index}`}>
                      <div className="admin-order-item__summary">
                        <SmartImage src={item.image} alt="" fallbackLabel={item.category || 'Studio piece'} loading="lazy" />
                        <div><p className="eyebrow">{item.category || 'Studio piece'}</p><h4>{item.name || item.product?.title || 'Handmade piece'}</h4><span>{hasUnitPrice ? `${quantity} × ${formatCurrency(unitPrice)}` : `${quantity} ${quantity === 1 ? 'piece' : 'pieces'} · pricing in full record`}</span></div>
                        <strong>{hasUnitPrice ? formatCurrency(unitPrice * quantity) : '—'}</strong>
                      </div>
                      {(customization.fields.length > 0 || customization.media.length > 0) ? (
                        <div className="admin-order-customization">
                          <h5>Customer personalization</h5>
                          {customization.fields.length > 0 && <dl>{customization.fields.map((field, fieldIndex) => <div key={`${field.label}-${fieldIndex}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
                          {customization.media.length > 0 && <div className="admin-order-customization__media">{customization.media.map((media, mediaIndex) => <a href={media.url} target="_blank" rel="noopener noreferrer" key={`${media.url}-${mediaIndex}`}><SmartImage src={optimizeCloudinaryImage(media.url, 480)} alt={media.name} loading="lazy" /><span>{media.name}<Icon name="arrow" size={13} /></span></a>)}</div>}
                        </div>
                      ) : <p className="admin-order-item__standard">{hasCompleteRecord ? 'No personalization was submitted for this piece.' : 'Personalization details are available in the complete order record.'}</p>}
                    </article>
                  );
                })}
                {!items.length && <p className="admin-order-item__standard">The item summary is unavailable.</p>}
              </div>
            </section>
            {contact.customerNote && <section className="admin-order-modal__section"><p className="eyebrow">Customer note</p><h3>Delivery or gift instructions</h3><p className="admin-order-modal__note">{contact.customerNote}</p></section>}
            {Array.isArray(details.statusHistory) && details.statusHistory.length > 0 && <section className="admin-order-modal__section"><p className="eyebrow">Studio timeline</p><h3>Order history</h3><ol className="admin-order-history">{details.statusHistory.map((entry, index) => <li key={`${entry.status}-${entry.at || index}`}><i aria-hidden="true" /><div><strong>{String(entry.status || '').replaceAll('_', ' ')}</strong><time>{adminDateLabel(entry.at, 'Recently')}</time>{entry.note && <p>{entry.note}</p>}</div></li>)}</ol></section>}
          </div>
          <aside className="admin-order-modal__aside" aria-label="Buyer, delivery and payment details">
            <section>
              <p className="eyebrow">Account buyer & contact</p>
              <h3>{details.buyerName || address.recipientName || 'Studio customer'}</h3>
              {details.buyerEmail && <a className="admin-order-contact" href={`mailto:${details.buyerEmail}`}><Icon name="mail" size={18} /><span><small>Email</small>{details.buyerEmail}</span></a>}
              {phone && phoneHref && <a className="admin-order-contact" href={`tel:${phoneHref}`}><Icon name="phone" size={18} /><span><small>Checkout phone · not verified</small>{phone}</span></a>}
              <dl className="admin-order-facts"><div><dt>Preferred contact</dt><dd>{hasCompleteRecord ? contact.contactPreference : summaryOnlyLabel}</dd></div><div><dt>Needed by</dt><dd>{hasCompleteRecord ? adminDateLabel(contact.neededBy) : summaryOnlyLabel}</dd></div></dl>
            </section>
            <section>
              <p className="eyebrow">Delivery recipient & address</p>
              <h3>{address.recipientName || 'Delivery address'}</h3>
              {addressLines.length > 0 ? <address>{addressLines.map((line) => <span key={line}>{line}</span>)}</address> : <p>{hasCompleteRecord ? 'Shipping address was not supplied.' : summaryOnlyLabel}</p>}
            </section>
            <section>
              <p className="eyebrow">Order total</p>
              {hasCompleteRecord ? <dl className="admin-order-totals">
                <div><dt>Items</dt><dd>{formatCurrency(Number(details.subtotal || 0))}</dd></div>
                <div><dt>Delivery</dt><dd>{formatCurrency(Number(details.shippingFee || 0))}</dd></div>
                {Number(details.discount || 0) > 0 && <div><dt>Discount{details.couponCode ? ` · ${details.couponCode}` : ''}</dt><dd>−{formatCurrency(Number(details.discount))}</dd></div>}
                <div className="is-total"><dt>Total</dt><dd>{formatCurrency(Number(details.total || 0))}</dd></div>
                <div><dt>Payment</dt><dd>{String(details.paymentStatus || 'pending').replaceAll('_', ' ')}</dd></div>
              </dl> : <div className="admin-order-summary-only"><span>Order-list total</span><strong>{details.total != null ? formatCurrency(details.total) : 'Unavailable'}</strong><small>Items, delivery, discounts and payment appear after the complete record loads.</small></div>}
            </section>
            {hasCompleteRecord && <AdminPaymentDesk order={details} onChanged={refreshOrder} />}
          </aside>
        </div>
      </Modal.Body>
      <Modal.Footer><Button type="button" variant="outline-dark" onClick={onHide}>Close order</Button></Modal.Footer>
    </Modal>
  );
}

function Requests({ summary, preview, updateInquiryStatus, loading, workingItems, onPageChange }) {
  const requests = summary.inquiries || [];
  const [activeBrief, setActiveBrief] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const pagination = summary.pagination?.inquiries || paginationFrom(null, requests.length);
  const stageCounts = inquiryWorkspaceStages.reduce((counts, stage) => ({
    ...counts,
    [stage.value]: requests.filter((item) => (item.status || 'new') === stage.value).length,
  }), {});
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase('en-IN');
  const visibleRequests = requests.filter((item) => {
    if (statusFilter !== 'all' && (item.status || 'new') !== statusFilter) return false;
    if (!normalizedSearch) return true;
    return [
      item.name,
      item.email,
      item.phone,
      item.productType,
      item.category,
      item.description,
      item.idea,
      item.occasion,
      item.budget,
    ].some((value) => String(value || '').toLocaleLowerCase('en-IN').includes(normalizedSearch));
  });
  const resetWorkspaceFilters = () => {
    setStatusFilter('all');
    setSearchQuery('');
  };
  const changeRequestPage = (page) => {
    resetWorkspaceFilters();
    setActiveBrief(null);
    onPageChange(page);
  };

  return (
    <section className={`studio-requests ${loading ? 'is-updating' : ''}`} aria-busy={loading}>
      <header className="studio-requests__hero">
        <div className="studio-requests__intro">
          <p className="eyebrow">Bespoke work</p>
          <h2>Custom request desk</h2>
          <p>Keep every creative conversation moving—from the first idea to an approved studio piece.</p>
        </div>
        <dl className="studio-requests__summary" aria-label="Request summary for this page">
          <div><dt>On this page</dt><dd>{requests.length}</dd></div>
          <div><dt>Need a reply</dt><dd>{stageCounts.new || 0}</dd></div>
          <div><dt>In conversation</dt><dd>{(stageCounts.contacted || 0) + (stageCounts.quoted || 0)}</dd></div>
          <div><dt>Accepted</dt><dd>{stageCounts.accepted || 0}</dd></div>
        </dl>
      </header>

      {requests.length ? (
        <>
          <div className="studio-requests__scope-note">
            <span><Icon name="chart" size={15} /> Current page pipeline</span>
            <small>Stage counts and search cover the {requests.length} {requests.length === 1 ? 'request' : 'requests'} loaded on this page.</small>
            <b><Icon name="arrow" size={14} /> Swipe stages</b>
          </div>
          <div className="studio-requests__pipeline" role="group" aria-label="Filter requests by stage">
            <button type="button" className={statusFilter === 'all' ? 'is-active' : ''} aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              <span className="studio-requests__stage-name">All requests</span>
              <strong>{requests.length}</strong>
              <small>Every conversation</small>
            </button>
            {inquiryWorkspaceStages.map((stage) => (
              <button key={stage.value} type="button" data-stage={stage.value} className={statusFilter === stage.value ? 'is-active' : ''} aria-pressed={statusFilter === stage.value} onClick={() => setStatusFilter(stage.value)}>
                <span className="studio-requests__stage-name">{stage.label}</span>
                <strong>{stageCounts[stage.value] || 0}</strong>
                <small>{stage.description}</small>
              </button>
            ))}
          </div>

          <div className="studio-requests__toolbar">
            <label className="studio-requests__search">
              <span className="visually-hidden">Search requests on this page</span>
              <Icon name="search" size={19} />
              <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search customer, piece, occasion…" />
              {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear request search"><Icon name="close" size={17} /></button>}
            </label>
            <div className="studio-requests__result" aria-live="polite">
              <strong>{visibleRequests.length}</strong>
              <span>{visibleRequests.length === 1 ? 'request' : 'requests'} shown</span>
            </div>
          </div>

          {visibleRequests.length ? (
            <div className="studio-requests__queue" role="list" aria-label="Custom request queue on this page">
              {visibleRequests.map((item, index) => {
                const id = item.id || item._id;
                const brief = item.description || item.idea || 'Open brief';
                const status = item.status || 'new';
                const statusLabel = inquiryStatusOptions.find((option) => option.value === status)?.label || 'New idea';
                const referenceCount = Array.isArray(item.referenceImages) ? item.referenceImages.length : 0;
                return (
                  <article key={id} className="studio-request-card" data-stage={status} role="listitem" style={{ '--request-index': Math.min(index, 8) }}>
                    <div className="studio-request-card__topline">
                      <span className="studio-request-card__status"><i aria-hidden="true" />{statusLabel}</span>
                      <time dateTime={item.createdAt || undefined}>{adminDateLabel(item.createdAt, 'New request')}</time>
                    </div>
                    <div className="studio-request-card__identity">
                      <span aria-hidden="true">{String(item.name || 'S').trim().charAt(0).toLocaleUpperCase('en-IN')}</span>
                      <div>
                        <h3>{item.name || 'Studio customer'}</h3>
                        <p>{item.productType || item.category || 'Custom piece'}</p>
                      </div>
                    </div>
                    <p className="studio-request-card__brief">{brief}</p>
                    <dl className="studio-request-card__details">
                      <div><dt>Budget</dt><dd>{item.budget || 'To discuss'}</dd></div>
                      <div><dt>Needed by</dt><dd>{adminDateLabel(item.neededBy, 'Flexible')}</dd></div>
                      <div><dt>Occasion</dt><dd>{item.occasion || 'Not specified'}</dd></div>
                      <div><dt>Contact</dt><dd>{item.contactPreference || (item.email ? 'Email' : item.phone ? 'Phone' : 'Not supplied')}</dd></div>
                    </dl>
                    {referenceCount > 0 && <p className="studio-request-card__references"><Icon name="upload" size={14} />{referenceCount} {referenceCount === 1 ? 'visual reference' : 'visual references'}</p>}
                    <div className="studio-request-card__actions">
                      <button type="button" className="studio-request-card__open" onClick={() => setActiveBrief(item)} aria-label={`Open complete request from ${item.name || 'customer'}`}>
                        <span>Open request</span><Icon name="arrow" size={16} />
                      </button>
                      <div className="studio-request-card__stage">
                        <span>Move to</span>
                        <AdminStatusDropdown value={status} options={inquiryStatusOptions} disabled={preview || loading} busy={Boolean(workingItems[`inquiry:${id}`])} onChange={(value) => updateInquiryStatus(id, value, { subject: `${item.name || 'Customer'}'s request`, currentStatus: status })} label={`Stage for ${item.name || 'customer'}'s request`} align="end" />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="studio-requests__filtered-empty" role="status">
              <span><Icon name="search" size={24} /></span>
              <div><h3>No requests match this view</h3><p>Try another stage or clear the search to see this page’s conversations.</p></div>
              <button type="button" onClick={resetWorkspaceFilters}>Show all requests</button>
            </div>
          )}
        </>
      ) : <AdminSectionState title="No custom requests yet" message="New customer briefs will appear here as an easy-to-follow studio queue." />}

      <AdminPager pagination={pagination} visibleCount={requests.length} noun="requests" loading={loading} onPageChange={changeRequestPage} />
      <RequestBriefModal request={activeBrief} onHide={() => setActiveBrief(null)} />
    </section>
  );
}

function RequestBriefModal({ request, onHide }) {
  if (!request) return null;
  const brief = request.description || request.idea || 'No written brief was supplied.';
  const referenceHref = safeReferenceHref(request.referenceUrl);
  const references = Array.isArray(request.referenceImages) ? request.referenceImages.filter(Boolean) : [];
  const phoneHref = request.phone ? String(request.phone).replace(/[^\d+]/g, '') : '';
  const statusLabel = inquiryStatusOptions.find((option) => option.value === (request.status || 'new'))?.label || 'New idea';
  const details = [
    ['Piece', request.productType || request.category || 'Custom piece'],
    ['Occasion', request.occasion || 'Not specified'],
    ['Budget', request.budget || 'To discuss'],
    ['Needed by', adminDateLabel(request.neededBy)],
    ['Preferred contact', request.contactPreference || 'No preference'],
    ['Received', adminDateLabel(request.createdAt)],
  ];

  return (
    <Modal show onHide={onHide} size="xl" centered scrollable className="admin-request-modal" aria-labelledby="admin-request-title">
      <Modal.Header closeButton>
        <div className="admin-request-modal__title">
          <p className="eyebrow">Complete custom request</p>
          <Modal.Title id="admin-request-title">{request.name || 'Studio customer'}</Modal.Title>
          <span className={`admin-request-modal__status status-${request.status || 'new'}`}><i aria-hidden="true" />{statusLabel}</span>
        </div>
      </Modal.Header>
      <Modal.Body>
        <div className="admin-request-modal__layout">
          <div className="admin-request-modal__main">
            <section className="admin-request-modal__section" aria-labelledby="request-brief-heading">
              <p className="eyebrow">Their idea</p>
              <h3 id="request-brief-heading">The creative brief</h3>
              <p className="admin-request-modal__brief">{brief}</p>
            </section>
            {request.customization && request.customization !== brief && (
              <section className="admin-request-modal__section" aria-labelledby="request-personalization-heading">
                <p className="eyebrow">Personal details</p>
                <h3 id="request-personalization-heading">Requested personalization</h3>
                <p className="admin-request-modal__brief">{request.customization}</p>
              </section>
            )}
            {(references.length > 0 || referenceHref) && (
              <section className="admin-request-modal__section" aria-labelledby="request-reference-heading">
                <p className="eyebrow">Visual direction</p>
                <h3 id="request-reference-heading">Customer references</h3>
                {references.length > 0 && (
                  <div className="admin-request-modal__images">
                    {references.map((url, index) => (
                      <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open reference image ${index + 1} in a new tab`}>
                        <SmartImage src={optimizeCloudinaryImage(url, 640)} alt={`Reference ${index + 1} from ${request.name || 'customer'}`} loading="lazy" sizes="(max-width: 800px) 44vw, 240px" />
                        <span>Reference {index + 1}</span>
                      </a>
                    ))}
                  </div>
                )}
                {referenceHref && (
                  <a className="admin-request-modal__external" href={referenceHref} target="_blank" rel="noopener noreferrer">
                    <span>Open external inspiration link</span><Icon name="arrow" size={16} />
                  </a>
                )}
              </section>
            )}
          </div>
          <aside className="admin-request-modal__aside" aria-label="Request details and customer contact">
            <section>
              <p className="eyebrow">At a glance</p>
              <dl className="admin-request-modal__facts">
                {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </section>
            <section className="admin-request-modal__contact">
              <p className="eyebrow">Reply to customer</p>
              <h3>{request.name || 'Studio customer'}</h3>
              {request.email && <a href={`mailto:${request.email}`}><Icon name="mail" size={18} /><span><small>Email</small>{request.email}</span></a>}
              {request.phone && phoneHref && <a href={`tel:${phoneHref}`}><Icon name="phone" size={18} /><span><small>Phone</small>{request.phone}</span></a>}
              {!request.email && !request.phone && <p>No contact details were supplied.</p>}
            </section>
          </aside>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-dark" onClick={onHide}>Close request</Button>
      </Modal.Footer>
    </Modal>
  );
}

function Messages({ summary, preview, updateMessageStatus, updateBulkStatus, loading, workingItems, onPageChange }) {
  const messages = summary.messages || [];
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const pagination = summary.pagination?.messages || paginationFrom(null, messages.length);
  const messageIds = messages.filter((message) => (message.status || 'new') === 'new').map((message) => message.id || message._id).filter(Boolean);
  const allSelected = messageIds.length > 0 && messageIds.every((id) => selectedIds.has(String(id)));
  const bulkBusy = [...selectedIds].some((id) => workingItems[`message:${id}`]);
  useEffect(() => {
    const visibleEligible = new Set((summary.messages || [])
      .filter((message) => (message.status || 'new') === 'new')
      .map((message) => message.id || message._id)
      .filter(Boolean)
      .map(String));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleEligible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [summary.messages]);
  return (
    <>
      <div className="admin-section-head"><div><p className="eyebrow">Studio inbox</p><h2>Contact messages</h2><p className="admin-section-copy">Questions from customers, kept calm and easy to scan.</p></div></div>
      {selectedIds.size > 0 && (
        <div className="admin-bulk-actions" role="group" aria-label="Bulk message actions">
          <strong>{bulkBusy ? 'Updating selected messages…' : `${selectedIds.size} selected`}</strong>
          <button type="button" disabled={loading || bulkBusy} onClick={async () => { const result = await updateBulkStatus('message', [...selectedIds], 'read'); setSelectedIds(new Set(result.failedIds)); }}>Mark as read</button>
          <button type="button" className="plain-link" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}
      <AdminTableShell loading={loading}>
        {messages.length ? (
          <Table responsive hover className="admin-table admin-table--stacked admin-message-table" aria-label="Contact messages on this page">
            <thead><tr><th scope="col" className="admin-select-column"><input type="checkbox" checked={allSelected} disabled={bulkBusy || !messageIds.length} onChange={(event) => setSelectedIds(event.target.checked ? new Set(messageIds.map(String)) : new Set())} aria-label={allSelected ? 'Clear all visible messages' : 'Select all visible messages'} /></th><th scope="col">From</th><th scope="col">Subject</th><th scope="col">Message</th><th scope="col">Received</th><th scope="col">Status</th></tr></thead>
            <tbody>{messages.map((message) => {
              const id = message.id || message._id;
              const bulkEligible = (message.status || 'new') === 'new';
              const selected = selectedIds.has(String(id));
              return (
                <tr key={id}>
                  <td data-label="Select" className="admin-select-column"><input type="checkbox" checked={selected} disabled={Boolean(workingItems[`message:${id}`]) || !bulkEligible} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(String(id)); else next.delete(String(id)); return next; })} aria-label={bulkEligible ? `Select message from ${message.name || 'customer'}` : `Message from ${message.name || 'customer'} is already processed`} /></td>
                  <td data-label="From"><strong>{message.name}</strong><a href={`mailto:${message.email}`}>{message.email}</a></td>
                  <td data-label="Subject">{message.subject || 'Studio question'}</td>
                  <td data-label="Message" className="admin-message-cell"><span>{message.message}</span><details className="admin-content-disclosure"><summary>Read full message</summary><p>{message.message}</p></details></td>
                  <td data-label="Received">{message.createdAt ? new Date(message.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
                  <td data-label="Status"><AdminStatusDropdown value={message.status || 'new'} options={messageStatusOptions} disabled={preview || loading} busy={Boolean(workingItems[`message:${id}`])} onChange={(value) => updateMessageStatus(id, value, { subject: `message from ${message.name || 'customer'}`, currentStatus: message.status || 'new' })} label={`Status for message from ${message.name}`} /></td>
                </tr>
              );
            })}</tbody>
          </Table>
        ) : <AdminEmpty text="No contact messages yet." />}
        <AdminPager pagination={pagination} visibleCount={messages.length} noun="messages" loading={loading} onPageChange={onPageChange} />
      </AdminTableShell>
    </>
  );
}

function StatusChangeModal({ change, note, submitting, onNoteChange, onCancel, onConfirm }) {
  const options = change?.kind === 'order'
    ? orderStatusOptions
    : change?.kind === 'inquiry'
      ? inquiryStatusOptions
      : messageStatusOptions;
  const nextLabel = options.find((option) => option.value === change?.status)?.label || change?.status || 'new status';
  const currentLabel = options.find((option) => option.value === change?.currentStatus)?.label || change?.currentStatus || 'current status';
  const terminalOrder = change?.kind === 'order' && ['delivered', 'cancelled'].includes(change.status);
  const noteLimit = change?.kind === 'order' ? 500 : 2000;
  const customerFacing = (
    change?.kind === 'order' && ['confirmed', 'shipped', 'cancelled'].includes(change.status)
  ) || (
    change?.kind === 'inquiry' && ['contacted', 'quoted'].includes(change.status)
  ) || (
    change?.kind === 'message' && change.status === 'replied'
  );

  return (
    <Modal show={Boolean(change)} onHide={onCancel} centered className="admin-confirm-modal" aria-labelledby="admin-status-change-title">
      <Modal.Header closeButton={!submitting}>
        <div><p className="eyebrow">Status update</p><Modal.Title id="admin-status-change-title">{terminalOrder ? `Confirm ${nextLabel.toLowerCase()} status?` : `Move to ${nextLabel}?`}</Modal.Title></div>
      </Modal.Header>
      <Modal.Body>
        <p><strong>{change?.subject || 'This record'}</strong> will move from {currentLabel} to {nextLabel}.{terminalOrder ? ' This is a final workflow step and may not be reversible.' : ''}</p>
        <Form.Group controlId="admin-status-note" className="mt-3">
          <Form.Label>{customerFacing ? 'Message to the customer' : 'Studio note'} <small>optional</small></Form.Label>
          <Form.Control as="textarea" rows={4} maxLength={noteLimit} value={note} disabled={submitting} onChange={(event) => onNoteChange(event.target.value)} placeholder={customerFacing ? 'Add the update, reply, quote or next steps they should receive…' : 'Add context for this status change…'} />
          <Form.Text>{customerFacing ? 'When provided, this note is included in the customer update.' : 'This note is saved with the status change.'} {note.length}/{noteLimit}</Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="outline-dark" onClick={onCancel} disabled={submitting}>Keep {currentLabel.toLowerCase()}</Button>
        <Button type="button" variant={change?.status === 'cancelled' ? 'danger' : 'dark'} onClick={onConfirm} disabled={submitting}>{submitting ? 'Updating…' : `Confirm ${nextLabel}`}</Button>
      </Modal.Footer>
    </Modal>
  );
}

function AdminPager({ pagination, visibleCount, filtered = false, noun, loading, onPageChange }) {
  const page = Math.max(1, Number(pagination?.page || 1));
  const pages = Math.max(1, Number(pagination?.pages || pagination?.totalPages || 1));
  const total = Math.max(0, Number(pagination?.total ?? visibleCount ?? 0));
  const limit = Math.max(1, Number(pagination?.limit || ADMIN_PAGE_LIMIT));
  const first = total ? (page - 1) * limit + 1 : 0;
  const last = Math.min(total, (page - 1) * limit + Number(visibleCount || 0));
  const countLabel = filtered ? `Showing ${first}–${last} of ${total} matching ${noun}` : `Showing ${first}–${last} of ${total} ${noun}`;
  return <footer className="users-pagination admin-collection-pagination"><span>{loading ? 'Loading page…' : countLabel}</span><div><Button type="button" size="sm" variant="outline-dark" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button type="button" size="sm" variant="outline-dark" disabled={loading || page >= pages} onClick={() => onPageChange(page + 1)}>Next</Button></div></footer>;
}

function AdminEmpty({ text, compact = false }) {
  return <div className={`admin-empty ${compact ? 'is-compact' : ''}`}><Icon name="spark" /><p>{text}</p></div>;
}
