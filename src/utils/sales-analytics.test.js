import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsDateRangeError,
  analyticsQuery,
  chartAxisLabelIndexes,
  chartGeometry,
  chartMinimumWidth,
  chartSummary,
  compactChartLabel,
  hasAnalyticsActivity,
  hasChartRevenue,
  normalizeAnalyticsFilter,
  normalizeSalesAnalytics,
  niceChartMaximum,
  salesExportWorkbookCopy,
  salesFinancialLabels,
  salesAnalyticsErrorMessage,
} from './sales-analytics.js';

test('analytics filters keep a supported range and only send complete custom dates', () => {
  assert.deepEqual(normalizeAnalyticsFilter({ range: 'week', from: '2026-08-01', to: '2026-08-21' }), {
    range: 'week',
    from: '2026-08-01',
    to: '2026-08-21',
  });
  assert.equal(analyticsQuery({ range: 'invalid', from: '2026-08-01' }), 'range=month');
  assert.equal(analyticsDateRangeError({ from: '2026-08-01' }), 'Choose both a start and end date.');
  assert.equal(analyticsDateRangeError({ from: '2026-08-22', to: '2026-08-21' }), 'The start date must be on or before the end date.');
  assert.equal(analyticsDateRangeError({ from: '2026-08-01', to: '2026-08-21' }), '');
});

test('Excel export copy accurately previews the detailed workbook', () => {
  assert.match(salesExportWorkbookCopy.action, /complete Excel/i);
  assert.match(salesExportWorkbookCopy.description, /Admin-only/);
  assert.match(salesExportWorkbookCopy.description, /Normal Orders/);
  assert.match(salesExportWorkbookCopy.description, /Custom Requests/);
  assert.match(salesExportWorkbookCopy.description, /customer contacts/i);
  assert.match(salesExportWorkbookCopy.description, /item-by-item normal-order customization details/i);
  assert.match(salesExportWorkbookCopy.description, /financial reconciliation/i);
});

test('financial context labels describe original order values rather than refund payouts', () => {
  assert.equal(salesFinancialLabels.cancelledOrderValue, 'Cancelled order value');
  assert.equal(salesFinancialLabels.refundedOrderValue, 'Refunded order value');
  assert.equal(salesFinancialLabels.failedPaymentOrderValue, 'Failed-payment order value');
  assert.notEqual(salesFinancialLabels.refundedOrderValue, 'Refunded value');
});

test('sales analytics normalization preserves honest booked, paid and pending values', () => {
  const analytics = normalizeSalesAnalytics({ data: {
    filter: { range: 'day', from: '2026-08-20', to: '2026-08-21' },
    kpis: { bookedSales: '2499', paidSales: 1000, pendingPaymentSales: 1499, otherPaymentSales: 0, orders: '1' },
    comparison: { changePct: { bookedSales: '25', orders: null } },
    series: [{ period: '2026-08-21', bookedSales: 2499, paidSales: 1000 }],
    products: [{ name: 'Clock', share: '100', bookedSales: 2499 }],
    orderStatuses: [{ status: 'placed', count: 1, countShare: 100 }],
    customers: { repeat: 1, repeatRate: 100, returningRate: 0, top: [{ email: 'buyer@example.com', bookedSales: '2499' }] },
  } });

  assert.equal(analytics.kpis.bookedSales, 2499);
  assert.equal(analytics.kpis.pendingPaymentSales, 1499);
  assert.equal(analytics.changePct.bookedSales, 25);
  assert.equal(analytics.changePct.orders, null);
  assert.equal(analytics.series[0].label, '2026-08-21');
  assert.equal(analytics.orderStatuses[0].countShare, 100);
  assert.equal(analytics.customers.repeatRate, 100);
  assert.equal(analytics.customers.top[0].customerId, 'buyer@example.com');
});

test('accessible chart geometry handles a single zero-value period without invalid coordinates', () => {
  const geometry = chartGeometry([{ label: 'Today', bookedSales: 0, paidSales: 0 }]);
  assert.equal(geometry.points.length, 1);
  assert.ok(Number.isFinite(geometry.points[0].x));
  assert.ok(Number.isFinite(geometry.points[0].y));
  assert.match(geometry.areaPath, /^M /);
  assert.equal(chartSummary([], (value) => `₹${value}`), 'No booked sales were recorded for this view.');
});

test('chart axes use compact dates, nice scaling and collision-aware label indexes', () => {
  assert.equal(compactChartLabel('Aug 2026'), 'Aug ’26');
  assert.equal(compactChartLabel('2026-08-21'), '21 Aug');
  assert.equal(niceChartMaximum(4_299), 5_000);
  const monthly = Array.from({ length: 13 }, (_, index) => ({ label: `Month ${index + 1}` }));
  const indexes = chartAxisLabelIndexes(monthly, { width: 760, left: 70, right: 20, minimumGap: 90 });
  assert.equal(indexes[0], 0);
  assert.equal(indexes.at(-1), 12);
  assert.ok(indexes.every((index, position) => !position || index > indexes[position - 1]));
  assert.ok(indexes.length < monthly.length);
});

test('chart labels stay sparse and endpoints stay inside the plot across dense ranges', () => {
  for (const count of [2, 3, 7, 12, 13, 24, 31]) {
    const series = Array.from({ length: count }, (_, index) => ({
      label: `Week ${index + 1}, 24–30 September 2026`,
      bookedSales: index === count - 2 ? 100_000 : index * 1250,
      paidSales: index * 800,
    }));
    const geometry = chartGeometry(series);
    const indexes = chartAxisLabelIndexes(series);
    assert.equal(indexes[0], 0);
    assert.equal(indexes.at(-1), count - 1);
    assert.ok(indexes.length <= 7);
    assert.equal(geometry.points[0].x, geometry.plot.left);
    assert.equal(geometry.points.at(-1).x, geometry.plot.rightEdge);
    assert.ok(geometry.points.every((point) => point.y >= geometry.plot.top && point.y <= geometry.plot.bottomEdge));
  }
  assert.equal(compactChartLabel('Week 21, 24–30 September 2026'), 'Week 21, 24–…');
  assert.ok(niceChartMaximum(100_000) > 100_000, 'exact maximum receives visual headroom');
  assert.equal(chartMinimumWidth(1), null);
  assert.equal(chartMinimumWidth(2), null);
  assert.equal(chartMinimumWidth(7), 680);
  assert.equal(chartMinimumWidth(12), 680);
  assert.equal(chartMinimumWidth(31), 1_800);
});

test('all-cancelled or refunded ranges still count as useful analytics activity', () => {
  const analytics = normalizeSalesAnalytics({
    kpis: { bookedSales: 0, orders: 0, cancelledOrders: 1 },
    orderStatuses: [{ status: 'cancelled', count: 1, orderValue: 1200 }],
  });
  assert.equal(analytics.kpis.bookedSales, 0);
  assert.equal(analytics.orderStatuses[0].count, 1);
  assert.equal(hasAnalyticsActivity(analytics), true);
  assert.equal(hasChartRevenue([{ bookedSales: 0, paidSales: 0 }]), false);
  assert.equal(hasChartRevenue([{ bookedSales: 0, paidSales: 1 }]), true);
});

test('sales errors never expose an internal missing-route message', () => {
  assert.equal(
    salesAnalyticsErrorMessage({ code: 'ROUTE_NOT_FOUND', message: 'No API route matches GET /api/admin/analytics' }),
    'Sales intelligence is being updated. Please try again shortly.',
  );
  assert.equal(
    salesAnalyticsErrorMessage({ message: 'No API route matches GET /api/admin/analytics/export.xlsx' }),
    'Sales intelligence is being updated. Please try again shortly.',
  );
  assert.equal(salesAnalyticsErrorMessage({ message: 'Network unavailable' }), 'Network unavailable');
});
