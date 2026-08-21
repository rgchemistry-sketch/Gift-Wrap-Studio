import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import Table from 'react-bootstrap/Table';
import Icon from '../Icon';
import { api } from '../../api/client';
import { formatCurrency } from '../../data/catalog';
import AdminSectionState from './AdminSectionState';
import AdminTableShell from './AdminTableShell';

const initialMetrics = { total: 0, newThisMonth: 0, phoneVerified: 0, admins: 0 };

const dateLabel = (value) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const initials = (name, email) => String(name || email || 'Customer').split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
const providerLabel = (provider) => ({ email: 'Email code', google: 'Google' }[provider] || 'Legacy sign-in');

function AccountAvatar({ account }) {
  const source = account.avatar || account.picture || '';
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  if (source && !failed) {
    return <img src={source} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
  }

  return <span className="user-avatar-fallback" aria-hidden="true">{initials(account.name, account.email)}</span>;
}

const providersFor = (account) => {
  const providers = Array.isArray(account.providers) ? account.providers : [];
  if (providers.length) return [...new Set(providers)].filter(Boolean);
  if (account.provider) return [account.provider];
  if (account.googleSub) return ['google'];
  return [];
};

function unpackUsers(result, metricOverride = {}) {
  const payload = result.data || result;
  const users = Array.isArray(payload) ? payload : payload.users || payload.items || [];
  const meta = result.meta || payload.meta || {};
  const sourceMetrics = Object.keys(metricOverride).length
    ? metricOverride
    : payload.metrics || payload.summary || result.metrics || result.summary || meta.metrics || {};
  const hasWorkspaceMetrics = Object.keys(sourceMetrics).length > 0;
  const rawPagination = payload.pagination || result.pagination || meta || {};
  return {
    users,
    metrics: {
      total: Number(sourceMetrics.total ?? sourceMetrics.totalUsers ?? rawPagination.total ?? users.length),
      newThisMonth: Number(sourceMetrics.newThisMonth ?? sourceMetrics.signupsLast30Days ?? sourceMetrics.recentSignups ?? 0),
      phoneVerified: Number(sourceMetrics.phoneVerified ?? sourceMetrics.verifiedPhones ?? users.filter((user) => user.phoneVerified).length),
      admins: Number(sourceMetrics.admins ?? users.filter((user) => user.role === 'admin').length),
    },
    metricScope: {
      total: sourceMetrics.total != null || sourceMetrics.totalUsers != null ? 'workspace' : 'results',
      newThisMonth: sourceMetrics.newThisMonth != null || sourceMetrics.signupsLast30Days != null || sourceMetrics.recentSignups != null ? 'workspace' : 'page',
      phoneVerified: hasWorkspaceMetrics && (sourceMetrics.phoneVerified != null || sourceMetrics.verifiedPhones != null) ? 'workspace' : 'page',
      admins: hasWorkspaceMetrics && sourceMetrics.admins != null ? 'workspace' : 'page',
    },
    pagination: {
      page: Number(rawPagination.page || 1),
      pages: Number(rawPagination.pages || rawPagination.totalPages || 1),
      total: Number(rawPagination.total || users.length),
      limit: Number(rawPagination.limit || 20),
    },
  };
}

export default function UsersManager({ dashboardMetrics = {} }) {
  const [users, setUsers] = useState([]);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [metricScope, setMetricScope] = useState({ total: 'workspace', newThisMonth: 'workspace', phoneVerified: 'page', admins: 'page' });
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const detailPanelRef = useRef(null);
  const detailTriggerRef = useRef(null);
  const selectedId = selected?.id || selected?._id;
  const [mobileDetail, setMobileDetail] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 800px)').matches);

  const loadUsers = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    setLoading(true); setError('');
    try {
      const result = await api.getAdminUsers({ search: submittedQuery, page, limit: 20 });
      if (requestId !== listRequestRef.current) return;
      const unpacked = unpackUsers(result);
      setUsers(unpacked.users); setMetrics(unpacked.metrics); setMetricScope(unpacked.metricScope); setPagination(unpacked.pagination);
    } catch (requestError) {
      if (requestId === listRequestRef.current) setError(requestError.message);
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, [page, submittedQuery]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  useEffect(() => () => {
    listRequestRef.current += 1;
    detailRequestRef.current += 1;
  }, []);

  useEffect(() => {
    const queryList = window.matchMedia('(max-width: 800px)');
    const sync = () => setMobileDetail(queryList.matches);
    sync();
    queryList.addEventListener?.('change', sync);
    return () => queryList.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    if (!selectedId || !mobileDetail) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileDetail, selectedId]);

  const displayedMetrics = {
    total: metrics.total || dashboardMetrics.registeredUsers || dashboardMetrics.users || 0,
    newThisMonth: metrics.newThisMonth || dashboardMetrics.newUsersThisMonth || 0,
    phoneVerified: metrics.phoneVerified,
    admins: metrics.admins,
  };

  const openUser = async (account, trigger) => {
    const requestId = ++detailRequestRef.current;
    detailTriggerRef.current = trigger || document.activeElement;
    setSelected(account); setDetailLoading(true); setDetailError('');
    try {
      const result = await api.getAdminUser(account.id || account._id);
      if (requestId !== detailRequestRef.current) return;
      setSelected(result.data || result.user || result);
    } catch (requestError) {
      if (requestId === detailRequestRef.current) setDetailError(requestError.message);
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedId) return undefined;
    const focusFrame = window.requestAnimationFrame(() => detailPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [selectedId]);

  const closeUser = ({ restoreFocus = true } = {}) => {
    detailRequestRef.current += 1;
    setSelected(null);
    setDetailLoading(false);
    setDetailError('');
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        if (detailTriggerRef.current?.isConnected) detailTriggerRef.current.focus({ preventScroll: true });
      });
    }
  };

  const submitSearch = (event) => {
    event.preventDefault();
    closeUser({ restoreFocus: false });
    setPage(1);
    setSubmittedQuery(query.trim());
  };

  const changePage = (nextPage) => {
    closeUser({ restoreFocus: false });
    setPage(nextPage);
  };

  return <>
    <div className="admin-section-head admin-users-head"><div><p className="eyebrow">Customer registry</p><h2>Registered users</h2><p className="admin-section-copy">Every customer account, verification status and buying relationship.</p></div><div className="admin-search"><Icon name="search"/><form onSubmit={submitSearch}><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or phone" aria-label="Search registered users"/><button type="submit" aria-label="Run user search"><Icon name="arrow" size={15}/></button></form></div></div>
    <div className="user-metrics">
      <article><span><Icon name="user"/></span><p><small>Total accounts{metricScope.total !== 'workspace' ? ' in results' : ''}</small><strong>{displayedMetrics.total.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="spark"/></span><p><small>New this month{metricScope.newThisMonth === 'page' ? ' on this page' : ''}</small><strong>{displayedMetrics.newThisMonth.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="phone"/></span><p><small>Phone verified{metricScope.phoneVerified === 'page' ? ' on this page' : ''}</small><strong>{displayedMetrics.phoneVerified.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="shield"/></span><p><small>Admin accounts{metricScope.admins === 'page' ? ' on this page' : ''}</small><strong>{displayedMetrics.admins.toLocaleString('en-IN')}</strong></p></article>
    </div>
    <div className={`users-workspace ${selected ? 'has-detail' : ''}`}>
      <AdminTableShell className="users-table-panel" loading={loading && users.length > 0}>
        {error && users.length > 0 && <Alert variant="warning" className="soft-alert admin-table-inline-alert">Accounts may be out of date. {error} <button type="button" className="plain-link" onClick={loadUsers}>Retry</button></Alert>}
        {error && !users.length ? <AdminSectionState title="Customer accounts could not load" message={error} actionLabel="Try again" onAction={loadUsers}/> : users.length ? <>
          <Table responsive hover className="admin-table admin-table--stacked users-table" aria-label="Registered customer accounts"><thead><tr><th scope="col">Customer</th><th scope="col">Phone</th><th scope="col">Joined</th><th scope="col">Last sign-in</th><th scope="col">Access</th><th scope="col"><span className="visually-hidden">Open</span></th></tr></thead><tbody>{users.map((account) => {
            const id = account.id || account._id;
            const verifiedPhone = Boolean(account.phoneVerifiedAt || account.phoneVerified || account.isPhoneVerified);
            const expanded = Boolean(selectedId && String(selectedId) === String(id));
            return <tr key={id} className={expanded ? 'is-selected' : ''}><td data-label="Customer"><button type="button" className="user-table-identity" onClick={(event) => openUser(account, event.currentTarget)} aria-label={`View details for ${account.name || account.email}`} aria-expanded={expanded} aria-controls={expanded ? 'admin-user-detail' : undefined}><b><AccountAvatar account={account}/></b><span><strong>{account.name || 'Customer'}</strong><small>{account.email}</small></span></button></td><td data-label="Phone"><span className="user-phone">{account.phone || 'Not added'}{account.phone && <i className={verifiedPhone ? 'is-verified' : ''}>{verifiedPhone ? 'Verified' : 'Pending'}</i>}</span></td><td data-label="Joined">{dateLabel(account.createdAt || account.joinedAt)}</td><td data-label="Last sign-in">{dateLabel(account.lastLoginAt || account.lastSeenAt)}</td><td data-label="Access"><span className={`user-role user-role--${account.role || 'buyer'}`}>{account.role === 'admin' ? 'Admin' : 'Customer'}</span></td><td data-label="Details"><button type="button" className="user-open" onClick={(event) => openUser(account, event.currentTarget)} aria-label={`Open details for ${account.name || account.email}`} aria-expanded={expanded} aria-controls={expanded ? 'admin-user-detail' : undefined}><Icon name="arrow" size={17}/></button></td></tr>;
          })}</tbody></Table>
          {loading && <span className="visually-hidden" role="status">Refreshing customer accounts…</span>}
          <footer className="users-pagination"><span>Showing {pagination.total ? (pagination.page - 1) * pagination.limit + 1 : 0}–{Math.min(pagination.total, (pagination.page - 1) * pagination.limit + users.length)} of {pagination.total ?? displayedMetrics.total} accounts</span><div><Button type="button" size="sm" variant="outline-dark" disabled={loading || Number(pagination.page || page) <= 1} onClick={() => changePage(Math.max(1, page - 1))}>Previous</Button><span>Page {pagination.page || page} of {pagination.pages || 1}</span><Button type="button" size="sm" variant="outline-dark" disabled={loading || Number(pagination.page || page) >= Number(pagination.pages || 1)} onClick={() => changePage(page + 1)}>Next</Button></div></footer>
        </> : loading ? <AdminSectionState loading title="Loading customer accounts" message="Reviewing signups and verification details…"/> : <AdminSectionState title={submittedQuery ? 'No matching accounts' : 'No customer accounts yet'} message={submittedQuery ? 'Try a name, email address or phone number.' : 'New customer signups will appear here.'}/>}
      </AdminTableShell>
      {selected && mobileDetail && <button type="button" className="user-detail-backdrop" onClick={closeUser} aria-label="Close customer detail" />}
      {selected && <UserDetail panelRef={detailPanelRef} account={selected} loading={detailLoading} error={detailError} onClose={closeUser} modal={mobileDetail}/>}
    </div>
  </>;
}

function UserDetail({ account, loading, error, onClose, panelRef, modal = false }) {
  const verifiedPhone = Boolean(account.phoneVerifiedAt || account.phoneVerified || account.isPhoneVerified);
  const verifiedEmail = Boolean(account.emailVerifiedAt || account.emailVerified === true || account.isEmailVerified === true);
  const emailVerificationRecorded = Boolean(account.emailVerifiedAt)
    || typeof account.emailVerified === 'boolean'
    || typeof account.isEmailVerified === 'boolean';
  const address = account.defaultAddress || account.addresses?.[0];
  const providers = providersFor(account);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!modal || event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      const activeIsFocusable = focusable.includes(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !activeIsFocusable)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeIsFocusable)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [modal, onClose, panelRef]);

  return <aside id="admin-user-detail" ref={panelRef} className={`user-detail ${modal ? 'is-mobile-sheet' : ''}`} role={modal ? 'dialog' : 'region'} aria-modal={modal || undefined} tabIndex={-1} aria-labelledby="admin-user-detail-title">
    <header><p className="eyebrow">Customer detail</p><button type="button" onClick={onClose} aria-label="Close customer detail"><Icon name="close"/></button></header>
    <div className="user-detail__identity"><span><AccountAvatar account={account}/></span><h3 id="admin-user-detail-title">{account.name || 'Customer'}</h3><p>{account.email}</p><b className={`user-role user-role--${account.role || 'buyer'}`}>{account.role === 'admin' ? 'Administrator' : 'Customer'}</b></div>
    {loading && <div className="user-detail__loading" role="status"><Spinner animation="border" size="sm"/> Loading account activity…</div>}
    {error && <Alert variant="warning" className="soft-alert">{error}</Alert>}
    <section><h4>Identity & verification</h4><dl><div><dt>Email</dt><dd>{account.email}<span className={verifiedEmail ? 'is-verified' : 'is-pending'}>{verifiedEmail ? 'Verified email' : emailVerificationRecorded ? 'Email not verified' : 'Verification not recorded'}</span></dd></div><div><dt>Sign-in</dt><dd>{providers.length?<span className="identity-provider-list">{providers.map((provider)=><b key={provider}>{providerLabel(provider)}</b>)}</span>:<span>Provider details not recorded</span>}</dd></div><div><dt>Phone</dt><dd>{account.phone || 'Not provided'}{account.phone && <span className={verifiedPhone ? 'is-verified' : 'is-pending'}>{verifiedPhone ? 'Previously verified' : 'Not verified'}</span>}</dd></div></dl></section>
    <section><h4>Customer relationship</h4><div className="user-detail__stats"><p><strong>{account.metrics?.totalOrders ?? account.ordersCount ?? account.orderCount ?? 0}</strong><span>Orders</span></p><p><strong>{formatCurrency(account.metrics?.lifetimeValue ?? account.totalSpent ?? account.lifetimeValue ?? 0)}</strong><span>Lifetime spend</span></p><p><strong>{account.metrics?.customInquiries ?? account.metrics?.customRequests ?? account.customRequestsCount ?? 0}</strong><span>Custom requests</span></p></div></section>
    <section><h4>Account timeline</h4><dl><div><dt>Joined</dt><dd>{dateLabel(account.createdAt || account.joinedAt)}</dd></div><div><dt>Last sign-in</dt><dd>{dateLabel(account.lastLoginAt || account.lastSeenAt)}</dd></div></dl></section>
    {address && <section><h4>Saved delivery address</h4><address>{[address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(', ')}</address></section>}
    {account.recentOrders?.length > 0 && <section><h4>Recent orders</h4><div className="user-detail__orders">{account.recentOrders.slice(0,3).map((order) => <div key={order.id || order._id || order.orderNumber}><span><strong>{order.orderNumber || 'Studio order'}</strong><small>{dateLabel(order.createdAt)}</small></span><b>{formatCurrency(order.total || 0)}</b></div>)}</div></section>}
    <footer><Button as="a" href={`mailto:${account.email}`} variant="dark"><Icon name="mail" size={16}/> Email customer</Button></footer>
  </aside>;
}
