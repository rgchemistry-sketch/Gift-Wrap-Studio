const CONFIRMATION_PREFIX = 'gnw-checkout-confirmation';
const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1_000;

const ownerKey = (ownerId = '') => String(ownerId || '').trim() || 'guest';
const storageKey = (ownerId = '') => `${CONFIRMATION_PREFIX}:${ownerKey(ownerId)}`;

export function safeCheckoutConfirmation(order, now = Date.now()) {
  if (!order || typeof order !== 'object') return null;
  const orderNumber = String(order.orderNumber || '').trim().slice(0, 80);
  const orderId = String(order.orderId || order.id || order._id || '').trim().slice(0, 100);
  if (!orderNumber && !orderId) return null;
  return {
    version: 1,
    orderNumber,
    orderId,
    storedAt: now,
  };
}

export function storeCheckoutConfirmation(ownerId, order, storage = globalThis.sessionStorage) {
  const confirmation = safeCheckoutConfirmation(order);
  if (!confirmation || !storage) return null;
  try {
    storage.setItem(storageKey(ownerId), JSON.stringify(confirmation));
    return confirmation;
  } catch {
    return null;
  }
}

export function loadCheckoutConfirmation(
  ownerId,
  storage = globalThis.sessionStorage,
  now = Date.now(),
) {
  if (!storage) return null;
  const key = storageKey(ownerId);
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    const valid = value
      && value.version === 1
      && Number.isFinite(value.storedAt)
      && value.storedAt <= now
      && now - value.storedAt <= CONFIRMATION_TTL_MS
      && (String(value.orderNumber || '').trim() || String(value.orderId || '').trim());
    if (!valid) {
      storage.removeItem(key);
      return null;
    }
    return safeCheckoutConfirmation(value, value.storedAt);
  } catch {
    try { storage.removeItem(key); } catch { /* Storage is unavailable. */ }
    return null;
  }
}

export function removeCheckoutConfirmation(ownerId, storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(storageKey(ownerId));
  } catch {
    // A confirmation held in component state remains visible for this render.
  }
}
