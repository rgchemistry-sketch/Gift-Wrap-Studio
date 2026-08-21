const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const textValue = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const percentageValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const rangeOptions = new Set(['day', 'week', 'month', 'year']);

export const salesExportWorkbookCopy = Object.freeze({
  action: 'Export complete Excel',
  busyAction: 'Building workbook…',
  title: 'Complete studio workbook',
  description: 'Admin-only workbook: separate Normal Orders and Custom Requests, with customer contacts, item-by-item normal-order customization details, and final financial reconciliation.',
});

export const salesFinancialLabels = Object.freeze({
  cancelledOrderValue: 'Cancelled order value',
  refundedOrderValue: 'Refunded order value',
  failedPaymentOrderValue: 'Failed-payment order value',
});

export const salesAnalyticsErrorMessage = (error, fallback = 'Sales analysis could not be loaded.') => {
  const message = textValue(error?.message);
  if (error?.code === 'ROUTE_NOT_FOUND' || /no api route matches/i.test(message)) {
    return 'Sales intelligence is being updated. Please try again shortly.';
  }
  return message || fallback;
};

export const normalizeAnalyticsFilter = (filter = {}) => {
  const range = rangeOptions.has(filter.range) ? filter.range : 'month';
  const from = textValue(filter.from);
  const to = textValue(filter.to);
  return {
    range,
    ...(from && to ? { from, to } : {}),
  };
};

export const analyticsDateRangeError = (filter = {}) => {
  const from = textValue(filter.from);
  const to = textValue(filter.to);
  if (Boolean(from) !== Boolean(to)) return 'Choose both a start and end date.';
  if (from && to && from > to) return 'The start date must be on or before the end date.';
  return '';
};

export const analyticsQuery = (filter = {}) => {
  const normalized = normalizeAnalyticsFilter(filter);
  return new URLSearchParams(normalized).toString();
};

export const normalizeSalesAnalytics = (result = {}) => {
  const source = result?.data ?? result;
  const kpis = source?.kpis || {};
  const comparison = source?.comparison || {};
  const changePct = comparison.changePct || {};

  const series = Array.isArray(source?.series) ? source.series.map((point, index) => ({
    period: textValue(point.period, String(index + 1)),
    label: textValue(point.label, textValue(point.period, `Period ${index + 1}`)),
    from: textValue(point.from),
    to: textValue(point.to),
    bookedSales: numberValue(point.bookedSales),
    paidSales: numberValue(point.paidSales),
    pendingPaymentSales: numberValue(point.pendingPaymentSales),
    otherPaymentSales: numberValue(point.otherPaymentSales),
    orders: numberValue(point.orders),
    units: numberValue(point.units),
    cancelledOrders: numberValue(point.cancelledOrders),
    cancelledValue: numberValue(point.cancelledValue),
  })) : [];

  const products = Array.isArray(source?.products) ? source.products.map((product, index) => ({
    productId: textValue(product.productId, textValue(product.slug, `product-${index + 1}`)),
    slug: textValue(product.slug),
    name: textValue(product.name, 'Untitled piece'),
    bookedSales: numberValue(product.bookedSales),
    paidSales: numberValue(product.paidSales),
    units: numberValue(product.units),
    orders: numberValue(product.orders),
    share: Math.max(0, numberValue(product.share)),
  })) : [];

  const orderStatuses = Array.isArray(source?.orderStatuses) ? source.orderStatuses.map((status, index) => ({
    status: textValue(status.status, `status-${index + 1}`),
    count: numberValue(status.count),
    orderValue: numberValue(status.orderValue),
    bookedSales: numberValue(status.bookedSales),
    share: Math.max(0, numberValue(status.share)),
    countShare: Math.max(0, numberValue(status.countShare)),
  })) : [];

  const customerSource = source?.customers || {};
  const topCustomers = Array.isArray(customerSource.top) ? customerSource.top.map((customer, index) => ({
    customerId: textValue(customer.customerId, textValue(customer.email, `customer-${index + 1}`)),
    name: textValue(customer.name, 'Studio customer'),
    email: textValue(customer.email),
    bookedSales: numberValue(customer.bookedSales),
    orders: numberValue(customer.orders),
    units: numberValue(customer.units),
    lastOrderAt: textValue(customer.lastOrderAt),
  })) : [];

  return {
    filter: {
      range: rangeOptions.has(source?.filter?.range) ? source.filter.range : 'month',
      from: textValue(source?.filter?.from),
      to: textValue(source?.filter?.to),
      previousFrom: textValue(source?.filter?.previousFrom),
      previousTo: textValue(source?.filter?.previousTo),
      timezone: textValue(source?.filter?.timezone, 'Asia/Kolkata'),
    },
    kpis: {
      bookedSales: numberValue(kpis.bookedSales),
      paidSales: numberValue(kpis.paidSales),
      pendingPaymentSales: numberValue(kpis.pendingPaymentSales),
      otherPaymentSales: numberValue(kpis.otherPaymentSales),
      totalOrders: numberValue(kpis.totalOrders),
      orders: numberValue(kpis.orders),
      units: numberValue(kpis.units),
      averageOrderValue: numberValue(kpis.averageOrderValue),
      customers: numberValue(kpis.customers),
      newCustomers: numberValue(kpis.newCustomers),
      returningCustomers: numberValue(kpis.returningCustomers),
      repeatCustomerRate: numberValue(kpis.repeatCustomerRate),
      cancelledOrders: numberValue(kpis.cancelledOrders),
      cancelledValue: numberValue(kpis.cancelledValue),
      refundedOrders: numberValue(kpis.refundedOrders),
      refundedValue: numberValue(kpis.refundedValue),
      failedPaymentOrders: numberValue(kpis.failedPaymentOrders),
      failedPaymentValue: numberValue(kpis.failedPaymentValue),
      returningCustomerRate: numberValue(kpis.returningCustomerRate),
      repeatCustomers: numberValue(kpis.repeatCustomers),
    },
    changePct: {
      bookedSales: percentageValue(changePct.bookedSales),
      orders: percentageValue(changePct.orders),
      units: percentageValue(changePct.units),
      averageOrderValue: percentageValue(changePct.averageOrderValue),
      customers: percentageValue(changePct.customers),
    },
    series,
    products,
    orderStatuses,
    customers: {
      unique: numberValue(customerSource.unique),
      new: numberValue(customerSource.new),
      returning: numberValue(customerSource.returning),
      returningRate: numberValue(customerSource.returningRate),
      repeat: numberValue(customerSource.repeat),
      repeatRate: numberValue(customerSource.repeatRate),
      top: topCustomers,
    },
    metricDefinitions: source?.metricDefinitions || {},
    generatedAt: textValue(source?.generatedAt),
  };
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const compactChartLabel = (value) => {
  const label = textValue(value);
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (isoDate) return `${Number(isoDate[3])} ${MONTHS[Number(isoDate[2]) - 1] || isoDate[2]}`;
  const monthYear = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(label);
  if (monthYear) return `${monthYear[1].slice(0, 3)} ’${monthYear[2].slice(-2)}`;
  return label.length > 14 ? `${label.slice(0, 12).trim()}…` : label;
};

export const niceChartMaximum = (value, segments = 5) => {
  const maximum = Math.max(0, numberValue(value));
  if (!maximum) return 1;
  const roughStep = maximum / Math.max(2, segments);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * magnitude;
  const roundedMaximum = Math.max(step, Math.ceil(maximum / step) * step);
  return roundedMaximum <= maximum ? roundedMaximum + step : roundedMaximum;
};

export const chartAxisLabelIndexes = (series = [], {
  width = 880,
  left = 84,
  right = 24,
  minimumGap = 88,
  maximumLabels = 7,
} = {}) => {
  if (!series.length) return [];
  if (series.length === 1) return [0];
  const plotWidth = Math.max(1, width - left - right);
  const pointGap = plotWidth / (series.length - 1);
  const stride = Math.max(1, Math.ceil(minimumGap / pointGap), Math.ceil(series.length / maximumLabels));
  const lastIndex = series.length - 1;
  const indexes = [0];
  for (let index = stride; index < lastIndex; index += stride) {
    if ((lastIndex - index) * pointGap >= minimumGap) indexes.push(index);
  }
  if (indexes.at(-1) !== lastIndex) indexes.push(lastIndex);
  return indexes;
};

export const chartMinimumWidth = (pointCount) => {
  const count = Math.max(0, Math.floor(numberValue(pointCount)));
  if (count <= 3) return null;
  if (count <= 13) return 680;
  return Math.min(1_800, Math.max(880, count * 60));
};

export const chartGeometry = (series = [], {
  width = 880,
  height = 356,
  inset,
  insets = { top: 34, right: 24, bottom: 58, left: 84 },
} = {}) => {
  const resolvedInsets = inset === undefined
    ? insets
    : { top: inset, right: inset, bottom: inset, left: inset };
  const plot = {
    top: Math.max(0, numberValue(resolvedInsets.top)),
    right: Math.max(0, numberValue(resolvedInsets.right)),
    bottom: Math.max(0, numberValue(resolvedInsets.bottom)),
    left: Math.max(0, numberValue(resolvedInsets.left)),
  };
  plot.width = Math.max(1, width - plot.left - plot.right);
  plot.height = Math.max(1, height - plot.top - plot.bottom);
  plot.rightEdge = plot.left + plot.width;
  plot.bottomEdge = plot.top + plot.height;
  if (!series.length) return {
    points: [], paidPoints: [], linePath: '', paidPath: '', areaPath: '', maxValue: 0, plot,
  };
  const maxValue = niceChartMaximum(Math.max(...series.flatMap((point) => [numberValue(point.bookedSales), numberValue(point.paidSales)])));
  const xFor = (index) => series.length === 1
    ? plot.left + plot.width / 2
    : plot.left + (plot.width * index) / (series.length - 1);
  const yFor = (value) => plot.bottomEdge - (Math.max(0, numberValue(value)) / maxValue) * plot.height;
  const points = series.map((point, index) => ({ x: xFor(index), y: yFor(point.bookedSales), datum: point }));
  const paidPoints = series.map((point, index) => ({ x: xFor(index), y: yFor(point.paidSales), datum: point }));
  const pathFor = (items) => {
    if (!items.length) return '';
    if (items.length === 1) return `M ${items[0].x.toFixed(2)} ${items[0].y.toFixed(2)}`;
    return items.slice(1).reduce((path, point, index) => {
      const previous = items[index];
      const horizontalDistance = (point.x - previous.x) / 3;
      return `${path} C ${(previous.x + horizontalDistance).toFixed(2)} ${previous.y.toFixed(2)} ${(point.x - horizontalDistance).toFixed(2)} ${point.y.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }, `M ${items[0].x.toFixed(2)} ${items[0].y.toFixed(2)}`);
  };
  const baseline = plot.bottomEdge;
  return {
    points,
    paidPoints,
    linePath: pathFor(points),
    paidPath: pathFor(paidPoints),
    areaPath: `${pathFor(points)} L ${points.at(-1).x.toFixed(2)} ${baseline} L ${points[0].x.toFixed(2)} ${baseline} Z`,
    maxValue,
    plot,
  };
};

export const chartSummary = (series = [], currencyFormatter = (value) => String(value)) => {
  if (!series.length) return 'No booked sales were recorded for this view.';
  const total = series.reduce((sum, point) => sum + numberValue(point.bookedSales), 0);
  const peak = series.reduce((best, point) => numberValue(point.bookedSales) > numberValue(best.bookedSales) ? point : best, series[0]);
  return `${series.length} periods shown. Total booked sales ${currencyFormatter(total)}. Highest period ${textValue(peak.label, peak.period)} at ${currencyFormatter(peak.bookedSales)}.`;
};

export const hasChartRevenue = (series = []) => Array.isArray(series) && series.some((point) => (
  numberValue(point?.bookedSales) > 0 || numberValue(point?.paidSales) > 0
));

export const hasAnalyticsActivity = (analytics) => Boolean(
  analytics?.kpis?.orders
  || analytics?.kpis?.totalOrders
  || analytics?.kpis?.bookedSales
  || analytics?.series?.some((point) => point.orders || point.bookedSales || point.cancelledOrders)
  || analytics?.orderStatuses?.some((status) => status.count),
);
