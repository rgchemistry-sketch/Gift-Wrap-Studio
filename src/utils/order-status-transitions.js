const fulfilmentRank = new Map([
  ['placed', 0],
  ['confirmed', 1],
  ['in_progress', 2],
  ['ready', 3],
  ['shipped', 4],
  ['delivered', 5],
]);

const terminalStatuses = new Set(['cancelled', 'delivered']);
const undoableStatuses = new Set(['placed', 'confirmed', 'in_progress', 'ready']);

export const BULK_ORDER_STATUS_TARGETS = ['in_progress', 'ready'];

// Mirrors the order transition contract enforced by server/services/store.js.
export const canUpdateOrderStatus = (
  from,
  to,
  { undo = false, expectedStatus = '' } = {},
) => {
  if (!from || !to) return false;
  if (undo && !expectedStatus) return false;
  if (expectedStatus && expectedStatus !== from) return false;
  if (from === to) return true;

  if (undo) {
    return expectedStatus === from
      && undoableStatuses.has(from)
      && undoableStatuses.has(to);
  }

  if (terminalStatuses.has(from)) return false;
  if (to === 'cancelled') {
    return (fulfilmentRank.get(from) ?? Number.POSITIVE_INFINITY)
      < fulfilmentRank.get('shipped');
  }

  const fromRank = fulfilmentRank.get(from);
  const toRank = fulfilmentRank.get(to);
  return fromRank != null && toRank != null && toRank > fromRank;
};

export const canMoveOrderStatus = (from, to) => (
  from !== to && canUpdateOrderStatus(from, to)
);

export const legalOrderStatusOptions = (currentStatus, options) => options.filter(
  (option) => option.value === currentStatus
    || canMoveOrderStatus(currentStatus, option.value),
);

export const canUseBulkOrderActions = (currentStatus) => BULK_ORDER_STATUS_TARGETS.some(
  (targetStatus) => canMoveOrderStatus(currentStatus, targetStatus),
);

export const canMoveAllOrdersTo = (orders, targetStatus) => (
  orders.length > 0
  && orders.every((order) => canMoveOrderStatus(order.status || 'placed', targetStatus))
);
