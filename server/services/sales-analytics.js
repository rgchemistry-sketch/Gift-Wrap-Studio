import { connectDatabase } from "../config/database.js";
import { badRequest } from "../lib/errors.js";
import { memoryStore } from "../lib/memory-store.js";
import { CustomInquiry } from "../models/CustomInquiry.js";
import { Order } from "../models/Order.js";

const TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_ANALYTICS_ORDERS = 50_000;
const MAX_EXPORT_ORDERS = 10_000;
const MAX_EXPORT_ORDER_ITEMS = 100_000;
const MAX_EXPORT_CUSTOM_REQUESTS = 20_000;
const TOP_CUSTOMER_LIMIT = 10;

const rangeLimits = {
  day: 366,
  week: 1_096,
  month: 1_831,
  year: 1_831,
};

const statusLabels = {
  placed: "Placed",
  confirmed: "Confirmed",
  in_progress: "In progress",
  ready: "Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const paymentStatusLabels = {
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const roundPercent = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
const asDate = (value) => (value instanceof Date ? value : new Date(value));
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const dateString = (date) => new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const parseCalendarDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) throw badRequest("Use dates in YYYY-MM-DD format");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    throw badRequest("Choose a valid calendar date");
  }
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
};

const localParts = (localMidnight) => {
  const shifted = new Date(localMidnight.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
};

const makeLocalDate = (year, month, day) =>
  new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);

const defaultDateRange = (range, now) => {
  const to = parseCalendarDate(dateString(now));
  const { year, month } = localParts(to);
  if (range === "day") return { from: addDays(to, -29), to };
  if (range === "week") return { from: addDays(to, -83), to };
  if (range === "month") return { from: makeLocalDate(year, month - 11, 1), to };
  return { from: makeLocalDate(year - 4, 1, 1), to };
};

export const resolveAnalyticsRange = ({ range = "month", from, to }, now = new Date()) => {
  const resolved = from && to
    ? { from: parseCalendarDate(from), to: parseCalendarDate(to) }
    : defaultDateRange(range, now);
  if (resolved.from > resolved.to) throw badRequest("The start date must be on or before the end date");
  const today = parseCalendarDate(dateString(now));
  if (resolved.to > today) throw badRequest("Sales analysis cannot include future dates");

  const days = Math.round((resolved.to.getTime() - resolved.from.getTime()) / DAY_MS) + 1;
  if (days > rangeLimits[range]) {
    throw badRequest(
      `${range[0].toUpperCase()}${range.slice(1)} analysis is limited to ${rangeLimits[range]} days. Choose a shorter date range`,
    );
  }

  const endExclusive = addDays(resolved.to, 1);
  const previousEndExclusive = resolved.from;
  const previousFrom = addDays(resolved.from, -days);
  return {
    range,
    from: resolved.from,
    to: resolved.to,
    endExclusive,
    previousFrom,
    previousTo: addDays(resolved.from, -1),
    previousEndExclusive,
    days,
  };
};

const floorBucket = (date, range) => {
  if (range === "day") return date;
  const { year, month, weekday } = localParts(date);
  if (range === "week") return addDays(date, -((weekday + 6) % 7));
  if (range === "month") return makeLocalDate(year, month, 1);
  return makeLocalDate(year, 1, 1);
};

const nextBucket = (date, range) => {
  if (range === "day") return addDays(date, 1);
  if (range === "week") return addDays(date, 7);
  const { year, month } = localParts(date);
  if (range === "month") return makeLocalDate(year, month + 1, 1);
  return makeLocalDate(year + 1, 1, 1);
};

const shortDate = (value, includeYear = false) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));

const bucketLabel = (start, endExclusive, range) => {
  const startText = dateString(start);
  if (range === "day") return shortDate(startText, true);
  if (range === "week") {
    const endText = dateString(addDays(endExclusive, -1));
    return `${shortDate(startText)} – ${shortDate(endText, true)}`;
  }
  const { year } = localParts(start);
  if (range === "month") {
    return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${startText}T00:00:00.000Z`));
  }
  return String(year);
};

const bucketKey = (date, range) => {
  const localDate = parseCalendarDate(dateString(date));
  const start = floorBucket(localDate, range);
  if (range === "month") return dateString(start).slice(0, 7);
  if (range === "year") return dateString(start).slice(0, 4);
  return dateString(start);
};

const makeSeries = (filter) => {
  const rows = [];
  let bucketStart = floorBucket(filter.from, filter.range);
  while (bucketStart < filter.endExclusive) {
    const bucketEnd = nextBucket(bucketStart, filter.range);
    const visibleFrom = bucketStart < filter.from ? filter.from : bucketStart;
    const visibleEnd = bucketEnd > filter.endExclusive ? filter.endExclusive : bucketEnd;
    rows.push({
      period: bucketKey(bucketStart, filter.range),
      label: bucketLabel(visibleFrom, visibleEnd, filter.range),
      from: dateString(visibleFrom),
      to: dateString(addDays(visibleEnd, -1)),
      bookedSales: 0,
      paidSales: 0,
      pendingPaymentSales: 0,
      otherPaymentSales: 0,
      orders: 0,
      units: 0,
      cancelledOrders: 0,
      cancelledValue: 0,
      refundedOrders: 0,
      refundedValue: 0,
      failedPaymentOrders: 0,
      failedPaymentValue: 0,
    });
    bucketStart = bucketEnd;
  }
  return rows;
};

const normalizePaymentStatus = (order) => order.paymentStatus || "pending";
const isCancelled = (order) => order.status === "cancelled";
const isRefunded = (order) => normalizePaymentStatus(order) === "refunded";
const isFailedPayment = (order) => normalizePaymentStatus(order) === "failed";
const isBookedOrder = (order) =>
  !isCancelled(order) && !isRefunded(order) && !isFailedPayment(order);
const orderUnits = (order) =>
  (order.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0);

const summarizeOrders = (orders) => {
  const booked = orders.filter(isBookedOrder);
  const cancelled = orders.filter(isCancelled);
  const refunded = orders.filter((order) => !isCancelled(order) && isRefunded(order));
  const failed = orders.filter((order) => !isCancelled(order) && isFailedPayment(order));
  const bookedSales = roundMoney(booked.reduce((total, order) => total + Number(order.total || 0), 0));
  const paidSales = roundMoney(
    booked
      .filter((order) => normalizePaymentStatus(order) === "paid")
      .reduce((total, order) => total + Number(order.total || 0), 0),
  );
  const pendingPaymentSales = roundMoney(
    booked
      .filter((order) => normalizePaymentStatus(order) === "pending")
      .reduce((total, order) => total + Number(order.total || 0), 0),
  );
  return {
    bookedSales,
    paidSales,
    pendingPaymentSales,
    otherPaymentSales: roundMoney(bookedSales - paidSales - pendingPaymentSales),
    orders: booked.length,
    units: booked.reduce((total, order) => total + orderUnits(order), 0),
    averageOrderValue: booked.length ? roundMoney(bookedSales / booked.length) : 0,
    cancelledOrders: cancelled.length,
    cancelledValue: roundMoney(cancelled.reduce((total, order) => total + Number(order.total || 0), 0)),
    refundedOrders: refunded.length,
    refundedValue: roundMoney(refunded.reduce((total, order) => total + Number(order.total || 0), 0)),
    failedPaymentOrders: failed.length,
    failedPaymentValue: roundMoney(failed.reduce((total, order) => total + Number(order.total || 0), 0)),
  };
};

const percentChange = (current, previous) => {
  if (previous === 0) return current === 0 ? 0 : null;
  return roundPercent(((current - previous) / Math.abs(previous)) * 100);
};

const ordersInWindow = (orders, from, endExclusive) =>
  orders.filter((order) => {
    const createdAt = asDate(order.createdAt);
    return createdAt >= from && createdAt < endExclusive;
  });

const buildProductRows = (orders) => {
  const products = new Map();
  orders.filter(isBookedOrder).forEach((order) => {
    (order.items || []).forEach((item) => {
      const value = roundMoney(Number(item.unitPrice || 0) * Number(item.quantity || 0));
      const productId = String(item.productId || item.slug || item.name || "unknown");
      const row = products.get(productId) || {
        productId,
        slug: item.slug || "",
        name: item.name || "Unnamed product",
        category: item.category || "",
        bookedSales: 0,
        paidSales: 0,
        units: 0,
        orderIds: new Set(),
      };
      // Product records can be renamed after older orders are placed. The range query is sorted
      // oldest-to-newest, so refresh presentation fields while retaining the stable snapshot ID.
      row.name = item.name || row.name;
      row.slug = item.slug || row.slug;
      row.category = item.category || row.category;
      row.bookedSales = roundMoney(row.bookedSales + value);
      if (normalizePaymentStatus(order) === "paid") {
        row.paidSales = roundMoney(row.paidSales + value);
      }
      row.units += Number(item.quantity || 0);
      row.orderIds.add(String(order.id || order._id || order.orderNumber));
      products.set(productId, row);
    });
  });
  const total = [...products.values()].reduce((sum, product) => sum + product.bookedSales, 0);
  return [...products.values()]
    .map(({ orderIds, ...product }) => ({
      ...product,
      orders: orderIds.size,
      share: total ? roundPercent((product.bookedSales / total) * 100) : 0,
    }))
    .sort((left, right) => right.bookedSales - left.bookedSales || right.units - left.units);
};

const buildStatusRows = (orders, totalBookedSales) => {
  const statuses = new Map();
  orders.forEach((order) => {
    const status = order.status || "placed";
    const row = statuses.get(status) || {
      status,
      label: statusLabels[status] || status,
      count: 0,
      orderValue: 0,
      bookedSales: 0,
    };
    row.count += 1;
    row.orderValue = roundMoney(row.orderValue + Number(order.total || 0));
    if (isBookedOrder(order)) row.bookedSales = roundMoney(row.bookedSales + Number(order.total || 0));
    statuses.set(status, row);
  });
  return [...statuses.values()]
    .map((row) => ({
      ...row,
      share: totalBookedSales ? roundPercent((row.bookedSales / totalBookedSales) * 100) : 0,
      countShare: orders.length ? roundPercent((row.count / orders.length) * 100) : 0,
    }))
    .sort((left, right) => right.count - left.count);
};

const buildPaymentRows = (orders, totalBookedSales) => {
  const statuses = new Map();
  orders.forEach((order) => {
    const status = normalizePaymentStatus(order);
    const row = statuses.get(status) || {
      status,
      label: paymentStatusLabels[status] || status,
      count: 0,
      orderValue: 0,
      bookedSales: 0,
    };
    row.count += 1;
    row.orderValue = roundMoney(row.orderValue + Number(order.total || 0));
    if (isBookedOrder(order)) row.bookedSales = roundMoney(row.bookedSales + Number(order.total || 0));
    statuses.set(status, row);
  });
  return [...statuses.values()]
    .map((row) => ({
      ...row,
      share: totalBookedSales ? roundPercent((row.bookedSales / totalBookedSales) * 100) : 0,
    }))
    .sort((left, right) => right.orderValue - left.orderValue);
};

const fetchOrders = async (mode, from, endExclusive) => {
  if (mode === "mongodb") {
    const orders = await Order.find({ createdAt: { $gte: from, $lt: endExclusive } })
      .select(
        "orderNumber buyerId buyerName buyerEmail items.productId items.slug items.name items.category items.unitPrice items.quantity subtotal shippingFee discount total couponCode status paymentStatus createdAt",
      )
      .sort({ createdAt: 1, _id: 1 })
      .limit(MAX_ANALYTICS_ORDERS + 1)
      .lean();
    if (orders.length > MAX_ANALYTICS_ORDERS) {
      throw badRequest("This range contains too many orders to analyse safely. Choose a shorter range");
    }
    return orders.map((order) => ({ ...order, id: String(order._id) }));
  }
  const orders = memoryStore
    .find("orders", (order) => {
      const createdAt = asDate(order.createdAt);
      return createdAt >= from && createdAt < endExclusive;
    })
    .sort((left, right) => asDate(left.createdAt) - asDate(right.createdAt));
  if (orders.length > MAX_ANALYTICS_ORDERS) {
    throw badRequest("This range contains too many orders to analyse safely. Choose a shorter range");
  }
  return orders;
};

const fetchDetailedExportOrders = async (mode, from, endExclusive) => {
  let orders;
  if (mode === "mongodb") {
    orders = await Order.find({ createdAt: { $gte: from, $lt: endExclusive } })
      .select(
        [
          "orderNumber buyerName buyerEmail",
          "items.slug items.name items.category items.unitPrice items.quantity items.customization",
          "shippingAddress subtotal shippingFee discount total couponCode",
          "neededBy contactPreference note status paymentMethod paymentStatus createdAt",
        ].join(" "),
      )
      .sort({ createdAt: 1, _id: 1 })
      .limit(MAX_EXPORT_ORDERS + 1)
      .lean();
  } else {
    orders = memoryStore
      .find("orders", (order) => {
        const createdAt = asDate(order.createdAt);
        return createdAt >= from && createdAt < endExclusive;
      })
      .sort((left, right) => asDate(left.createdAt) - asDate(right.createdAt));
  }
  if (orders.length > MAX_EXPORT_ORDERS) {
    throw badRequest("This range contains too many orders to export safely. Choose a shorter range");
  }
  const itemRows = orders.reduce((total, order) => total + (order.items?.length || 0), 0);
  if (itemRows > MAX_EXPORT_ORDER_ITEMS) {
    throw badRequest("This range contains too many order items to export safely. Choose a shorter range");
  }
  return orders;
};

const fetchExportCustomRequests = async (mode, from, endExclusive) => {
  let requests;
  if (mode === "mongodb") {
    requests = await CustomInquiry.find({ createdAt: { $gte: from, $lt: endExclusive } })
      .select(
        "name email phone category occasion palette idea customization budget neededBy contactPreference referenceUrl referenceImages status createdAt",
      )
      .sort({ createdAt: 1, _id: 1 })
      .limit(MAX_EXPORT_CUSTOM_REQUESTS + 1)
      .lean();
  } else {
    requests = memoryStore
      .find("customInquiries", (request) => {
        const createdAt = asDate(request.createdAt);
        return createdAt >= from && createdAt < endExclusive;
      })
      .sort((left, right) => asDate(left.createdAt) - asDate(right.createdAt));
  }
  if (requests.length > MAX_EXPORT_CUSTOM_REQUESTS) {
    throw badRequest("This range contains too many custom requests to export safely. Choose a shorter range");
  }
  return requests;
};

const fetchCustomerHistory = async (mode, customerIds) => {
  if (!customerIds.length) return new Map();
  if (mode === "mongodb") {
    const rows = await Order.aggregate([
      {
        $match: {
          buyerId: { $in: customerIds },
          status: { $ne: "cancelled" },
          paymentStatus: { $nin: ["refunded", "failed"] },
        },
      },
      {
        $group: {
          _id: "$buyerId",
          firstOrderAt: { $min: "$createdAt" },
          lifetimeOrders: { $sum: 1 },
        },
      },
    ]);
    return new Map(rows.map((row) => [String(row._id), {
      firstOrderAt: asDate(row.firstOrderAt),
      lifetimeOrders: row.lifetimeOrders,
    }]));
  }
  const wanted = new Set(customerIds);
  const earliest = new Map();
  memoryStore
    .find("orders", (order) => wanted.has(String(order.buyerId)) && isBookedOrder(order))
    .forEach((order) => {
      const key = String(order.buyerId);
      const placedAt = asDate(order.createdAt);
      const history = earliest.get(key) || { firstOrderAt: placedAt, lifetimeOrders: 0 };
      if (placedAt < history.firstOrderAt) history.firstOrderAt = placedAt;
      history.lifetimeOrders += 1;
      earliest.set(key, history);
    });
  return earliest;
};

const buildCustomerMetrics = (orders, customerHistory, rangeStart) => {
  const customers = new Map();
  orders.filter(isBookedOrder).forEach((order) => {
    const customerId = String(order.buyerId || order.buyerEmail || "guest");
    const row = customers.get(customerId) || {
      customerId,
      name: order.buyerName || "Customer",
      email: order.buyerEmail || "",
      bookedSales: 0,
      orders: 0,
      units: 0,
      lastOrderAt: null,
    };
    row.name = order.buyerName || row.name;
    row.email = order.buyerEmail || row.email;
    const createdAt = asDate(order.createdAt);
    row.bookedSales = roundMoney(row.bookedSales + Number(order.total || 0));
    row.orders += 1;
    row.units += orderUnits(order);
    if (!row.lastOrderAt || createdAt > row.lastOrderAt) row.lastOrderAt = createdAt;
    customers.set(customerId, row);
  });

  let newCustomers = 0;
  let returningCustomers = 0;
  let repeatCustomers = 0;
  const rows = [...customers.values()].map((customer) => {
    const history = customerHistory.get(customer.customerId);
    const firstOrderAt = history?.firstOrderAt;
    const isNew = Boolean(firstOrderAt && firstOrderAt >= rangeStart);
    const isRepeat = Number(history?.lifetimeOrders || 0) >= 2;
    if (isNew) newCustomers += 1;
    else returningCustomers += 1;
    if (isRepeat) repeatCustomers += 1;
    return {
      ...customer,
      firstOrderAt: firstOrderAt?.toISOString() || null,
      lastOrderAt: customer.lastOrderAt?.toISOString() || null,
      customerType: isNew ? "new" : "returning",
      lifetimeOrders: Number(history?.lifetimeOrders || customer.orders),
    };
  });
  const unique = rows.length;
  return {
    unique,
    new: newCustomers,
    returning: returningCustomers,
    returningRate: unique ? roundPercent((returningCustomers / unique) * 100) : 0,
    repeat: repeatCustomers,
    repeatRate: unique ? roundPercent((repeatCustomers / unique) * 100) : 0,
    top: rows
      .sort((left, right) => right.bookedSales - left.bookedSales || right.orders - left.orders)
      .slice(0, TOP_CUSTOMER_LIMIT),
  };
};

const fillSeries = (series, orders, range) => {
  const byPeriod = new Map(series.map((row) => [row.period, row]));
  orders.forEach((order) => {
    const row = byPeriod.get(bucketKey(asDate(order.createdAt), range));
    if (!row) return;
    const value = Number(order.total || 0);
    if (isCancelled(order)) {
      row.cancelledOrders += 1;
      row.cancelledValue = roundMoney(row.cancelledValue + value);
      return;
    }
    if (isRefunded(order)) {
      row.refundedOrders += 1;
      row.refundedValue = roundMoney(row.refundedValue + value);
      return;
    }
    if (isFailedPayment(order)) {
      row.failedPaymentOrders += 1;
      row.failedPaymentValue = roundMoney(row.failedPaymentValue + value);
      return;
    }
    row.bookedSales = roundMoney(row.bookedSales + value);
    row.orders += 1;
    row.units += orderUnits(order);
    const paymentStatus = normalizePaymentStatus(order);
    if (paymentStatus === "paid") row.paidSales = roundMoney(row.paidSales + value);
    else if (paymentStatus === "pending") {
      row.pendingPaymentSales = roundMoney(row.pendingPaymentSales + value);
    } else row.otherPaymentSales = roundMoney(row.otherPaymentSales + value);
  });
  return series;
};

const analyticsPayload = async (query, now = new Date()) => {
  const filter = resolveAnalyticsRange(query, now);
  const mode = await connectDatabase();
  const allWindowOrders = await fetchOrders(mode, filter.previousFrom, filter.endExclusive);
  const currentOrders = ordersInWindow(allWindowOrders, filter.from, filter.endExclusive);
  const previousOrders = ordersInWindow(
    allWindowOrders,
    filter.previousFrom,
    filter.previousEndExclusive,
  );
  const currentSummary = summarizeOrders(currentOrders);
  const previousSummary = summarizeOrders(previousOrders);
  const currentCustomerIds = [
    ...new Set(currentOrders.filter(isBookedOrder).map((order) => String(order.buyerId))),
  ].filter(Boolean);
  const previousCustomerIds = new Set(
    previousOrders.filter(isBookedOrder).map((order) => String(order.buyerId)),
  );
  const customerHistory = await fetchCustomerHistory(mode, currentCustomerIds);
  const customers = buildCustomerMetrics(currentOrders, customerHistory, filter.from);
  const previousCustomers = previousCustomerIds.size;

  const kpis = {
    ...currentSummary,
    totalOrders: currentOrders.length,
    customers: customers.unique,
    newCustomers: customers.new,
    returningCustomers: customers.returning,
    returningCustomerRate: customers.returningRate,
    repeatCustomers: customers.repeat,
    repeatCustomerRate: customers.repeatRate,
  };
  const previous = {
    ...previousSummary,
    customers: previousCustomers,
  };
  const comparison = {
    bookedSales: percentChange(kpis.bookedSales, previous.bookedSales),
    orders: percentChange(kpis.orders, previous.orders),
    units: percentChange(kpis.units, previous.units),
    averageOrderValue: percentChange(kpis.averageOrderValue, previous.averageOrderValue),
    customers: percentChange(kpis.customers, previous.customers),
    previous,
    changePct: {
      bookedSales: percentChange(kpis.bookedSales, previous.bookedSales),
      orders: percentChange(kpis.orders, previous.orders),
      units: percentChange(kpis.units, previous.units),
      averageOrderValue: percentChange(kpis.averageOrderValue, previous.averageOrderValue),
      customers: percentChange(kpis.customers, previous.customers),
    },
  };

  return {
    data: {
      filter: {
        range: filter.range,
        from: dateString(filter.from),
        to: dateString(filter.to),
        timezone: TIMEZONE,
        previousFrom: dateString(filter.previousFrom),
        previousTo: dateString(filter.previousTo),
      },
      kpis,
      comparison,
      series: fillSeries(makeSeries(filter), currentOrders, filter.range),
      products: buildProductRows(currentOrders),
      orderStatuses: buildStatusRows(currentOrders, kpis.bookedSales),
      paymentStatuses: buildPaymentRows(currentOrders, kpis.bookedSales),
      customers,
      metricDefinitions: {
        bookedSales:
          "Order totals booked in this date range, excluding cancelled, refunded and failed-payment orders. This is not cash collected.",
        paidSales: "Booked order totals whose payment status is marked paid.",
        pendingPaymentSales: "Booked order totals still awaiting manual payment confirmation.",
        productBookedSales:
          "Snapshot merchandise value (unit price × quantity) before order-level discounts and shipping.",
        dateBasis: `Orders are counted by the date they were placed in ${TIMEZONE}.`,
        comparison: "Compared with the immediately preceding period of the same number of days.",
        returningCustomers: "Customers whose first booked order predates the selected range.",
        repeatCustomerRate: "Customers in the range who have at least two lifetime booked orders.",
      },
      generatedAt: now.toISOString(),
    },
    currentOrders,
  };
};

export const getSalesAnalytics = async (query, options) =>
  (await analyticsPayload(query, options?.now)).data;

const safeCellText = (value) => {
  const text = [...String(value ?? "")]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
};

const maskEmail = (email) => {
  const [local = "", domain = ""] = String(email || "").split("@");
  if (!domain) return "";
  return `${local.slice(0, 1) || "*"}${"*".repeat(Math.min(5, Math.max(2, local.length - 1)))}@${domain}`;
};

const validDateOrBlank = (value) => {
  if (!value) return null;
  const date = asDate(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const excelISTDateTime = (value) => {
  const date = validDateOrBlank(value);
  return date ? new Date(date.getTime() + IST_OFFSET_MS) : null;
};

const formatISTDateTime = (value) => new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIMEZONE,
}).format(asDate(value));

const numberOrBlank = (value) => {
  if (value === "" || value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? roundMoney(numeric) : null;
};

const safeHttpUrl = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return safeCellText(url.toString());
  } catch {
    return "";
  }
};

const humanizeKey = (key) => String(key || "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[_-]+/g, " ")
  .replace(/^./, (character) => character.toUpperCase());

const hiddenCustomizationKeys = new Set([
  "id",
  "_id",
  "ownerid",
  "userid",
  "publicid",
  "expiresat",
  "pending",
]);

const flattenCustomization = (value, path = [], depth = 0) => {
  if (value == null || value === "" || depth > 4) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenCustomization(entry, path, depth + 1));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => {
      if (hiddenCustomizationKeys.has(key.toLowerCase())) return [];
      return flattenCustomization(entry, [...path, humanizeKey(key)], depth + 1);
    });
  }
  const raw = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value).trim();
  if (!raw) return [];
  const label = path.join(" ");
  const displayed = /(?:url|link)$/i.test(path.at(-1) || "") ? safeHttpUrl(raw) : safeCellText(raw);
  return displayed ? [`${label || "Detail"}: ${displayed}`] : [];
};

const customizationText = (value) => {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object") {
      return safeCellText(flattenCustomization(parsed).join("\n").slice(0, 30_000));
    }
  } catch {
    // Legacy customizations can be plain text; keep the customer-authored wording.
  }
  return safeCellText(source.slice(0, 30_000));
};

const orderFinancialBucket = (order) => {
  if (isCancelled(order)) return "Cancelled";
  if (isRefunded(order)) return "Refunded";
  if (isFailedPayment(order)) return "Failed payment";
  const paymentStatus = normalizePaymentStatus(order);
  if (paymentStatus === "paid") return "Booked · Paid";
  if (paymentStatus === "pending") return "Booked · Pending";
  return "Booked · Other";
};

const orderItemsText = (order) => (order.items || [])
  .map((item) => `${safeCellText(item.name || "Unnamed product")} × ${Number(item.quantity || 0)}`)
  .join("\n");

const orderCustomizationsText = (order) => (order.items || [])
  .map((item) => ({ name: item.name || "Item", detail: customizationText(item.customization) }))
  .filter(({ detail }) => detail)
  .map(({ name, detail }) => `${safeCellText(name)}\n${detail}`)
  .join("\n\n");

const workbookPalette = {
  wine: "6D1F3A",
  forest: "143D34",
  gold: "D9B566",
  cream: "FFF9F0",
  blush: "F4E4E1",
  sage: "E2ECE7",
  ink: "27231F",
  white: "FFFFFF",
  muted: "716B64",
  line: "DCCFC0",
  danger: "A83245",
};

const currencyFormat = '₹#,##0.00;[Red](₹#,##0.00);-';
const integerFormat = '#,##0;[Red](#,##0);-';
const dateTimeFormat = "dd mmm yyyy, h:mm AM/PM";
const dateFormat = "dd mmm yyyy";

const sanitizeRows = (rows) => rows.map((row) => row.map((value) => (
  typeof value === "string" ? safeCellText(value) : value
)));

const addSheetHeading = (sheet, title, subtitle, columnCount) => {
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.mergeCells(2, 1, 2, columnCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = safeCellText(title);
  titleCell.font = { name: "Aptos Display", size: 22, bold: true, color: { argb: workbookPalette.white } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: workbookPalette.forest } };
  titleCell.alignment = { vertical: "middle" };
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = safeCellText(subtitle);
  subtitleCell.font = { name: "Aptos", size: 10, color: { argb: workbookPalette.white } };
  subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: workbookPalette.forest } };
  subtitleCell.alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 34;
  sheet.getRow(2).height = 28;
};

const addDataSheet = ({
  workbook,
  name,
  title,
  subtitle,
  tableName,
  columns,
  rows,
  freezeColumns = 1,
  tabColor = workbookPalette.gold,
}) => {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: tabColor } } });
  addSheetHeading(sheet, title, subtitle, columns.length);
  sheet.addTable({
    name: tableName,
    ref: "A4",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium4", showRowStripes: true, showFirstColumn: false },
    columns: columns.map(({ header }) => ({ name: header, filterButton: true })),
    rows: sanitizeRows(rows),
  });
  sheet.views = [{
    state: "frozen",
    xSplit: freezeColumns,
    ySplit: 4,
    topLeftCell: `${freezeColumns ? "B" : "A"}5`,
    showGridLines: false,
  }];
  sheet.properties.defaultRowHeight = 20;
  sheet.getRow(4).height = 34;
  sheet.getRow(4).eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: workbookPalette.white } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    excelColumn.width = column.width;
    excelColumn.alignment = {
      vertical: "top",
      horizontal: column.align || (column.kind === "currency" || column.kind === "integer" ? "right" : "left"),
      wrapText: Boolean(column.wrap),
    };
    if (column.kind === "currency") excelColumn.numFmt = currencyFormat;
    if (column.kind === "integer") excelColumn.numFmt = integerFormat;
    if (column.kind === "date") excelColumn.numFmt = dateFormat;
    if (column.kind === "datetime") excelColumn.numFmt = dateTimeFormat;
    if (column.kind === "percent") excelColumn.numFmt = "0.0%";
    if (column.kind === "text") excelColumn.numFmt = "@";
  });
  const wrappedColumns = columns
    .map((column, index) => (column.wrap ? { index, width: column.width } : null))
    .filter(Boolean);
  if (wrappedColumns.length) {
    rows.forEach((row, index) => {
      const visualLines = wrappedColumns.reduce((maximum, column) => {
        const value = row[column.index];
        if (value == null || typeof value === "object") return maximum;
        const lines = String(value).split(/\r?\n/).reduce(
          (sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(12, column.width - 3))),
          0,
        );
        return Math.max(maximum, lines);
      }, 1);
      sheet.getRow(index + 5).height = Math.min(90, Math.max(20, visualLines * 15 + 5));
    });
  }
  return sheet;
};

const setCard = (sheet, { fromColumn, toColumn, row, label, value, kind = "integer" }) => {
  sheet.mergeCells(row, fromColumn, row, toColumn);
  sheet.mergeCells(row + 1, fromColumn, row + 2, toColumn);
  const labelCell = sheet.getCell(row, fromColumn);
  const valueCell = sheet.getCell(row + 1, fromColumn);
  labelCell.value = safeCellText(label);
  labelCell.font = { name: "Aptos", size: 9, bold: true, color: { argb: workbookPalette.muted } };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: workbookPalette.cream } };
  labelCell.alignment = { vertical: "middle" };
  valueCell.value = value;
  valueCell.font = { name: "Aptos Display", size: 19, bold: true, color: { argb: workbookPalette.forest } };
  valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: workbookPalette.cream } };
  valueCell.alignment = { vertical: "middle" };
  if (kind === "currency") valueCell.numFmt = currencyFormat;
  else valueCell.numFmt = integerFormat;
  for (let rowNumber = row; rowNumber <= row + 2; rowNumber += 1) {
    for (let column = fromColumn; column <= toColumn; column += 1) {
      sheet.getCell(rowNumber, column).border = {
        bottom: { style: "thin", color: { argb: workbookPalette.line } },
      };
    }
  }
};

const addExecutiveSummarySheet = (workbook, analytics, customRequestCount) => {
  const sheet = workbook.addWorksheet("Executive Summary", {
    properties: { tabColor: { argb: workbookPalette.wine } },
  });
  addSheetHeading(
    sheet,
    "Sales export · decision view",
    `${analytics.filter.from} to ${analytics.filter.to} · ${analytics.filter.timezone} · Generated ${formatISTDateTime(analytics.generatedAt)} · Contains customer contact data: admin use only`,
    8,
  );
  sheet.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  for (let column = 1; column <= 8; column += 1) sheet.getColumn(column).width = 16;
  setCard(sheet, { fromColumn: 1, toColumn: 2, row: 5, label: "BOOKED SALES", value: analytics.kpis.bookedSales, kind: "currency" });
  setCard(sheet, { fromColumn: 3, toColumn: 4, row: 5, label: "PAID SALES (MARKED)", value: analytics.kpis.paidSales, kind: "currency" });
  setCard(sheet, { fromColumn: 5, toColumn: 6, row: 5, label: "PENDING COLLECTION", value: analytics.kpis.pendingPaymentSales, kind: "currency" });
  setCard(sheet, { fromColumn: 7, toColumn: 8, row: 5, label: "BOOKED ORDERS", value: analytics.kpis.orders });
  setCard(sheet, { fromColumn: 1, toColumn: 2, row: 9, label: "AVERAGE ORDER VALUE", value: analytics.kpis.averageOrderValue, kind: "currency" });
  setCard(sheet, { fromColumn: 3, toColumn: 4, row: 9, label: "UNIQUE CUSTOMERS", value: analytics.kpis.customers });
  setCard(sheet, { fromColumn: 5, toColumn: 6, row: 9, label: "CUSTOM REQUESTS", value: customRequestCount });
  setCard(sheet, { fromColumn: 7, toColumn: 8, row: 9, label: "REFUNDED ORDER VALUE", value: analytics.kpis.refundedValue, kind: "currency" });

  sheet.mergeCells("A13:H13");
  sheet.getCell("A13").value = "HOW TO USE THIS WORKBOOK";
  sheet.getCell("A13").font = { bold: true, color: { argb: workbookPalette.wine } };
  const guide = [
    ["Normal Orders", "One row per order. Use this sheet for customer, delivery and order-level sales analysis."],
    ["Order Items", "One row per item. Join on Order number for product and customer customization analysis."],
    ["Custom Requests", "Separate inquiry schema; these are briefs, not confirmed sales."],
    ["Financial Reconciliation", "The final sheet ties every order total to booked, paid, pending, cancelled, refunded or failed activity."],
  ];
  sheet.mergeCells("A14:B14");
  sheet.mergeCells("C14:H14");
  sheet.getCell("A14").value = "Sheet";
  sheet.getCell("C14").value = "Use";
  ["A14", "C14"].forEach((address) => {
    sheet.getCell(address).font = { bold: true, color: { argb: workbookPalette.white } };
    sheet.getCell(address).fill = { type: "pattern", pattern: "solid", fgColor: { argb: workbookPalette.forest } };
  });
  guide.forEach(([guideSheet, use], index) => {
    const row = 15 + index;
    sheet.mergeCells(row, 1, row, 2);
    sheet.mergeCells(row, 3, row, 8);
    sheet.getCell(row, 1).value = safeCellText(guideSheet);
    sheet.getCell(row, 3).value = safeCellText(use);
    sheet.getCell(row, 1).font = { bold: true, color: { argb: workbookPalette.wine } };
    sheet.getCell(row, 3).alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(row).height = 34;
    if (index % 2 === 0) {
      [sheet.getCell(row, 1), sheet.getCell(row, 3)].forEach((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: workbookPalette.cream } };
      });
    }
  });
  return sheet;
};

const normalOrderColumns = [
  { header: "Order number", width: 23, kind: "text" },
  { header: "Order date", width: 22, kind: "datetime" },
  { header: "Customer name", width: 24 },
  { header: "Customer email", width: 32 },
  { header: "Contact / delivery phone", width: 24, kind: "text" },
  { header: "Recipient name", width: 24 },
  { header: "Address line 1", width: 30, wrap: true },
  { header: "Address line 2", width: 24, wrap: true },
  { header: "City", width: 18 },
  { header: "State", width: 18 },
  { header: "Postal code", width: 14, kind: "text" },
  { header: "Country", width: 14 },
  { header: "Order status", width: 16 },
  { header: "Payment status", width: 16 },
  { header: "Payment method", width: 20 },
  { header: "Financial bucket", width: 20 },
  { header: "Line-item count", width: 16, kind: "integer" },
  { header: "Total quantity", width: 16, kind: "integer" },
  { header: "Items ordered", width: 38, wrap: true },
  { header: "Customer customization", width: 48, wrap: true },
  { header: "Order note", width: 34, wrap: true },
  { header: "Needed by", width: 16, kind: "date" },
  { header: "Contact preference", width: 20 },
  { header: "Coupon code", width: 16, kind: "text" },
  { header: "Subtotal", width: 16, kind: "currency" },
  { header: "Discount", width: 16, kind: "currency" },
  { header: "Delivery", width: 16, kind: "currency" },
  { header: "Order total", width: 17, kind: "currency" },
  { header: "Booked sales", width: 18, kind: "currency" },
  { header: "Paid sales (marked)", width: 19, kind: "currency" },
  { header: "Pending collection", width: 19, kind: "currency" },
  { header: "Other booked sales", width: 22, kind: "currency" },
  { header: "Cancelled value", width: 18, kind: "currency" },
  { header: "Refunded order value", width: 22, kind: "currency" },
  { header: "Failed-payment value", width: 22, kind: "currency" },
];

const normalOrderRow = (order) => {
  const total = numberOrBlank(order.total);
  const bucket = orderFinancialBucket(order);
  const address = order.shippingAddress || {};
  const booked = bucket.startsWith("Booked");
  return [
    order.orderNumber || "",
    excelISTDateTime(order.createdAt),
    order.buyerName || "",
    order.buyerEmail || "",
    address.phone || "",
    address.recipientName || "",
    address.line1 || "",
    address.line2 || "",
    address.city || "",
    address.state || "",
    address.postalCode || "",
    address.country || "",
    statusLabels[order.status] || order.status || "",
    paymentStatusLabels[normalizePaymentStatus(order)] || normalizePaymentStatus(order),
    order.paymentMethod === "manual_confirmation" ? "Manual confirmation" : order.paymentMethod || "",
    bucket,
    (order.items || []).length,
    (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    orderItemsText(order),
    orderCustomizationsText(order),
    order.note || "",
    validDateOrBlank(order.neededBy),
    order.contactPreference || "",
    order.couponCode || "",
    numberOrBlank(order.subtotal),
    numberOrBlank(order.discount),
    numberOrBlank(order.shippingFee),
    total,
    booked ? total : null,
    bucket === "Booked · Paid" ? total : null,
    bucket === "Booked · Pending" ? total : null,
    bucket === "Booked · Other" ? total : null,
    bucket === "Cancelled" ? total : null,
    bucket === "Refunded" ? total : null,
    bucket === "Failed payment" ? total : null,
  ];
};

const orderItemColumns = [
  { header: "Order number", width: 23, kind: "text" },
  { header: "Order date", width: 22, kind: "datetime" },
  { header: "Product", width: 36 },
  { header: "Product page slug", width: 34, kind: "text" },
  { header: "Category", width: 24 },
  { header: "Quantity", width: 12, kind: "integer" },
  { header: "Unit price", width: 16, kind: "currency" },
  { header: "Line value", width: 16, kind: "currency" },
  { header: "Customer customization", width: 54, wrap: true },
];

const orderItemRows = (orders) => orders.flatMap((order) => (order.items || []).map((item) => {
  const quantity = item.quantity == null ? null : Number(item.quantity);
  const unitPrice = numberOrBlank(item.unitPrice);
  return [
    order.orderNumber || "",
    excelISTDateTime(order.createdAt),
    item.name || "",
    item.slug || "",
    item.category || "",
    Number.isFinite(quantity) ? quantity : null,
    unitPrice,
    Number.isFinite(quantity) && unitPrice != null ? roundMoney(quantity * unitPrice) : null,
    customizationText(item.customization),
  ];
}));

const customRequestColumns = [
  { header: "Request date", width: 22, kind: "datetime" },
  { header: "Customer name", width: 24 },
  { header: "Email", width: 32 },
  { header: "Contact number", width: 20, kind: "text" },
  { header: "Piece type", width: 24 },
  { header: "Occasion", width: 20 },
  { header: "Budget", width: 20 },
  { header: "Needed by", width: 16, kind: "date" },
  { header: "Stage", width: 16 },
  { header: "Contact preference", width: 20 },
  { header: "Design brief", width: 54, wrap: true },
  { header: "Customer customization", width: 48, wrap: true },
  { header: "Colour palette", width: 28, wrap: true },
  { header: "Inspiration link", width: 42, kind: "text", wrap: true },
  { header: "Uploaded reference links", width: 48, kind: "text", wrap: true },
  { header: "Reference count", width: 16, kind: "integer" },
];

const customRequestRow = (request) => {
  const references = (request.referenceImages || []).map(safeHttpUrl).filter(Boolean);
  return [
    excelISTDateTime(request.createdAt),
    request.name || "",
    request.email || "",
    request.phone || "",
    request.category || "",
    request.occasion || "",
    request.budget || "",
    validDateOrBlank(request.neededBy),
    request.status === "new" ? "New idea" : humanizeKey(request.status),
    request.contactPreference || "",
    request.idea || "",
    request.customization || "",
    request.palette || "",
    safeHttpUrl(request.referenceUrl),
    references.join("\n"),
    references.length,
  ];
};

const addTrendSheet = (workbook, analytics) => addDataSheet({
  workbook,
  name: "Sales Trend",
  title: "Sales trend",
  subtitle: `Period view in ${analytics.filter.timezone}; excluded activity remains visible for reconciliation.`,
  tableName: "SalesTrendTable",
  columns: [
    { header: "Period", width: 24 },
    { header: "From", width: 14, kind: "date" },
    { header: "To", width: 14, kind: "date" },
    { header: "Booked sales", width: 18, kind: "currency" },
    { header: "Paid sales (marked)", width: 19, kind: "currency" },
    { header: "Pending collection", width: 19, kind: "currency" },
    { header: "Orders", width: 12, kind: "integer" },
    { header: "Units", width: 12, kind: "integer" },
    { header: "Cancelled orders", width: 18, kind: "integer" },
    { header: "Cancelled value", width: 18, kind: "currency" },
    { header: "Refunded orders", width: 18, kind: "integer" },
    { header: "Refunded order value", width: 22, kind: "currency" },
    { header: "Failed-payment orders", width: 23, kind: "integer" },
    { header: "Failed-payment value", width: 22, kind: "currency" },
  ],
  rows: analytics.series.map((row) => [
    row.label,
    new Date(`${row.from}T00:00:00.000Z`),
    new Date(`${row.to}T00:00:00.000Z`),
    row.bookedSales,
    row.paidSales,
    row.pendingPaymentSales,
    row.orders,
    row.units,
    row.cancelledOrders,
    row.cancelledValue,
    row.refundedOrders,
    row.refundedValue,
    row.failedPaymentOrders,
    row.failedPaymentValue,
  ]),
});

const addProductsSheet = (workbook, analytics) => addDataSheet({
  workbook,
  name: "Product Analysis",
  title: "Product analysis",
  subtitle: "Merchandise values use order snapshots before order-level discounts and delivery charges.",
  tableName: "ProductAnalysisTable",
  columns: [
    { header: "Rank", width: 10, kind: "integer" },
    { header: "Product", width: 40 },
    { header: "Product page slug", width: 34, kind: "text" },
    { header: "Category", width: 24 },
    { header: "Units", width: 12, kind: "integer" },
    { header: "Orders", width: 12, kind: "integer" },
    { header: "Booked merchandise", width: 22, kind: "currency" },
    { header: "Paid merchandise", width: 20, kind: "currency" },
    { header: "Share", width: 12, kind: "percent" },
  ],
  rows: analytics.products.map((product, index) => [
    index + 1,
    product.name,
    product.slug,
    product.category || "",
    product.units,
    product.orders,
    product.bookedSales,
    product.paidSales,
    product.share / 100,
  ]),
});

const addCustomersSheet = (workbook, analytics) => addDataSheet({
  workbook,
  name: "Customer Analysis",
  title: "Customer analysis",
  subtitle: "Top customers by booked sales. Full order-time contact details remain in the admin-only Normal Orders sheet.",
  tableName: "CustomerAnalysisTable",
  columns: [
    { header: "Rank", width: 10, kind: "integer" },
    { header: "Customer", width: 30 },
    { header: "Masked email", width: 32 },
    { header: "Type", width: 14 },
    { header: "Orders", width: 12, kind: "integer" },
    { header: "Units", width: 12, kind: "integer" },
    { header: "Booked sales", width: 18, kind: "currency" },
    { header: "First booked order", width: 20, kind: "datetime" },
    { header: "Last order in range", width: 20, kind: "datetime" },
    { header: "Lifetime orders", width: 16, kind: "integer" },
  ],
  rows: analytics.customers.top.map((customer, index) => [
    index + 1,
    customer.name,
    maskEmail(customer.email),
    customer.customerType === "new" ? "New" : "Returning",
    customer.orders,
    customer.units,
    customer.bookedSales,
    excelISTDateTime(customer.firstOrderAt),
    excelISTDateTime(customer.lastOrderAt),
    customer.lifetimeOrders,
  ]),
});

const excelColumnName = (index) => {
  let column = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
  }
  return column;
};

const addFinancialReconciliationSheet = (workbook, analytics, orders) => {
  const sheet = workbook.addWorksheet("Financial Reconciliation", {
    properties: { tabColor: { argb: workbookPalette.forest } },
  });
  addSheetHeading(
    sheet,
    "Financial reconciliation",
    "Every order total appears exactly once in Normal Orders. Booked sales are not cash collected; custom requests never enter sales.",
    5,
  );
  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  const startRow = 5;
  const endRow = Math.max(startRow, 4 + orders.length);
  const bucketCounts = orders.reduce((counts, order) => {
    const bucket = orderFinancialBucket(order);
    counts[bucket] = (counts[bucket] || 0) + 1;
    return counts;
  }, {});
  const totalColumn = excelColumnName(normalOrderColumns.findIndex(({ header }) => header === "Order total") + 1);
  const bucketColumn = excelColumnName(normalOrderColumns.findIndex(({ header }) => header === "Financial bucket") + 1);
  const range = (column) => `'Normal Orders'!$${column}$${startRow}:$${column}$${endRow}`;
  const totalRange = range(totalColumn);
  const bucketRange = range(bucketColumn);
  const grossActivity = roundMoney(
    analytics.kpis.bookedSales
      + analytics.kpis.cancelledValue
      + analytics.kpis.refundedValue
      + analytics.kpis.failedPaymentValue,
  );
  const bookedReconciliationDelta = roundMoney(
    grossActivity
      - analytics.kpis.cancelledValue
      - analytics.kpis.refundedValue
      - analytics.kpis.failedPaymentValue
      - analytics.kpis.bookedSales,
  );
  const paymentReconciliationDelta = roundMoney(
    analytics.kpis.paidSales
      + analytics.kpis.pendingPaymentSales
      + analytics.kpis.otherPaymentSales
      - analytics.kpis.bookedSales,
  );
  const rows = [
    ["Gross order activity", { formula: `SUM(${totalRange})`, result: grossActivity }, { formula: `COUNTA('Normal Orders'!$A$${startRow}:$A$${endRow})`, result: analytics.kpis.totalOrders }, "All order totals created in the selected date range."],
    ["Booked sales", { formula: `SUMIF(${bucketRange},"Booked*",${totalRange})`, result: analytics.kpis.bookedSales }, { formula: `COUNTIF(${bucketRange},"Booked*")`, result: analytics.kpis.orders }, "Order totals booked in the range; this is not cash collected."],
    ["Paid sales (marked)", { formula: `SUMIF(${bucketRange},"Booked · Paid",${totalRange})`, result: analytics.kpis.paidSales }, { formula: `COUNTIF(${bucketRange},"Booked · Paid")`, result: bucketCounts["Booked · Paid"] || 0 }, "Booked orders whose payment status is marked paid."],
    ["Pending collection", { formula: `SUMIF(${bucketRange},"Booked · Pending",${totalRange})`, result: analytics.kpis.pendingPaymentSales }, { formula: `COUNTIF(${bucketRange},"Booked · Pending")`, result: bucketCounts["Booked · Pending"] || 0 }, "Booked orders awaiting manual payment confirmation."],
    ["Other booked sales", { formula: `SUMIF(${bucketRange},"Booked · Other",${totalRange})`, result: analytics.kpis.otherPaymentSales }, { formula: `COUNTIF(${bucketRange},"Booked · Other")`, result: bucketCounts["Booked · Other"] || 0 }, "Any booked payment state outside paid and pending."],
    ["Cancelled value", { formula: `SUMIF(${bucketRange},"Cancelled",${totalRange})`, result: analytics.kpis.cancelledValue }, { formula: `COUNTIF(${bucketRange},"Cancelled")`, result: analytics.kpis.cancelledOrders }, "Cancelled orders, excluded from booked sales."],
    ["Refunded order value", { formula: `SUMIF(${bucketRange},"Refunded",${totalRange})`, result: analytics.kpis.refundedValue }, { formula: `COUNTIF(${bucketRange},"Refunded")`, result: analytics.kpis.refundedOrders }, "Original value of non-cancelled orders marked refunded; not a confirmed payout or partial-refund amount."],
    ["Failed-payment value", { formula: `SUMIF(${bucketRange},"Failed payment",${totalRange})`, result: analytics.kpis.failedPaymentValue }, { formula: `COUNTIF(${bucketRange},"Failed payment")`, result: analytics.kpis.failedPaymentOrders }, "Failed-payment orders, excluded from booked sales."],
  ];
  sheet.addTable({
    name: "FinancialReconciliationTable",
    ref: "A4",
    headerRow: true,
    style: { theme: "TableStyleMedium4", showRowStripes: true },
    columns: [
      { name: "Financial measure" },
      { name: "Amount" },
      { name: "Orders" },
      { name: "Definition" },
    ],
    rows,
  });
  const checkStart = 15;
  sheet.getCell(`A${checkStart}`).value = "RECONCILIATION CHECKS";
  sheet.getCell(`A${checkStart}`).font = { bold: true, color: { argb: workbookPalette.wine } };
  sheet.addTable({
    name: "FinancialChecksTable",
    ref: `A${checkStart + 1}`,
    headerRow: true,
    style: { theme: "TableStyleMedium4", showRowStripes: true },
    columns: [{ name: "Check" }, { name: "Delta" }, { name: "Status" }, { name: "Meaning" }],
    rows: [
      ["Gross less excluded equals booked", bookedReconciliationDelta, Math.abs(bookedReconciliationDelta) < 0.005 ? "PASS" : "CHECK", "Server-verified snapshot: gross activity − cancelled − refunded − failed = booked sales."],
      ["Paid plus pending plus other equals booked", paymentReconciliationDelta, Math.abs(paymentReconciliationDelta) < 0.005 ? "PASS" : "CHECK", "Server-verified snapshot: booked sales are fully classified by payment state."],
    ],
  });
  sheet.getColumn("A").width = 40;
  sheet.getColumn("B").width = 22;
  sheet.getColumn("B").numFmt = currencyFormat;
  sheet.getColumn("C").width = 16;
  sheet.getColumn("C").numFmt = integerFormat;
  sheet.getColumn("D").width = 78;
  sheet.getColumn("D").alignment = { wrapText: true, vertical: "top" };
  sheet.getRow(4).height = 30;
  sheet.getRow(checkStart + 1).height = 30;
  [4, checkStart + 1].forEach((rowNumber) => sheet.getRow(rowNumber).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: workbookPalette.white } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  }));
  sheet.getCell("B17").numFmt = currencyFormat;
  sheet.getCell("B18").numFmt = currencyFormat;
  ["C17", "C18"].forEach((address) => {
    sheet.getCell(address).fill = { type: "pattern", pattern: "solid", fgColor: { argb: workbookPalette.sage } };
    sheet.getCell(address).font = { bold: true, color: { argb: workbookPalette.forest } };
  });
  return sheet;
};

export const createSalesAnalyticsWorkbook = async (query, options) => {
  const now = options?.now || new Date();
  const [{ data: analytics }, mode] = await Promise.all([
    analyticsPayload(query, now),
    connectDatabase(),
  ]);
  const exportRange = resolveAnalyticsRange(query, now);
  const [orders, customRequests] = await Promise.all([
    fetchDetailedExportOrders(mode, exportRange.from, exportRange.endExclusive),
    fetchExportCustomRequests(mode, exportRange.from, exportRange.endExclusive),
  ]);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gift N Wrap Studio";
  workbook.company = "Gift N Wrap Studio";
  workbook.subject = "Sales analysis";
  workbook.title = `Sales analysis · ${analytics.filter.from} to ${analytics.filter.to}`;
  workbook.created = asDate(analytics.generatedAt);
  workbook.modified = asDate(analytics.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  workbook.calcProperties.calcMode = "auto";

  addExecutiveSummarySheet(workbook, analytics, customRequests.length);
  addDataSheet({
    workbook,
    name: "Normal Orders",
    title: "Normal orders · one row per order",
    subtitle: "Order totals appear once only. Customer contact and delivery details are historical snapshots captured at checkout.",
    tableName: "NormalOrdersTable",
    columns: normalOrderColumns,
    rows: orders.map(normalOrderRow),
    tabColor: workbookPalette.wine,
  });
  addDataSheet({
    workbook,
    name: "Order Items",
    title: "Order items · one row per item",
    subtitle: "Use Order number to join to Normal Orders. Order totals are intentionally omitted to prevent double-counting.",
    tableName: "OrderItemsTable",
    columns: orderItemColumns,
    rows: orderItemRows(orders),
  });
  addDataSheet({
    workbook,
    name: "Custom Requests",
    title: "Custom requests · inquiry pipeline",
    subtitle: "Separate from confirmed orders and sales. Reference links are plain HTTP/HTTPS text, never executable formulas.",
    tableName: "CustomRequestsTable",
    columns: customRequestColumns,
    rows: customRequests.map(customRequestRow),
    tabColor: workbookPalette.blush,
  });
  addTrendSheet(workbook, analytics);
  addProductsSheet(workbook, analytics);
  addCustomersSheet(workbook, analytics);
  addFinancialReconciliationSheet(workbook, analytics, orders);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: `gift-n-wrap-sales-${analytics.filter.from}-to-${analytics.filter.to}.xlsx`,
    analytics,
  };
};

export const spreadsheetTextForTests = safeCellText;
