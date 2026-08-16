import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import Table from 'react-bootstrap/Table';
import Icon from '../Icon';
import { api } from '../../api/client';
import { formatCurrency } from '../../data/catalog';
import AdminSectionState from './AdminSectionState';

const initialMetrics = { total: 0, newThisMonth: 0, phoneVerified: 0, admins: 0 };

const dateLabel = (value) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const initials = (name, email) => String(name || email || 'Customer').split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
const providerLabels = { email: 'Email code', google: 'Google', facebook: 'Facebook', apple: 'Apple' };

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
  if (providers.length) return [...new Set(providers)].filter((provider) => providerLabels[provider]);
  if (account.provider && providerLabels[account.provider]) return [account.provider];
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
  const rawPagination = payload.pagination || result.pagination || meta || {};
  return {
    users,
    metrics: {
      total: Number(sourceMetrics.total ?? sourceMetrics.totalUsers ?? rawPagination.total ?? users.length),
      newThisMonth: Number(sourceMetrics.newThisMonth ?? sourceMetrics.signupsLast30Days ?? sourceMetrics.recentSignups ?? 0),
      phoneVerified: Number(sourceMetrics.phoneVerified ?? sourceMetrics.verifiedPhones ?? users.filter((user) => user.phoneVerified).length),
      admins: Number(sourceMetrics.admins ?? users.filter((user) => user.role === 'admin').length),
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
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const detailRequestRef = useRef(0);
  const detailPanelRef = useRef(null);
  const detailTriggerRef = useRef(null);
  const selectedId = selected?.id || selected?._id;

  const loadUsers = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api.getAdminUsers({ search: submittedQuery, page, limit: 20 });
      const unpacked = unpackUsers(result);
      setUsers(unpacked.users); setMetrics(unpacked.metrics); setPagination(unpacked.pagination);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [page, submittedQuery]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

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
        if (detailTriggerRef.current?.isConnected) detailTriggerRef.current.focus();
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
      <article><span><Icon name="user"/></span><p><small>Total accounts</small><strong>{displayedMetrics.total.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="spark"/></span><p><small>New this month</small><strong>{displayedMetrics.newThisMonth.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="phone"/></span><p><small>Phone verified</small><strong>{displayedMetrics.phoneVerified.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="shield"/></span><p><small>Admin accounts</small><strong>{displayedMetrics.admins.toLocaleString('en-IN')}</strong></p></article>
    </div>
    <div className={`users-workspace ${selected ? 'has-detail' : ''}`}>
      <div className="admin-panel admin-table-panel users-table-panel">
        {loading ? <AdminSectionState loading title="Loading customer accounts" message="Reviewing signups and verification details…"/> : error ? <AdminSectionState title="Customer accounts could not load" message={error} actionLabel="Try again" onAction={loadUsers}/> : users.length ? <>
          <Table responsive hover className="admin-table users-table"><thead><tr><th>Customer</th><th>Phone</th><th>Joined</th><th>Last sign-in</th><th>Access</th><th><span className="visually-hidden">Open</span></th></tr></thead><tbody>{users.map((account) => {
            const id = account.id || account._id;
            const verifiedPhone = Boolean(account.phoneVerifiedAt || account.phoneVerified || account.isPhoneVerified);
            const expanded = Boolean(selectedId && String(selectedId) === String(id));
            return <tr key={id} className={expanded ? 'is-selected' : ''}><td><button type="button" className="user-table-identity" onClick={(event) => openUser(account, event.currentTarget)} aria-label={`View details for ${account.name || account.email}`} aria-expanded={expanded} aria-controls={expanded ? 'admin-user-detail' : undefined}><b><AccountAvatar account={account}/></b><span><strong>{account.name || 'Customer'}</strong><small>{account.email}</small></span></button></td><td><span className="user-phone">{account.phone || 'Not added'}{account.phone && <i className={verifiedPhone ? 'is-verified' : ''}>{verifiedPhone ? 'Verified' : 'Pending'}</i>}</span></td><td>{dateLabel(account.createdAt || account.joinedAt)}</td><td>{dateLabel(account.lastLoginAt || account.lastSeenAt)}</td><td><span className={`user-role user-role--${account.role || 'buyer'}`}>{account.role === 'admin' ? 'Admin' : 'Customer'}</span></td><td><button type="button" className="user-open" onClick={(event) => openUser(account, event.currentTarget)} aria-label={`View ${account.name || account.email}`} aria-expanded={expanded} aria-controls={expanded ? 'admin-user-detail' : undefined}><Icon name="arrow" size={17}/></button></td></tr>;
          })}</tbody></Table>
          <footer className="users-pagination"><span>Showing {pagination.total ? (pagination.page - 1) * pagination.limit + 1 : 0}–{Math.min(pagination.total, (pagination.page - 1) * pagination.limit + users.length)} of {pagination.total ?? displayedMetrics.total} accounts</span><div><Button type="button" size="sm" variant="outline-dark" disabled={Number(pagination.page || page) <= 1} onClick={() => changePage(Math.max(1, page - 1))}>Previous</Button><span>Page {pagination.page || page} of {pagination.pages || 1}</span><Button type="button" size="sm" variant="outline-dark" disabled={Number(pagination.page || page) >= Number(pagination.pages || 1)} onClick={() => changePage(page + 1)}>Next</Button></div></footer>
        </> : <AdminSectionState title={submittedQuery ? 'No matching accounts' : 'No customer accounts yet'} message={submittedQuery ? 'Try a name, email address or phone number.' : 'New customer signups will appear here.'}/>}
      </div>
      {selected && <UserDetail panelRef={detailPanelRef} account={selected} loading={detailLoading} error={detailError} onClose={closeUser}/>}
    </div>
  </>;
}

function UserDetail({ account, loading, error, onClose, panelRef }) {
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
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <aside id="admin-user-detail" ref={panelRef} className="user-detail" role="region" tabIndex={-1} aria-labelledby="admin-user-detail-title">
    <header><p className="eyebrow">Customer detail</p><button type="button" onClick={onClose} aria-label="Close customer detail"><Icon name="close"/></button></header>
    <div className="user-detail__identity"><span><AccountAvatar account={account}/></span><h3 id="admin-user-detail-title">{account.name || 'Customer'}</h3><p>{account.email}</p><b className={`user-role user-role--${account.role || 'buyer'}`}>{account.role === 'admin' ? 'Administrator' : 'Customer'}</b></div>
    {loading && <div className="user-detail__loading" role="status"><Spinner animation="border" size="sm"/> Loading account activity…</div>}
    {error && <Alert variant="warning" className="soft-alert">{error}</Alert>}
    <section><h4>Identity & verification</h4><dl><div><dt>Email</dt><dd>{account.email}<span className={verifiedEmail ? 'is-verified' : 'is-pending'}>{verifiedEmail ? 'Verified email' : emailVerificationRecorded ? 'Email not verified' : 'Verification not recorded'}</span></dd></div><div><dt>Sign-in</dt><dd>{providers.length?<span className="identity-provider-list">{providers.map((provider)=><b key={provider}>{providerLabels[provider]}</b>)}</span>:<span>Provider details not recorded</span>}</dd></div><div><dt>Phone</dt><dd>{account.phone || 'Not provided'}{account.phone && <span className={verifiedPhone ? 'is-verified' : 'is-pending'}>{verifiedPhone ? 'OTP verified' : 'Verification pending'}</span>}</dd></div></dl></section>
    <section><h4>Customer relationship</h4><div className="user-detail__stats"><p><strong>{account.metrics?.totalOrders ?? account.ordersCount ?? account.orderCount ?? 0}</strong><span>Orders</span></p><p><strong>{formatCurrency(account.metrics?.lifetimeValue ?? account.totalSpent ?? account.lifetimeValue ?? 0)}</strong><span>Lifetime spend</span></p><p><strong>{account.metrics?.customInquiries ?? account.metrics?.customRequests ?? account.customRequestsCount ?? 0}</strong><span>Custom requests</span></p></div></section>
    <section><h4>Account timeline</h4><dl><div><dt>Joined</dt><dd>{dateLabel(account.createdAt || account.joinedAt)}</dd></div><div><dt>Last sign-in</dt><dd>{dateLabel(account.lastLoginAt || account.lastSeenAt)}</dd></div></dl></section>
    {address && <section><h4>Saved delivery address</h4><address>{[address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(', ')}</address></section>}
    {account.recentOrders?.length > 0 && <section><h4>Recent orders</h4><div className="user-detail__orders">{account.recentOrders.slice(0,3).map((order) => <div key={order.id || order._id || order.orderNumber}><span><strong>{order.orderNumber || 'Studio order'}</strong><small>{dateLabel(order.createdAt)}</small></span><b>{formatCurrency(order.total || 0)}</b></div>)}</div></section>}
    <footer><Button as="a" href={`mailto:${account.email}`} variant="dark"><Icon name="mail" size={16}/> Email customer</Button></footer>
  </aside>;
}
