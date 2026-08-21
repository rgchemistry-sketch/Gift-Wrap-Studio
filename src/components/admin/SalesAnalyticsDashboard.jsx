import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { formatCurrency } from '../../data/catalog';
import {
  analyticsDateRangeError,
  chartAxisLabelIndexes,
  chartGeometry,
  chartMinimumWidth,
  chartSummary,
  compactChartLabel,
  hasAnalyticsActivity,
  hasChartRevenue,
  normalizeAnalyticsFilter,
  normalizeSalesAnalytics,
  salesExportWorkbookCopy,
  salesFinancialLabels,
  salesAnalyticsErrorMessage,
} from '../../utils/sales-analytics';
import Icon from '../Icon';
import '../../sales-analytics.css';

const RANGE_OPTIONS = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
];
const SPARSE_CHART_INSETS = Object.freeze({ top: 34, right: 20, bottom: 58, left: 70 });
const DENSE_CHART_INSETS = Object.freeze({ top: 34, right: 24, bottom: 58, left: 84 });

const numberFormat = new Intl.NumberFormat('en-IN');
const percentageFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const axisCurrencyFormat = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  currencyDisplay: 'narrowSymbol',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const formatNumber = (value) => numberFormat.format(Number(value) || 0);
const formatPercent = (value) => `${percentageFormat.format(Number(value) || 0)}%`;
const formatAxisCurrency = (value) => axisCurrencyFormat.format(Number(value) || 0);
const countLabel = (value, singular, plural = `${singular}s`) => `${formatNumber(value)} ${Number(value) === 1 ? singular : plural}`;

const formatDate = (value, fallback = 'Not available') => {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
};

const statusLabel = (status) => String(status || 'unknown')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

const maskEmail = (value) => {
  const [local, domain] = String(value || '').split('@');
  if (!local || !domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.min(4, Math.max(2, local.length - visible.length)))}@${domain}`;
};

const changeLabel = (value) => {
  if (value === null || value === undefined) return { text: 'No previous comparison', direction: 'neutral' };
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return { text: 'No change vs previous', direction: 'neutral' };
  return {
    text: `${number > 0 ? '↑' : '↓'} ${percentageFormat.format(Math.abs(number))}% vs previous`,
    direction: number > 0 ? 'up' : 'down',
  };
};

const safeShare = (value) => Math.min(100, Math.max(0, Number(value) || 0));

const todayInIndia = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

function Comparison({ value }) {
  const change = changeLabel(value);
  return <span className={`sales-kpi__change is-${change.direction}`}>{change.text}</span>;
}

function SalesChart({ analytics }) {
  const titleId = `${useId().replaceAll(':', '')}-title`;
  const descriptionId = `${useId().replaceAll(':', '')}-description`;
  const gradientId = `${useId().replaceAll(':', '')}-gradient`;
  const glowId = `${useId().replaceAll(':', '')}-glow`;
  const [activeIndex, setActiveIndex] = useState(null);
  const [cursorIndex, setCursorIndex] = useState(Number.MAX_SAFE_INTEGER);
  const pointRefs = useRef([]);
  const series = analytics.series;
  const sparseChart = series.length <= 3;
  const chartWidth = sparseChart ? 360 : 880;
  const chartHeight = sparseChart ? 300 : 356;
  const chartInsets = sparseChart ? SPARSE_CHART_INSETS : DENSE_CHART_INSETS;
  const geometry = useMemo(
    () => chartGeometry(series, { width: chartWidth, height: chartHeight, insets: chartInsets }),
    [chartHeight, chartInsets, chartWidth, series],
  );
  const summary = chartSummary(series, formatCurrency);
  const labelIndexes = useMemo(() => new Set(chartAxisLabelIndexes(series, {
    width: chartWidth,
    left: chartInsets.left,
    right: chartInsets.right,
    maximumLabels: sparseChart ? 3 : 7,
  })), [chartInsets.left, chartInsets.right, chartWidth, series, sparseChart]);
  const gridValues = Array.from({ length: 6 }, (_, index) => geometry.maxValue * (1 - index / 5));
  const lastIndex = Math.max(0, series.length - 1);
  const resolvedCursorIndex = Math.min(cursorIndex, lastIndex);
  const resolvedActiveIndex = activeIndex === null ? null : Math.min(activeIndex, lastIndex);
  const selectedIndex = resolvedActiveIndex ?? resolvedCursorIndex;
  const selected = series[selectedIndex];
  const activePoint = resolvedActiveIndex === null ? null : geometry.points[resolvedActiveIndex];
  const pointGap = series.length > 1 ? geometry.plot.width / (series.length - 1) : 96;
  const hitWidth = Math.min(100, Math.max(44, pointGap));
  const tooltipWidth = 208;
  const tooltipHeight = 82;
  const minimumChartWidth = chartMinimumWidth(series.length);
  const tooltipX = activePoint
    ? Math.max(geometry.plot.left, Math.min(geometry.plot.rightEdge - tooltipWidth, activePoint.x - tooltipWidth / 2))
    : 0;
  const tooltipY = activePoint && activePoint.y < geometry.plot.top + tooltipHeight + 20
    ? activePoint.y + 18
    : Math.max(geometry.plot.top + 8, (activePoint?.y || 0) - tooltipHeight - 18);
  const focusPoint = (index) => {
    const nextIndex = Math.max(0, Math.min(lastIndex, index));
    setCursorIndex(nextIndex);
    setActiveIndex(nextIndex);
    pointRefs.current[nextIndex]?.focus();
  };
  const handlePointKeyDown = (event, index) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setCursorIndex(index);
      setActiveIndex(index);
      return;
    }
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextIndex = Math.min(lastIndex, index + 1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextIndex = Math.max(0, index - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null) return;
    event.preventDefault();
    focusPoint(nextIndex);
  };

  if (!series.length) {
    return <p className="sales-chart-empty">No time-series points are available for this period.</p>;
  }

  if (!hasChartRevenue(series)) {
    return (
      <div className="sales-chart-zero" role="status">
        <span className="sales-chart-zero__mark" aria-hidden="true"><Icon name="chart" size={24} /></span>
        <div>
          <p className="eyebrow">Zero booked revenue</p>
          <h5>No orders count as booked sales in this period.</h5>
          <p>Cancelled, refunded and failed-payment activity is still included in the order pipeline and financial context below.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sales-chart-wrap">
      <div className="sales-chart__legend" aria-label="Chart legend">
        <span><i className="is-booked" aria-hidden="true" /><span>Booked</span><strong>{formatCurrency(analytics.kpis.bookedSales)}</strong></span>
        <span><i className="is-paid" aria-hidden="true" /><span>Paid</span><strong>{formatCurrency(analytics.kpis.paidSales)}</strong></span>
      </div>
      <div className="sales-chart-scroll" tabIndex="0" role="region" aria-label="Scrollable booked sales chart">
        <svg
          className={sparseChart ? 'sales-chart is-sparse' : 'sales-chart'}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={minimumChartWidth ? { '--sales-chart-min-width': `${minimumChartWidth}px` } : undefined}
          role="group"
          aria-roledescription="interactive sales chart"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>Booked sales and paid sales over time</title>
          <desc id={descriptionId}>{summary}</desc>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7b2944" stopOpacity=".28" />
              <stop offset="72%" stopColor="#b97184" stopOpacity=".07" />
              <stop offset="100%" stopColor="#fffaf2" stopOpacity="0" />
            </linearGradient>
            <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#5b1e32" floodOpacity=".22" />
            </filter>
          </defs>
          <text className="sales-chart__axis-title" x={geometry.plot.left} y="18">Order value (INR)</text>
          {gridValues.map((value, index) => {
            const y = geometry.plot.top + (geometry.plot.height * index) / 5;
            return (
              <g key={value} className="sales-chart__grid">
                <line x1={geometry.plot.left} x2={geometry.plot.rightEdge} y1={y} y2={y} />
                <text x={geometry.plot.left - 12} y={y + 4} textAnchor="end">{formatAxisCurrency(value)}</text>
              </g>
            );
          })}
          {activePoint && <rect className="sales-chart__active-band" x={activePoint.x - hitWidth / 2} y={geometry.plot.top} width={hitWidth} height={geometry.plot.height} />}
          <path className="sales-chart__area" d={geometry.areaPath} fill={`url(#${gradientId})`} />
          <path className="sales-chart__booked" d={geometry.linePath} />
          <path className="sales-chart__paid" d={geometry.paidPath} />
          {geometry.paidPoints.map((point, index) => <circle key={`paid-${point.datum.period}-${index}`} className="sales-chart__paid-point" cx={point.x} cy={point.y} r={resolvedActiveIndex === index ? 4.5 : 2.5} />)}
          {geometry.points.map((point, index) => (
            <g
              key={`${point.datum.period}-${index}`}
              className={resolvedActiveIndex === index ? 'sales-chart__datum is-active' : 'sales-chart__datum'}
              ref={(node) => { pointRefs.current[index] = node; }}
              tabIndex={resolvedCursorIndex === index ? 0 : -1}
              focusable="true"
              role="button"
              aria-pressed={resolvedCursorIndex === index}
              aria-label={`${point.datum.label}: ${formatCurrency(point.datum.bookedSales)} booked, ${formatCurrency(point.datum.paidSales)} paid, ${countLabel(point.datum.orders, 'order')}`}
              onPointerEnter={() => setActiveIndex(index)}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') setActiveIndex(null); }}
              onPointerDown={() => { setCursorIndex(index); setActiveIndex(index); }}
              onClick={() => { setCursorIndex(index); setActiveIndex(index); }}
              onFocus={() => { setCursorIndex(index); setActiveIndex(index); }}
              onBlur={() => setActiveIndex(null)}
              onKeyDown={(event) => handlePointKeyDown(event, index)}
            >
              <rect className="sales-chart__hit-area" x={point.x - hitWidth / 2} y={geometry.plot.top} width={hitWidth} height={geometry.plot.height} />
              <circle className="sales-chart__point-halo" cx={point.x} cy={point.y} r="10" />
              <circle className="sales-chart__point" cx={point.x} cy={point.y} r={resolvedActiveIndex === index ? 5.5 : 4} filter={resolvedActiveIndex === index ? `url(#${glowId})` : undefined} />
              <title>{`${point.datum.label}: ${formatCurrency(point.datum.bookedSales)} booked across ${formatNumber(point.datum.orders)} orders`}</title>
            </g>
          ))}
          {geometry.points.map((point, index) => labelIndexes.has(index) && (
            <text
              key={`label-${point.datum.period}-${index}`}
              className="sales-chart__label"
              x={point.x}
              y={geometry.plot.bottomEdge + 30}
              textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}
            >
              <title>{point.datum.label}</title>
              {compactChartLabel(point.datum.label)}
            </text>
          ))}
          {activePoint && (
            <g className="sales-chart__tooltip" transform={`translate(${tooltipX} ${tooltipY})`} aria-hidden="true">
              <rect width={tooltipWidth} height={tooltipHeight} rx="10" />
              <text className="sales-chart__tooltip-period" x="13" y="20">{compactChartLabel(activePoint.datum.label)}</text>
              <text x="13" y="43"><tspan>Booked</tspan><tspan x={tooltipWidth - 13} textAnchor="end">{formatCurrency(activePoint.datum.bookedSales)}</tspan></text>
              <text x="13" y="64"><tspan>Paid</tspan><tspan x={tooltipWidth - 13} textAnchor="end">{formatCurrency(activePoint.datum.paidSales)}</tspan></text>
            </g>
          )}
        </svg>
      </div>
      <p className="sales-chart__summary">{summary}</p>
      <div className="sales-chart__selection" aria-live={resolvedActiveIndex === null ? 'off' : 'polite'} aria-atomic="true">
        <span><small>{resolvedActiveIndex === null ? 'Latest period' : 'Selected period'}</small><strong>{selected.label}</strong></span>
        <span><small>Booked</small><strong>{formatCurrency(selected.bookedSales)}</strong></span>
        <span><small>Paid</small><strong>{formatCurrency(selected.paidSales)}</strong></span>
        <span><small>Orders</small><strong>{formatNumber(selected.orders)}</strong></span>
      </div>
      <details className="sales-chart-data">
        <summary><span>View source data</span><small>{countLabel(series.length, 'period')}</small></summary>
        <div className="sales-chart-data__scroll" tabIndex="0" role="region" aria-label="Sales chart data table">
          <table>
            <caption className="visually-hidden">Booked, paid and pending sales by period</caption>
            <thead><tr><th scope="col">Period</th><th scope="col">Booked</th><th scope="col">Paid</th><th scope="col">Pending</th><th scope="col">Orders</th></tr></thead>
            <tbody>{series.map((point) => <tr key={point.period}><th scope="row">{point.label}</th><td>{formatCurrency(point.bookedSales)}</td><td>{formatCurrency(point.paidSales)}</td><td>{formatCurrency(point.pendingPaymentSales)}</td><td>{formatNumber(point.orders)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="sales-analytics-skeleton" role="status" aria-live="polite">
      <div className="sales-analytics-skeleton__kpis">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>
      <div className="sales-analytics-skeleton__chart" />
      <span className="visually-hidden">Loading live sales analysis…</span>
    </div>
  );
}

function PaymentComposition({ kpis }) {
  const booked = Math.max(0, kpis.bookedSales);
  const paidWidth = booked ? (kpis.paidSales / booked) * 100 : 0;
  const pendingWidth = booked ? (kpis.pendingPaymentSales / booked) * 100 : 0;
  const otherWidth = booked ? (kpis.otherPaymentSales / booked) * 100 : 0;
  return (
    <aside className="sales-payment" aria-labelledby="payment-composition-title">
      <p className="eyebrow">Payment context</p>
      <h4 id="payment-composition-title">Booked is not collected</h4>
      <p>Payment is confirmed separately. Most manual-payment orders may remain pending.</p>
      <div className="sales-payment__track" role="img" aria-label={`${formatCurrency(kpis.paidSales)} paid, ${formatCurrency(kpis.pendingPaymentSales)} pending confirmation${kpis.otherPaymentSales ? `, ${formatCurrency(kpis.otherPaymentSales)} in other payment states` : ''}`}>
        <span className="is-paid" style={{ width: `${Math.min(100, paidWidth)}%` }} />
        <span className="is-pending" style={{ width: `${Math.min(100, pendingWidth)}%` }} />
        {otherWidth > 0 && <span className="is-other" style={{ width: `${Math.min(100, otherWidth)}%` }} />}
      </div>
      <dl>
        <div><dt><i className="is-paid" /> Paid</dt><dd>{formatCurrency(kpis.paidSales)}</dd></div>
        <div><dt><i className="is-pending" /> Awaiting confirmation</dt><dd>{formatCurrency(kpis.pendingPaymentSales)}</dd></div>
        {kpis.otherPaymentSales > 0 && <div><dt><i className="is-other" /> Other payment states</dt><dd>{formatCurrency(kpis.otherPaymentSales)}</dd></div>}
        <div><dt>{salesFinancialLabels.cancelledOrderValue}</dt><dd>{formatCurrency(kpis.cancelledValue)}</dd></div>
        {kpis.refundedValue > 0 && <div><dt>{salesFinancialLabels.refundedOrderValue}</dt><dd>{formatCurrency(kpis.refundedValue)}</dd></div>}
        {kpis.failedPaymentValue > 0 && <div><dt>{salesFinancialLabels.failedPaymentOrderValue}</dt><dd>{formatCurrency(kpis.failedPaymentValue)}</dd></div>}
      </dl>
    </aside>
  );
}

function EmptyAnalytics() {
  return (
    <div className="sales-analytics-empty" role="status">
      <span aria-hidden="true"><Icon name="spark" size={24} /></span>
      <div><h4>No sales in this view yet</h4><p>Try a wider date range. Cancelled, refunded and failed-payment orders remain excluded.</p></div>
    </div>
  );
}

export function SalesOverviewSnapshot({ onAuthorizationFailure, onOpenSales }) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const loadSnapshot = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.getAdminSalesAnalytics({ range: 'month' });
      if (requestId !== requestRef.current) return;
      setAnalytics(normalizeSalesAnalytics(result));
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      if (onAuthorizationFailure?.(requestError)) return;
      setError(salesAnalyticsErrorMessage(requestError, 'The sales pulse could not be loaded.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [onAuthorizationFailure]);

  useEffect(() => {
    void loadSnapshot();
    return () => { requestRef.current += 1; };
  }, [loadSnapshot]);

  const period = analytics?.filter?.from && analytics?.filter?.to
    ? `${formatDate(analytics.filter.from)} – ${formatDate(analytics.filter.to)}`
    : 'This month';
  const topProduct = analytics?.products?.[0];

  return (
    <section className="admin-sales-snapshot" aria-labelledby="admin-sales-snapshot-title" aria-busy={loading}>
      <header className="admin-sales-snapshot__head">
        <div>
          <p className="eyebrow">Month-to-date pulse</p>
          <h3 id="admin-sales-snapshot-title">Sales at a glance</h3>
          <small>{period} · IST</small>
        </div>
        <button type="button" className="admin-sales-snapshot__open" onClick={onOpenSales}>
          Open sales analysis <Icon name="arrow" size={16} />
        </button>
      </header>

      {loading && !analytics ? (
        <div className="admin-sales-snapshot__skeleton" role="status" aria-live="polite">
          {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
          <span className="visually-hidden">Loading this month’s sales pulse…</span>
        </div>
      ) : error && !analytics ? (
        <div className="admin-sales-snapshot__error" role="alert">
          <span><strong>Sales pulse unavailable.</strong><small>Your orders and other admin sections remain available.</small></span>
          <button type="button" onClick={loadSnapshot}>Try again</button>
        </div>
      ) : analytics ? (
        <>
          {error && <div className="admin-sales-snapshot__stale" role="alert"><span>Showing the last available figures.</span><button type="button" onClick={loadSnapshot}>Refresh</button></div>}
          <div className="admin-sales-snapshot__metrics">
            <article>
              <small>Booked sales</small>
              <strong>{formatCurrency(analytics.kpis.bookedSales)}</strong>
              <Comparison value={analytics.changePct.bookedSales} />
            </article>
            <article>
              <small>Paid</small>
              <strong>{formatCurrency(analytics.kpis.paidSales)}</strong>
              <span>{formatCurrency(analytics.kpis.pendingPaymentSales)} awaiting confirmation</span>
            </article>
            <article>
              <small>Booked orders</small>
              <strong>{formatNumber(analytics.kpis.orders)}</strong>
              <span>{formatNumber(analytics.kpis.customers)} customers · {formatNumber(analytics.kpis.units)} units</span>
            </article>
          </div>
          <footer className="admin-sales-snapshot__foot">
            <span><Icon name="chart" size={15} /><small>Top piece</small><strong>{topProduct?.name || 'No booked pieces yet'}</strong></span>
            <small>Open Sales for product rankings, customer trends, payment context and Excel export.</small>
          </footer>
        </>
      ) : null}
    </section>
  );
}

export default function SalesAnalyticsDashboard({ onAuthorizationFailure }) {
  const filterErrorId = `${useId().replaceAll(':', '')}-filter-error`;
  const [draftFilter, setDraftFilter] = useState({ range: 'month', from: '', to: '' });
  const [appliedFilter, setAppliedFilter] = useState({ range: 'month' });
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const requestRef = useRef(0);
  const today = useMemo(() => todayInIndia(), []);

  const loadAnalytics = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.getAdminSalesAnalytics(appliedFilter);
      if (requestId !== requestRef.current) return;
      const normalized = normalizeSalesAnalytics(result);
      setAnalytics(normalized);
      setDraftFilter((current) => current.from || current.to ? current : {
        range: normalized.filter.range,
        from: normalized.filter.from,
        to: normalized.filter.to,
      });
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      if (onAuthorizationFailure?.(requestError)) return;
      setError(salesAnalyticsErrorMessage(requestError));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [appliedFilter, onAuthorizationFailure]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const submitFilter = (event) => {
    event.preventDefault();
    const validationError = analyticsDateRangeError(draftFilter);
    if (validationError) {
      setFilterError(validationError);
      return;
    }
    setFilterError('');
    setAppliedFilter(normalizeAnalyticsFilter(draftFilter));
  };
  const updateDraftDate = (field, value) => {
    const nextFilter = { ...draftFilter, [field]: value };
    setDraftFilter(nextFilter);
    if (filterError) setFilterError(analyticsDateRangeError(nextFilter));
  };

  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    try {
      await api.downloadAdminSalesAnalyticsExcel({
        range: analytics?.filter?.range || appliedFilter.range,
        from: analytics?.filter?.from,
        to: analytics?.filter?.to,
      });
    } catch (requestError) {
      if (onAuthorizationFailure?.(requestError)) return;
      setExportError(salesAnalyticsErrorMessage(requestError, 'The Excel export could not be downloaded.'));
    } finally {
      setExporting(false);
    }
  };

  const effectivePeriod = analytics?.filter?.from && analytics?.filter?.to
    ? `${formatDate(analytics.filter.from)} – ${formatDate(analytics.filter.to)}`
    : 'Selected period';
  const hasActivity = analytics && hasAnalyticsActivity(analytics);
  const kpis = analytics?.kpis;
  const statusActivityTotal = analytics?.orderStatuses?.reduce((sum, item) => sum + item.count, 0) || 0;
  const excludedOrderCount = kpis ? Math.max(0, kpis.totalOrders - kpis.orders) : 0;
  const filterIsPending = Boolean(analytics) && (
    draftFilter.range !== analytics.filter.range
    || draftFilter.from !== analytics.filter.from
    || draftFilter.to !== analytics.filter.to
  );
  const kpiCards = analytics ? [
    ['Booked sales', formatCurrency(kpis.bookedSales), analytics.changePct.bookedSales, 'Paid + pending order value'],
    ['Booked orders', formatNumber(kpis.orders), analytics.changePct.orders, `${formatNumber(excludedOrderCount)} excluded from booked`],
    ['Average order', formatCurrency(kpis.averageOrderValue), analytics.changePct.averageOrderValue, 'Per booked order'],
    ['Units booked', formatNumber(kpis.units), analytics.changePct.units, 'Across every piece'],
    ['Customers', formatNumber(kpis.customers), analytics.changePct.customers, `${formatNumber(kpis.newCustomers)} new`],
    ['Repeat rate', formatPercent(kpis.repeatCustomerRate), null, `${formatNumber(kpis.repeatCustomers)} repeat customers`],
  ] : [];

  return (
    <section className="sales-analytics" aria-labelledby="sales-analytics-title">
      <header className="sales-analytics__header">
        <div>
          <p className="eyebrow">Sales intelligence</p>
          <h3 id="sales-analytics-title">Booked sales, clearly.</h3>
          <p>Paid and pending order totals placed in the selected period. Cancelled, refunded and failed-payment orders are excluded.</p>
        </div>
        <div className="sales-analytics__export">
          <button type="button" className="sales-export-button" onClick={exportExcel} disabled={exporting || !analytics} aria-describedby="sales-export-definition" aria-label={`Export complete Excel workbook for ${effectivePeriod}`} aria-busy={exporting}>
            <span className="sales-export-button__icon" aria-hidden="true">↓</span>{exporting ? salesExportWorkbookCopy.busyAction : salesExportWorkbookCopy.action}
          </button>
          <div className="sales-export-details" id="sales-export-definition">
            <span className="sales-export-details__badge" aria-hidden="true">XLSX</span>
            <span className="sales-export-details__copy">
              <strong>{salesExportWorkbookCopy.title}</strong>
              <small>{salesExportWorkbookCopy.description}</small>
            </span>
          </div>
          {exportError && <span className="sales-inline-error" role="alert">{exportError}</span>}
        </div>
      </header>

      <form className="sales-filters" onSubmit={submitFilter} noValidate>
        <fieldset>
          <legend>Group results by</legend>
          <div className="sales-range-tabs">
            {RANGE_OPTIONS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={draftFilter.range === value ? 'is-active' : ''}
                aria-pressed={draftFilter.range === value}
                onClick={() => setDraftFilter((current) => ({ ...current, range: value }))}
              >{label}</button>
            ))}
          </div>
        </fieldset>
        <div className="sales-date-fields">
          <label><span>From</span><input className="form-control" type="date" value={draftFilter.from} max={draftFilter.to || today} aria-invalid={Boolean(filterError)} aria-describedby={filterError ? filterErrorId : undefined} onChange={(event) => updateDraftDate('from', event.target.value)} /></label>
          <label><span>To</span><input className="form-control" type="date" value={draftFilter.to} min={draftFilter.from || undefined} max={today} aria-invalid={Boolean(filterError)} aria-describedby={filterError ? filterErrorId : undefined} onChange={(event) => updateDraftDate('to', event.target.value)} /></label>
          <button type="submit" className={filterIsPending ? 'sales-filter-submit is-pending' : 'sales-filter-submit'} disabled={loading || !filterIsPending}>
            {loading ? 'Updating…' : filterIsPending ? 'Apply changes' : 'View is current'}
          </button>
        </div>
        <p className={filterIsPending ? 'sales-filters__note is-pending' : 'sales-filters__note'} aria-live="polite">
          <Icon name={filterIsPending ? 'spark' : 'check'} size={14} />
          {filterIsPending ? 'Your filter choices are ready—apply them to refresh the dashboard.' : 'Dates and grouping use India Standard Time (IST).'}
        </p>
        {filterError && <p className="sales-inline-error" id={filterErrorId} role="alert">{filterError}</p>}
      </form>

      {loading && !analytics ? <AnalyticsSkeleton /> : error && !analytics ? (
        <div className="sales-analytics-error" role="alert">
          <div><strong>Sales analysis is temporarily unavailable.</strong><span>{error}</span></div>
          <button type="button" onClick={loadAnalytics}>Try again</button>
        </div>
      ) : analytics ? (
        <div className={loading ? 'sales-analytics__body is-refreshing' : 'sales-analytics__body'} aria-busy={loading}>
          <div className="sales-period-note" role="status" aria-live="polite">
            <span><strong>{effectivePeriod}</strong><small>{statusLabel(analytics.filter.range)} view · IST</small></span>
            {analytics.generatedAt && <small>Updated {formatDateTime(analytics.generatedAt)}</small>}
          </div>

          {error && <div className="sales-stale-warning" role="alert"><span><strong>Showing the last available analysis.</strong> {error}</span><button type="button" onClick={loadAnalytics}>Retry</button></div>}

          <div className="sales-kpis">
            {kpiCards.map(([label, value, change, note], index) => <article key={label} className={index === 0 ? 'is-primary' : ''}>
              <small>{label}</small><strong>{value}</strong>{change !== null && change !== undefined && <Comparison value={change} />}<span>{note}</span>
            </article>)}
          </div>

          {!hasActivity ? <EmptyAnalytics /> : (
            <>
              <div className="sales-chart-grid">
                <article className="sales-analytics-panel sales-chart-panel">
                  <header><div><p className="eyebrow">Performance line</p><h4>Booked sales over time</h4></div><span>{formatCurrency(kpis.bookedSales)}</span></header>
                  <SalesChart analytics={analytics} />
                </article>
                <PaymentComposition kpis={kpis} />
              </div>

              <div className="sales-insight-grid">
                <article className="sales-analytics-panel sales-products">
                  <header><div><p className="eyebrow">Product performance</p><h4>Pieces driving the studio</h4></div><small>Merchandise value</small></header>
                  <p className="sales-product-definition">Merchandise value is the order-time unit price × quantity, before discounts and delivery.</p>
                  {analytics.products.length ? <ol>{analytics.products.slice(0, 6).map((product, index) => <li key={product.productId}>
                    <span className="sales-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{product.name}</strong><small>{countLabel(product.units, 'unit')} · {countLabel(product.orders, 'order')}</small><i><b style={{ width: `${safeShare(product.share)}%` }} /></i></div>
                    <span><strong>{formatCurrency(product.bookedSales)}</strong><small>{formatPercent(product.share)} share</small></span>
                  </li>)}</ol> : <p className="sales-panel-empty">No product sales in this view.</p>}
                </article>

                <article className="sales-analytics-panel sales-statuses">
                  <header><div><p className="eyebrow">Order pipeline</p><h4>Where orders stand</h4></div><small>{formatNumber(statusActivityTotal)} total activity</small></header>
                  {analytics.orderStatuses.length ? <ul>{analytics.orderStatuses.map((item) => <li key={item.status}>
                    <div><span className={`sales-status-dot status-${item.status}`} aria-hidden="true" /><strong>{statusLabel(item.status)}</strong><b>{formatNumber(item.count)}</b></div>
                    <span><i style={{ width: `${safeShare(item.countShare)}%` }} /><small>{formatCurrency(item.orderValue)} order value</small></span>
                  </li>)}</ul> : <p className="sales-panel-empty">No order status activity in this view.</p>}
                </article>
              </div>

              <article className="sales-analytics-panel sales-customers">
                <header><div><p className="eyebrow">Customer perspective</p><h4>New relationships and returning collectors</h4></div><small>Ranked by booked sales</small></header>
                <p className="sales-customer-definition">Customers are unique booked-order contacts. New means their first order is in this period; returning means they ordered before it. Repeat means at least two lifetime booked orders.</p>
                <div className="sales-customer-layout">
                  <dl className="sales-customer-summary">
                    <div><dt>Unique customers</dt><dd>{formatNumber(analytics.customers.unique)}</dd></div>
                    <div><dt>New customers</dt><dd>{formatNumber(analytics.customers.new)}</dd></div>
                    <div><dt>Returning</dt><dd>{formatNumber(analytics.customers.returning)}</dd></div>
                    <div><dt>Returning rate</dt><dd>{formatPercent(analytics.customers.returningRate)}</dd></div>
                    <div><dt>Repeat customers</dt><dd>{formatNumber(analytics.customers.repeat)}</dd></div>
                    <div><dt>Repeat rate</dt><dd>{formatPercent(analytics.customers.repeatRate)}</dd></div>
                  </dl>
                  {analytics.customers.top.length ? <ol className="sales-top-customers">{analytics.customers.top.slice(0, 5).map((customer, index) => <li key={customer.customerId}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{customer.name}</strong><small>{maskEmail(customer.email) || `${formatNumber(customer.orders)} orders`}</small></div>
                    <div><strong>{formatCurrency(customer.bookedSales)}</strong><small>{countLabel(customer.orders, 'order')} · {countLabel(customer.units, 'unit')}</small></div>
                  </li>)}</ol> : <p className="sales-panel-empty">No customer ranking is available for this view.</p>}
                </div>
              </article>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
