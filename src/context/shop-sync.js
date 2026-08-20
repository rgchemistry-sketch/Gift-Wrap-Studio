import { recoverCartLineWithoutCustomization } from './cart-validation.js';

export const SHOP_SYNC_VERSION = 1;
export const SHOP_SYNC_CHANNEL = 'gift-n-wrap-shop';
export const SHOP_MUTATION_KEY_PREFIX = 'gnw-shop-mutation';
export const MAX_SHOP_MUTATION_CLOCK = 1_000_000_000;

const ACTIONS = new Set([
  'cart/add',
  'cart/clear',
  'cart/patch',
  'cart/recover-standard',
  'cart/remove',
  'cart/set-quantity',
  'wishlist/set',
]);

const id = (value) => String(value || '').trim();
const validProduct = (product) => (
  product
  && typeof product === 'object'
  && (id(product.id) || id(product.slug))
  && Number.isFinite(Number(product.price))
  && Number(product.price) >= 0
);

export const ownerScope = (ownerId = '') => encodeURIComponent(id(ownerId) || 'guest');

export const mutationKeyPrefixFor = (ownerId = '') => (
  `${SHOP_MUTATION_KEY_PREFIX}:${ownerScope(ownerId)}:`
);

export const mutationStorageKey = (mutation) => (
  `${mutationKeyPrefixFor(mutation.ownerId)}${encodeURIComponent(mutation.operationId)}`
);

export function normalizeShopMutation(value) {
  if (!value || typeof value !== 'object') return null;
  const action = id(value.action);
  const sourceId = id(value.sourceId);
  const operationId = id(value.operationId);
  const ownerId = id(value.ownerId);
  const clock = Number(value.clock);
  if (
    !ACTIONS.has(action)
    || !sourceId
    || !operationId
    || !Number.isSafeInteger(clock)
    || clock < 1
    || clock > MAX_SHOP_MUTATION_CLOCK
  ) {
    return null;
  }

  const mutation = {
    version: SHOP_SYNC_VERSION,
    action,
    ownerId,
    sourceId,
    operationId,
    clock,
  };

  if (action === 'cart/add') {
    if (
      !value.line
      || typeof value.line !== 'object'
      || !id(value.line.lineId)
      || !validProduct(value.line.product)
      || !value.line.customization
      || typeof value.line.customization !== 'object'
    ) return null;
    const quantity = Number(value.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return null;
    mutation.line = value.line;
    mutation.quantity = quantity;
  } else if (
    action === 'cart/remove'
    || action === 'cart/recover-standard'
    || action === 'cart/set-quantity'
    || action === 'cart/patch'
  ) {
    mutation.lineId = id(value.lineId);
    if (!mutation.lineId) return null;
    if (action === 'cart/set-quantity') {
      mutation.quantity = Number(value.quantity);
      if (!Number.isInteger(mutation.quantity) || mutation.quantity < 1 || mutation.quantity > 20) return null;
    }
    if (action === 'cart/patch') {
      if (
        !value.patch
        || typeof value.patch !== 'object'
        || Array.isArray(value.patch)
        || !validProduct(value.patch.product)
        || !value.patch.customization
        || typeof value.patch.customization !== 'object'
      ) return null;
      mutation.patch = value.patch;
    }
  } else if (action === 'wishlist/set') {
    mutation.productId = id(value.productId);
    mutation.included = value.included === true;
    if (!mutation.productId || typeof value.included !== 'boolean') return null;
  }
  return mutation;
}

export function compareShopMutations(left, right) {
  return left.clock - right.clock
    || left.sourceId.localeCompare(right.sourceId)
    || left.operationId.localeCompare(right.operationId);
}

export function uniqueSortedMutations(values = [], ownerId = '') {
  const expectedOwner = id(ownerId);
  const byId = new Map();
  values.forEach((value) => {
    const mutation = normalizeShopMutation(value);
    if (mutation && mutation.ownerId === expectedOwner && !byId.has(mutation.operationId)) {
      byId.set(mutation.operationId, mutation);
    }
  });
  return [...byId.values()].sort(compareShopMutations);
}

export function compactCartMutationHistory(base = [], values = [], ownerId = '') {
  const operations = uniqueSortedMutations(values, ownerId)
    .filter((mutation) => mutation.action.startsWith('cart/'));
  const latestClearIndex = operations.findLastIndex((mutation) => (
    mutation.action === 'cart/clear'
  ));
  if (latestClearIndex < 0) return { base, operations, removed: [] };
  return {
    base: [],
    operations: operations.slice(latestClearIndex),
    removed: operations.slice(0, latestClearIndex),
  };
}

export function reduceCartMutations(base = [], values = [], ownerId = '') {
  const cart = Array.isArray(base) ? base.map((line) => ({ ...line })) : [];
  uniqueSortedMutations(values, ownerId).forEach((mutation) => {
    if (!mutation.action.startsWith('cart/')) return;
    if (mutation.action === 'cart/clear') {
      cart.length = 0;
      return;
    }
    const lineId = mutation.action === 'cart/add' ? mutation.line.lineId : mutation.lineId;
    const index = cart.findIndex((line) => line.lineId === lineId);
    if (mutation.action === 'cart/add') {
      if (index < 0) {
        cart.push({ ...mutation.line, quantity: Math.min(10, mutation.quantity) });
      } else {
        cart[index] = {
          ...cart[index],
          quantity: Math.min(10, Number(cart[index].quantity || 0) + mutation.quantity),
        };
      }
    } else if (mutation.action === 'cart/remove') {
      if (index >= 0) cart.splice(index, 1);
    } else if (mutation.action === 'cart/recover-standard' && index >= 0) {
      const recovered = recoverCartLineWithoutCustomization(cart, mutation.lineId);
      cart.splice(0, cart.length, ...recovered.cart);
    } else if (mutation.action === 'cart/set-quantity') {
      if (index >= 0) cart[index] = { ...cart[index], quantity: Math.min(10, mutation.quantity) };
    } else if (mutation.action === 'cart/patch' && index >= 0) {
      cart[index] = {
        lineId: cart[index].lineId,
        quantity: cart[index].quantity,
        ...mutation.patch,
      };
    }
  });
  return cart;
}

export function reduceWishlistMutations(base = [], values = [], ownerId = '') {
  const wishlist = new Set(Array.isArray(base) ? base : []);
  uniqueSortedMutations(values, ownerId).forEach((mutation) => {
    if (mutation.action !== 'wishlist/set') return;
    if (mutation.included) wishlist.add(mutation.productId);
    else wishlist.delete(mutation.productId);
  });
  return [...wishlist];
}

export function makeShopMutation({ action, ownerId = '', sourceId, clock, ...payload }) {
  const normalizedSourceId = id(sourceId);
  const operationId = `${normalizedSourceId}:${clock}:${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  return normalizeShopMutation({
    ...payload,
    version: SHOP_SYNC_VERSION,
    action,
    ownerId: id(ownerId),
    sourceId: normalizedSourceId,
    operationId,
    clock,
  });
}
