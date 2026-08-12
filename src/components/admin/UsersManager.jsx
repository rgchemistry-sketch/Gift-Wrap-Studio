import { useCallback, useEffect, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import Table from 'react-bootstrap/Table';
import Icon from '../Icon';
import { api } from '../../api/client';
import { formatCurrency } from '../../data/catalog';
import AdminSectionState from './AdminSectionState';

const initialMetrics = { total: 0, newThisMonth: 0, phoneVerified: 0, admins: 0 };

const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded';
const initials = (name, email) => String(name || email || 'Customer').split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();

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
    },
  };
}

export default function UsersManager({ dashboardMetrics = {} }) {
  const [users, setUsers] = useState([]);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const openUser = async (account) => {
    setSelected(account); setDetailLoading(true); setDetailError('');
    try {
      const result = await api.getAdminUser(account.id || account._id);
      setSelected(result.data || result.user || result);
    } catch (requestError) { setDetailError(requestError.message); }
    finally { setDetailLoading(false); }
  };

  return <>
    <div className="admin-section-head admin-users-head"><div><p className="eyebrow">Customer registry</p><h2>Registered users</h2><p className="admin-section-copy">Every customer account, verification status and buying relationship.</p></div><div className="admin-search"><Icon name="search"/><form onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or phone" aria-label="Search registered users"/></form></div></div>
    <div className="user-metrics">
      <article><span><Icon name="user"/></span><p><small>Total accounts</small><strong>{displayedMetrics.total.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="spark"/></span><p><small>New this month</small><strong>{displayedMetrics.newThisMonth.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="phone"/></span><p><small>Phone verified</small><strong>{displayedMetrics.phoneVerified.toLocaleString('en-IN')}</strong></p></article>
      <article><span><Icon name="shield"/></span><p><small>Admin accounts</small><strong>{displayedMetrics.admins.toLocaleString('en-IN')}</strong></p></article>
    </div>
    {error && <Alert variant="danger" className="soft-alert">{error} <button type="button" className="plain-link" onClick={loadUsers}>Retry</button></Alert>}
    <div className={`users-workspace ${selected ? 'has-detail' : ''}`}>
      <div className="admin-panel admin-table-panel users-table-panel">
        {loading ? <AdminSectionState loading title="Loading customer accounts" message="Reviewing signups and verification details…"/> : users.length ? <>
          <Table responsive hover className="admin-table users-table"><thead><tr><th>Customer</th><th>Phone</th><th>Joined</th><th>Last sign-in</th><th>Access</th><th><span className="visually-hidden">Open</span></th></tr></thead><tbody>{users.map((account) => {
            const id = account.id || account._id;
            const verifiedPhone = account.phoneVerified || account.isPhoneVerified;
            return <tr key={id} className={selected && (selected.id || selected._id) === id ? 'is-selected' : ''} onClick={() => openUser(account)}><td><span className="user-table-identity"><b>{account.avatar || account.picture ? <img src={account.avatar || account.picture} alt=""/> : initials(account.name, account.email)}</b><span><strong>{account.name || 'Customer'}</strong><small>{account.email}</small></span></span></td><td><span className="user-phone">{account.phone || 'Not added'}{account.phone && <i className={verifiedPhone ? 'is-verified' : ''}>{verifiedPhone ? 'Verified' : 'Pending'}</i>}</span></td><td>{dateLabel(account.createdAt || account.joinedAt)}</td><td>{dateLabel(account.lastLoginAt || account.lastSeenAt)}</td><td><span className={`user-role user-role--${account.role || 'buyer'}`}>{account.role === 'admin' ? 'Admin' : 'Customer'}</span></td><td><button type="button" className="user-open" onClick={(event) => { event.stopPropagation(); openUser(account); }} aria-label={`View ${account.name || account.email}`}><Icon name="arrow" size={17}/></button></td></tr>;
          })}</tbody></Table>
          <footer className="users-pagination"><span>Showing {users.length} of {pagination.total ?? displayedMetrics.total} accounts</span><div><Button type="button" size="sm" variant="outline-dark" disabled={Number(pagination.page || page) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><span>Page {pagination.page || page} of {pagination.pages || 1}</span><Button type="button" size="sm" variant="outline-dark" disabled={Number(pagination.page || page) >= Number(pagination.pages || 1)} onClick={() => setPage((current) => current + 1)}>Next</Button></div></footer>
        </> : <AdminSectionState title={submittedQuery ? 'No matching accounts' : 'No customer accounts yet'} message={submittedQuery ? 'Try a name, email address or phone number.' : 'New customer signups will appear here.'}/>}
      </div>
      {selected && <UserDetail account={selected} loading={detailLoading} error={detailError} onClose={() => setSelected(null)}/>}
    </div>
  </>;
}

function UserDetail({ account, loading, error, onClose }) {
  const verifiedPhone = account.phoneVerified || account.isPhoneVerified;
  const address = account.defaultAddress || account.addresses?.[0];
  return <aside className="user-detail" aria-label={`Details for ${account.name || account.email}`}>
    <header><p className="eyebrow">Customer detail</p><button type="button" onClick={onClose} aria-label="Close customer detail"><Icon name="close"/></button></header>
    <div className="user-detail__identity"><span>{account.avatar || account.picture ? <img src={account.avatar || account.picture} alt=""/> : initials(account.name, account.email)}</span><h3>{account.name || 'Customer'}</h3><p>{account.email}</p><b className={`user-role user-role--${account.role || 'buyer'}`}>{account.role === 'admin' ? 'Administrator' : 'Customer'}</b></div>
    {loading && <div className="user-detail__loading"><Spinner animation="border" size="sm"/> Loading account activity…</div>}
    {error && <Alert variant="warning" className="soft-alert">{error}</Alert>}
    <section><h4>Identity & verification</h4><dl><div><dt>Email</dt><dd>{account.email}<span className="is-verified">Google verified</span></dd></div><div><dt>Phone</dt><dd>{account.phone || 'Not provided'}{account.phone && <span className={verifiedPhone ? 'is-verified' : 'is-pending'}>{verifiedPhone ? 'OTP verified' : 'Verification pending'}</span>}</dd></div></dl></section>
    <section><h4>Customer relationship</h4><div className="user-detail__stats"><p><strong>{account.metrics?.totalOrders ?? account.ordersCount ?? account.orderCount ?? 0}</strong><span>Orders</span></p><p><strong>{formatCurrency(account.metrics?.lifetimeValue ?? account.totalSpent ?? account.lifetimeValue ?? 0)}</strong><span>Lifetime spend</span></p><p><strong>{account.metrics?.customInquiries ?? account.metrics?.customRequests ?? account.customRequestsCount ?? 0}</strong><span>Custom requests</span></p></div></section>
    <section><h4>Account timeline</h4><dl><div><dt>Joined</dt><dd>{dateLabel(account.createdAt || account.joinedAt)}</dd></div><div><dt>Last sign-in</dt><dd>{dateLabel(account.lastLoginAt || account.lastSeenAt)}</dd></div></dl></section>
    {address && <section><h4>Saved delivery address</h4><address>{[address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(', ')}</address></section>}
    {account.recentOrders?.length > 0 && <section><h4>Recent orders</h4><div className="user-detail__orders">{account.recentOrders.slice(0,3).map((order) => <div key={order.id || order._id || order.orderNumber}><span><strong>{order.orderNumber || 'Studio order'}</strong><small>{dateLabel(order.createdAt)}</small></span><b>{formatCurrency(order.total || 0)}</b></div>)}</div></section>}
    <footer><Button as="a" href={`mailto:${account.email}`} variant="dark"><Icon name="mail" size={16}/> Email customer</Button></footer>
  </aside>;
}
