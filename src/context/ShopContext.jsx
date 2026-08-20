import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import {
  SHOP_SYNC_CHANNEL,
  compactCartMutationHistory,
  makeShopMutation,
  mutationKeyPrefixFor,
  mutationStorageKey,
  normalizeShopMutation,
  reduceCartMutations,
  reduceWishlistMutations,
  uniqueSortedMutations,
} from './shop-sync';
import {
  markCartCustomizationUnavailable as markCartCustomizationUnavailableLines,
  hasCartCustomization,
  revalidateCartLines,
} from './cart-validation';

const ShopContext = createContext(null);
const CART_KEY = 'gnw-cart';
const CART_OWNER_KEY = 'gnw-cart-owner';
const WISHLIST_KEY = 'gnw-wishlist';
const WISHLIST_OWNER_KEY = 'gnw-wishlist-owner';
const OFFER_CLAIMED_KEY = 'gnw-first-offer-claimed';
const OFFER_CODE_KEY = 'gnw-first-offer-code';

// Start the small, eligibility-aware offer request as soon as the application
// bundle executes. Keeping the settled promise here means React StrictMode's
// development remount cannot issue the request twice.
let welcomeOfferBootstrap;

const isAdminPath = (pathname = '') => pathname === '/admin' || pathname.startsWith('/admin/');

const settledRequest = (request) => request.then(
  (value) => ({ status: 'fulfilled', value }),
  (reason) => ({ status: 'rejected', reason }),
);

const primeWelcomeOffer = () => {
  if (!welcomeOfferBootstrap) {
    welcomeOfferBootstrap = settledRequest(api.getWelcomeOffer());
  }
  return welcomeOfferBootstrap;
};

if (typeof window !== 'undefined' && !isAdminPath(window.location.pathname)) {
  primeWelcomeOffer();
}

function readLocalValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocalValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // State remains available in memory when browser storage is blocked.
  }
}

function writeSessionValue(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // State remains available in memory when browser storage is blocked.
  }
}

function removeSessionValue(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // State remains available in memory when browser storage is blocked.
  }
}

function normalizeStoredCart(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value.filter((line) => (
    line
    && typeof line === 'object'
    && typeof line.lineId === 'string'
    && line.lineId.trim()
    && line.product
    && typeof line.product === 'object'
    && (String(line.product.id || '').trim() || String(line.product.slug || '').trim())
    && Number.isFinite(Number(line.product.price))
    && Number(line.product.price) >= 0
    && Number.isInteger(line.quantity)
    && line.quantity >= 1
    && line.quantity <= 20
  )).map((line) => ({
    ...line,
    lineId: line.lineId.trim(),
    product: {
      ...line.product,
      id: String(line.product.id || line.product.slug),
      slug: String(line.product.slug || line.product.id),
      price: Number(line.product.price),
    },
    customization: line.customization && typeof line.customization === 'object'
      ? line.customization
      : {},
  }));
  return normalized;
}

function normalizeStoredWishlist(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value
    .filter((productId) => typeof productId === 'string' && productId.trim())
    .map((productId) => productId.trim()))];
}

function listStoredMutations(ownerId = '') {
  const prefix = mutationKeyPrefixFor(ownerId);
  const mutations = [];
  try {
    const keys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    const invalidKeys = [];
    keys.forEach((key) => {
      try {
        const mutation = normalizeShopMutation(JSON.parse(window.localStorage.getItem(key) || 'null'));
        if (mutation) mutations.push(mutation);
        else invalidKeys.push(key);
      } catch {
        invalidKeys.push(key);
      }
    });
    invalidKeys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // The in-memory protocol remains usable when storage is blocked.
  }
  return mutations;
}

function removeStoredMutations(ownerId = '') {
  const prefix = mutationKeyPrefixFor(ownerId);
  try {
    const keys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing is retained when browser storage is unavailable.
  }
}

function readSyncedResource(key, ownerId, normalize, resource) {
  const rawValue = readLocalValue(key);
  let base = [];
  let savedOperations = [];
  if (rawValue != null) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        base = normalize(parsed) || [];
      } else if (parsed?.version === 1 && Array.isArray(parsed.base)) {
        base = normalize(parsed.base) || [];
        savedOperations = Array.isArray(parsed.operations) ? parsed.operations : [];
      } else {
        removeLocalValue(key);
      }
    } catch {
      removeLocalValue(key);
    }
  }
  let operations = uniqueSortedMutations(
    [...savedOperations, ...listStoredMutations(ownerId)],
    ownerId,
  ).filter((mutation) => mutation.action.startsWith(`${resource}/`));
  if (resource === 'cart') {
    const compacted = compactCartMutationHistory(base, operations, ownerId);
    compacted.removed.forEach((mutation) => removeLocalValue(mutationStorageKey(mutation)));
    base = compacted.base;
    operations = compacted.operations;
  }
  return { base, operations };
}

function persistSyncedResource(key, syncState) {
  writeLocalValue(key, JSON.stringify({
    version: 1,
    base: syncState.base,
    operations: syncState.operations,
  }));
}

const createSourceId = () => (
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

function readSessionValue(key, fallback = '') {
  try {
    return window.sessionStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

const cartKeyFor = (ownerId = '') => `${CART_KEY}:${ownerId || 'guest'}`;
const wishlistKeyFor = (ownerId = '') => `${WISHLIST_KEY}:${ownerId || 'guest'}`;

function pruneExpiringAttachments(lines = []) {
  const cutoff = Date.now() + 5 * 60 * 1_000;
  const kept = [];
  const expired = [];
  lines.forEach((line) => {
    const expiresAt = Date.parse(line?.customization?.media?.expiresAt || '');
    if (Number.isFinite(expiresAt) && expiresAt <= cutoff) expired.push(line);
    else kept.push(line);
  });
  return { kept, expired };
}

function makeLineId(product, customization = {}) {
  const signatureParts = Object.entries(customization)
    .filter(([, value]) => value && typeof value !== 'object')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`);
  const mediaPublicId = String(customization.media?.publicId || '').trim();
  if (mediaPublicId) signatureParts.push(`media:${mediaPublicId}`);
  const signature = signatureParts.join('|');
  return `${product.id}-${signature || 'standard'}`;
}

export function ShopProvider({ children }) {
  const { user, sessionOwnerId, loading: authLoading, requireAuth } = useAuth();
  const { pathname } = useLocation();
  const isAdminRoute = isAdminPath(pathname);
  const [initialSync] = useState(() => ({
    cart: readSyncedResource(cartKeyFor(), '', normalizeStoredCart, 'cart'),
    wishlist: readSyncedResource(wishlistKeyFor(), '', normalizeStoredWishlist, 'wishlist'),
  }));
  const cartSyncRef = useRef(initialSync.cart);
  const wishlistSyncRef = useRef(initialSync.wishlist);
  const [cart, setCart] = useState(() => normalizeStoredCart(reduceCartMutations(
    initialSync.cart.base, initialSync.cart.operations, '',
  )) || []);
  const [wishlist, setWishlist] = useState(() => normalizeStoredWishlist(
    reduceWishlistMutations(initialSync.wishlist.base, initialSync.wishlist.operations, ''),
  ) || []);
  const [toasts, setToasts] = useState([]);
  const [studioSettings, setStudioSettings] = useState(null);
  const [studioSettingsState, setStudioSettingsState] = useState({ loading: true, error: '' });
  const [welcomeOffer, setWelcomeOffer] = useState(null);
  const [claimedOfferCode, setClaimedOfferCode] = useState(
    () => readSessionValue(OFFER_CODE_KEY),
  );
  const releasingUploadIdsRef = useRef(new Set());
  const cartRef = useRef(cart);
  const wishlistRef = useRef(wishlist);
  const cartStorageKeyRef = useRef(cartKeyFor());
  const wishlistStorageKeyRef = useRef(wishlistKeyFor());
  const activeOwnerIdRef = useRef('');
  const sourceIdRef = useRef(createSourceId());
  const mutationClockRef = useRef(Math.max(
    0,
    ...initialSync.cart.operations.map((mutation) => mutation.clock),
    ...initialSync.wishlist.operations.map((mutation) => mutation.clock),
  ));
  const shopChannelRef = useRef(null);
  const welcomeOfferRef = useRef(null);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    wishlistRef.current = wishlist;
  }, [wishlist]);

  useEffect(() => {
    if (authLoading) return;
    const nextOwnerId = String(sessionOwnerId || user?.id || '');
    const previousOwnerId = readLocalValue(CART_OWNER_KEY) || '';
    const previousWishlistOwnerId = readLocalValue(WISHLIST_OWNER_KEY) || '';
    const guestKey = cartKeyFor();
    const guestWishlistKey = wishlistKeyFor();
    const nextKey = cartKeyFor(nextOwnerId);
    const nextWishlistKey = wishlistKeyFor(nextOwnerId);
    let nextCartSync;
    let nextWishlistSync;

    // Never expose carts written by the older, unscoped build to another account.
    removeLocalValue(CART_KEY);
    removeLocalValue(WISHLIST_KEY);

    if (nextOwnerId) {
      if (previousOwnerId && previousOwnerId !== nextOwnerId) {
        removeLocalValue(cartKeyFor(previousOwnerId));
        removeStoredMutations(previousOwnerId);
      }
      if (previousWishlistOwnerId && previousWishlistOwnerId !== nextOwnerId) {
        removeLocalValue(wishlistKeyFor(previousWishlistOwnerId));
        removeStoredMutations(previousWishlistOwnerId);
      }
      nextCartSync = readSyncedResource(nextKey, nextOwnerId, normalizeStoredCart, 'cart');
      nextWishlistSync = readSyncedResource(
        nextWishlistKey, nextOwnerId, normalizeStoredWishlist, 'wishlist',
      );
      mutationClockRef.current = Math.max(
        mutationClockRef.current,
        ...nextCartSync.operations.map((mutation) => mutation.clock),
        ...nextWishlistSync.operations.map((mutation) => mutation.clock),
      );
      const mayTransferGuest = !previousOwnerId || previousOwnerId === nextOwnerId;
      const mayTransferGuestWishlist = !previousWishlistOwnerId
        || previousWishlistOwnerId === nextOwnerId;
      const guestCart = mayTransferGuest && cartStorageKeyRef.current === guestKey
        ? cartRef.current
        : [];
      const guestWishlist = mayTransferGuestWishlist
        && wishlistStorageKeyRef.current === guestWishlistKey
        ? wishlistRef.current
        : [];
      guestCart.forEach((line) => {
        const operation = normalizeShopMutation({
          action: 'cart/add',
          ownerId: nextOwnerId,
          sourceId: 'guest-transfer',
          operationId: `guest-transfer:${nextOwnerId}:cart:${line.lineId}`,
          clock: ++mutationClockRef.current,
          line,
          quantity: line.quantity,
        });
        if (operation) {
          nextCartSync.operations.push(operation);
          writeLocalValue(mutationStorageKey(operation), JSON.stringify(operation));
        }
      });
      guestWishlist.forEach((productId) => {
        const operation = normalizeShopMutation({
          action: 'wishlist/set',
          ownerId: nextOwnerId,
          sourceId: 'guest-transfer',
          operationId: `guest-transfer:${nextOwnerId}:wishlist:${productId}`,
          clock: ++mutationClockRef.current,
          productId,
          included: true,
        });
        if (operation) {
          nextWishlistSync.operations.push(operation);
          writeLocalValue(mutationStorageKey(operation), JSON.stringify(operation));
        }
      });
      nextCartSync.operations = uniqueSortedMutations(nextCartSync.operations, nextOwnerId);
      nextWishlistSync.operations = uniqueSortedMutations(nextWishlistSync.operations, nextOwnerId);
      removeLocalValue(guestKey);
      removeLocalValue(guestWishlistKey);
      removeStoredMutations('');
      writeLocalValue(CART_OWNER_KEY, nextOwnerId);
      writeLocalValue(WISHLIST_OWNER_KEY, nextOwnerId);
    } else if (
      previousOwnerId
      || previousWishlistOwnerId
      || cartStorageKeyRef.current !== guestKey
      || wishlistStorageKeyRef.current !== guestWishlistKey
    ) {
      // Logout/session expiry clears customization names, messages and photo URLs
      // before another person can use the same browser.
      if (previousOwnerId) removeLocalValue(cartKeyFor(previousOwnerId));
      if (previousWishlistOwnerId) removeLocalValue(wishlistKeyFor(previousWishlistOwnerId));
      if (previousOwnerId) removeStoredMutations(previousOwnerId);
      if (previousWishlistOwnerId) removeStoredMutations(previousWishlistOwnerId);
      removeLocalValue(cartStorageKeyRef.current);
      removeLocalValue(wishlistStorageKeyRef.current);
      removeLocalValue(guestKey);
      removeLocalValue(guestWishlistKey);
      removeLocalValue(CART_OWNER_KEY);
      removeLocalValue(WISHLIST_OWNER_KEY);
      removeStoredMutations('');
      nextCartSync = { base: [], operations: [] };
      nextWishlistSync = { base: [], operations: [] };
    } else {
      nextCartSync = cartStorageKeyRef.current === guestKey
        ? cartSyncRef.current
        : readSyncedResource(guestKey, '', normalizeStoredCart, 'cart');
      nextWishlistSync = wishlistStorageKeyRef.current === guestWishlistKey
        ? wishlistSyncRef.current
        : readSyncedResource(guestWishlistKey, '', normalizeStoredWishlist, 'wishlist');
    }

    let nextCart = normalizeStoredCart(reduceCartMutations(
      nextCartSync.base, nextCartSync.operations, nextOwnerId,
    )) || [];
    const nextWishlist = normalizeStoredWishlist(reduceWishlistMutations(
      nextWishlistSync.base, nextWishlistSync.operations, nextOwnerId,
    )) || [];

    const { kept, expired } = pruneExpiringAttachments(nextCart);
    nextCart = kept;
    expired.forEach((line) => {
      const operation = normalizeShopMutation({
        action: 'cart/remove',
        ownerId: nextOwnerId,
        sourceId: 'expiry-prune',
        operationId: `expiry-prune:${nextOwnerId}:${line.lineId}:${line.customization?.media?.publicId || line.customization?.media?.expiresAt || ''}`,
        clock: ++mutationClockRef.current,
        lineId: line.lineId,
      });
      if (operation) {
        nextCartSync.operations.push(operation);
        writeLocalValue(mutationStorageKey(operation), JSON.stringify(operation));
      }
    });
    if (expired.length) {
      nextCartSync.operations = uniqueSortedMutations(nextCartSync.operations, nextOwnerId);
    }
    expired.forEach((line) => {
      const publicId = String(line?.customization?.media?.publicId || '').trim();
      if (publicId) void api.deleteUploadedAsset(publicId).catch(() => {});
    });
    if (expired.length) {
      setToasts((current) => [...current, {
        id: `${Date.now()}-${Math.random()}`,
        message: `${expired.length === 1 ? 'A personalized item was' : 'Some personalized items were'} removed because the secure photo upload expired. Please add it again.`,
        tone: 'neutral',
      }]);
    }

    cartStorageKeyRef.current = nextKey;
    wishlistStorageKeyRef.current = nextWishlistKey;
    activeOwnerIdRef.current = nextOwnerId;
    cartSyncRef.current = nextCartSync;
    wishlistSyncRef.current = nextWishlistSync;
    cartRef.current = nextCart;
    wishlistRef.current = nextWishlist;
    setCart(nextCart);
    setWishlist(nextWishlist);
    persistSyncedResource(nextKey, nextCartSync);
    persistSyncedResource(nextWishlistKey, nextWishlistSync);
  }, [authLoading, sessionOwnerId, user?.id]);

  const applyStudioSettings = useCallback((value) => {
    if (value) {
      setStudioSettings(value.data || value);
      setStudioSettingsState({ loading: false, error: '' });
    }
  }, []);

  const refreshStudioSettings = useCallback(async () => {
    setStudioSettingsState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await api.getPublicSettings();
      const value = result.data || result;
      setStudioSettings(value);
      setStudioSettingsState({ loading: false, error: '' });
      return value;
    } catch (error) {
      setStudioSettingsState({ loading: false, error: error.message || 'Settings unavailable' });
      throw error;
    }
  }, []);

  useEffect(() => {
    // The protected workspace has its own settings loader. Storefront settings
    // are independent from offer eligibility, so neither response waits for the
    // other before it can update the page.
    if (isAdminRoute) return undefined;
    let active = true;
    setStudioSettingsState((current) => ({ ...current, loading: true, error: '' }));
    api.getPublicSettings()
      .then((result) => {
        if (!active) return;
        setStudioSettings(result.data || result);
        setStudioSettingsState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setStudioSettingsState({
          loading: false,
          error: error.message || 'Settings unavailable',
        });
      });
    return () => { active = false; };
  }, [isAdminRoute]);

  useEffect(() => {
    if (isAdminRoute) return undefined;
    let active = true;
    const viewerId = String(user?.id || '');
    const loadedOffer = welcomeOfferRef.current;
    const resolvedViewerId = loadedOffer?.viewer
      ? String(loadedOffer.viewer.id || '')
      : null;
    const offerMatchesViewer = resolvedViewerId !== null && resolvedViewerId === viewerId;

    // The bootstrap response is already in flight on an initial storefront
    // visit. A login, logout or account change always receives a fresh,
    // server-evaluated eligibility result.
    const offerRequest = !loadedOffer
      ? primeWelcomeOffer()
      : offerMatchesViewer
        ? null
        : settledRequest(api.getWelcomeOffer());

    if (!offerMatchesViewer && loadedOffer) {
      welcomeOfferRef.current = null;
      setWelcomeOffer(null);
    }
    offerRequest?.then((result) => {
      if (!active) return;
      if (result.status === 'fulfilled') {
        const nextOffer = result.value.data || result.value;
        const responseViewerId = nextOffer?.viewer
          ? String(nextOffer.viewer.id || '')
          : null;
        // During the initial auth check the response is itself authoritative.
        // After auth has settled, discard any response raced by a login/logout.
        if (!authLoading && responseViewerId !== viewerId) {
          settledRequest(api.getWelcomeOffer()).then((retryResult) => {
            if (!active || retryResult.status !== 'fulfilled') return;
            const retriedOffer = retryResult.value.data || retryResult.value;
            if (String(retriedOffer?.viewer?.id || '') !== viewerId) return;
            welcomeOfferRef.current = retriedOffer;
            setWelcomeOffer(retriedOffer);
          });
          return;
        }
        welcomeOfferRef.current = nextOffer;
        setWelcomeOffer(nextOffer);
      } else if (offerRequest === welcomeOfferBootstrap) {
        // Permit a later storefront navigation to retry a failed bootstrap.
        welcomeOfferBootstrap = undefined;
      }
    });
    return () => { active = false; };
  }, [authLoading, isAdminRoute, user?.id]);

  const applyShopMutation = useCallback((value) => {
    const mutation = normalizeShopMutation(value);
    if (!mutation || mutation.ownerId !== activeOwnerIdRef.current) return false;
    mutationClockRef.current = Math.max(mutationClockRef.current, mutation.clock);
    const isCartMutation = mutation.action.startsWith('cart/');
    const syncRef = isCartMutation ? cartSyncRef : wishlistSyncRef;
    if (syncRef.current.operations.some((operation) => (
      operation.operationId === mutation.operationId
    ))) return false;
    let operations = uniqueSortedMutations(
      [...syncRef.current.operations, mutation], mutation.ownerId,
    );
    let base = syncRef.current.base;
    let compactedOperations = [];
    if (isCartMutation) {
      const compacted = compactCartMutationHistory(base, operations, mutation.ownerId);
      compactedOperations = compacted.removed;
      operations = compacted.operations;
      base = compacted.base;
    }
    syncRef.current = { base, operations };
    if (isCartMutation) {
      const next = normalizeStoredCart(reduceCartMutations(
        syncRef.current.base, syncRef.current.operations, mutation.ownerId,
      )) || [];
      cartRef.current = next;
      setCart(next);
      persistSyncedResource(cartStorageKeyRef.current, syncRef.current);
    } else {
      const next = normalizeStoredWishlist(reduceWishlistMutations(
        syncRef.current.base, syncRef.current.operations, mutation.ownerId,
      )) || [];
      wishlistRef.current = next;
      setWishlist(next);
      persistSyncedResource(wishlistStorageKeyRef.current, syncRef.current);
    }
    compactedOperations.forEach((operation) => {
      removeLocalValue(mutationStorageKey(operation));
    });
    return true;
  }, []);

  const publishShopMutation = useCallback((action, payload = {}) => {
    const mutation = makeShopMutation({
      ...payload,
      action,
      ownerId: activeOwnerIdRef.current,
      sourceId: sourceIdRef.current,
      clock: ++mutationClockRef.current,
    });
    if (!mutation) return false;
    // The unique journal key is written before the materialized view, so a reload
    // can recover an interrupted commit. The envelope's fixed base prevents replay
    // from applying an already-checkpointed quantity delta twice.
    writeLocalValue(mutationStorageKey(mutation), JSON.stringify(mutation));
    applyShopMutation(mutation);
    try {
      shopChannelRef.current?.postMessage(mutation);
    } catch {
      // The storage event remains the cross-tab fallback.
    }
    return true;
  }, [applyShopMutation]);

  const persistCart = useCallback((next) => {
    const current = cartRef.current;
    if (current.length && !next.length) {
      publishShopMutation('cart/clear');
      return;
    }
    const currentById = new Map(current.map((line) => [line.lineId, line]));
    const nextById = new Map(next.map((line) => [line.lineId, line]));
    current.forEach((line) => {
      if (!nextById.has(line.lineId)) {
        publishShopMutation('cart/remove', { lineId: line.lineId });
      }
    });
    next.forEach((line) => {
      const previous = currentById.get(line.lineId);
      if (!previous) {
        publishShopMutation('cart/add', { line, quantity: line.quantity });
        return;
      }
      if (line.quantity > previous.quantity) {
        publishShopMutation('cart/add', { line, quantity: line.quantity - previous.quantity });
      } else if (line.quantity !== previous.quantity) {
        publishShopMutation('cart/set-quantity', { lineId: line.lineId, quantity: line.quantity });
      }
      const { lineId: _nextLineId, quantity: _nextQuantity, ...nextPatch } = line;
      const { lineId: _oldLineId, quantity: _oldQuantity, ...previousPatch } = previous;
      if (JSON.stringify(nextPatch) !== JSON.stringify(previousPatch)) {
        publishShopMutation('cart/patch', { lineId: line.lineId, patch: nextPatch });
      }
    });
  }, [publishShopMutation]);

  const persistWishlist = useCallback((next) => {
    const current = wishlistRef.current;
    current.forEach((productId) => {
      if (!next.includes(productId)) {
        publishShopMutation('wishlist/set', { productId, included: false });
      }
    });
    next.forEach((productId) => {
      if (!current.includes(productId)) {
        publishShopMutation('wishlist/set', { productId, included: true });
      }
    });
  }, [publishShopMutation]);

  useEffect(() => {
    let channel;
    const receiveMutation = (value) => applyShopMutation(value?.data ?? value);
    const syncAcrossTabs = (event) => {
      const expectedPrefix = mutationKeyPrefixFor(activeOwnerIdRef.current);
      if (!event.key?.startsWith(expectedPrefix) || !event.newValue) return;
      try {
        receiveMutation(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed messages from older or unrelated builds.
      }
    };
    try {
      if ('BroadcastChannel' in window) {
        channel = new window.BroadcastChannel(SHOP_SYNC_CHANNEL);
        channel.addEventListener('message', receiveMutation);
        shopChannelRef.current = channel;
      }
    } catch {
      channel = null;
    }
    window.addEventListener('storage', syncAcrossTabs);
    listStoredMutations(activeOwnerIdRef.current).forEach(receiveMutation);
    return () => {
      window.removeEventListener('storage', syncAcrossTabs);
      if (shopChannelRef.current === channel) shopChannelRef.current = null;
      channel?.removeEventListener('message', receiveMutation);
      channel?.close();
    };
  }, [applyShopMutation, authLoading, sessionOwnerId, user?.id]);

  const notify = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    const normalizedMessage = String(message || 'Your request has been updated.').trim();
    const normalizedTone = ['success', 'error', 'warning', 'info', 'neutral'].includes(tone)
      ? tone
      : 'neutral';
    setToasts((current) => {
      const withoutDuplicate = current.filter((toast) => (
        toast.message !== normalizedMessage || toast.tone !== normalizedTone
      ));
      return [...withoutDuplicate.slice(-3), {
        id,
        message: normalizedMessage,
        tone: normalizedTone,
      }];
    });
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const claimWelcomeOffer = useCallback((code) => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return;
    writeSessionValue(OFFER_CLAIMED_KEY, 'true');
    writeSessionValue(OFFER_CODE_KEY, normalizedCode);
    setClaimedOfferCode(normalizedCode);
  }, []);

  const removeWelcomeOffer = useCallback(() => {
    // Keep the acknowledgement flag so removing the code does not immediately
    // reopen the promotional dialog in the same visit.
    writeSessionValue(OFFER_CLAIMED_KEY, 'true');
    removeSessionValue(OFFER_CODE_KEY);
    setClaimedOfferCode('');
    notify('The welcome offer was removed. You can continue without it.', 'neutral');
  }, [notify]);

  const revalidateCart = useCallback((catalog = []) => {
    if (!Array.isArray(catalog)) return;
    const result = revalidateCartLines(cartRef.current, catalog);
    if (!result.changed) return;
    persistCart(result.cart);
    if (result.priceChanges) {
      notify(`${result.priceChanges === 1 ? 'A price was' : `${result.priceChanges} prices were`} updated to match the live catalogue.`, 'info');
    }
    if (result.newlyUnavailable) {
      notify(`${result.newlyUnavailable === 1 ? 'A bag item is' : `${result.newlyUnavailable} bag items are`} no longer available. Remove ${result.newlyUnavailable === 1 ? 'it' : 'them'} before continuing.`, 'warning');
    }
    if (result.newlyCustomizationUnavailable) {
      notify(`${result.newlyCustomizationUnavailable === 1 ? 'A personalized bag item needs' : `${result.newlyCustomizationUnavailable} personalized bag items need`} your attention before checkout.`, 'warning');
    }
  }, [notify, persistCart]);

  const markCartItemUnavailable = useCallback(({ productId = '', slug = '' } = {}) => {
    let matched = false;
    const next = cartRef.current.map((line) => {
      const sameProduct = (productId && String(line.product.id) === String(productId))
        || (slug && String(line.product.slug) === String(slug));
      if (!sameProduct) return line;
      matched = true;
      return {
        ...line,
        unavailable: true,
        unavailableReason: 'This piece is no longer available.',
      };
    });
    if (matched) persistCart(next);
    return matched;
  }, [persistCart]);

  const markCartCustomizationUnavailable = useCallback(({
    productId = '',
    slug = '',
    productVersion = '',
  } = {}) => {
    const result = markCartCustomizationUnavailableLines(
      cartRef.current,
      { productId, slug, productVersion },
    );
    if (result.changed) persistCart(result.cart);
    return result.matched;
  }, [persistCart]);

  const releaseCartAttachment = useCallback((item, failureMessage = 'The item was removed, but its photo could not be released right now.') => {
    const publicId = String(item?.customization?.media?.publicId || '').trim();
    if (!publicId || releasingUploadIdsRef.current.has(publicId)) return;
    releasingUploadIdsRef.current.add(publicId);
    void api.deleteUploadedAsset(publicId)
      .catch(() => {
        notify(failureMessage, 'neutral');
      })
      .finally(() => {
        releasingUploadIdsRef.current.delete(publicId);
      });
  }, [notify]);

  const removeCartCustomization = useCallback((lineId) => {
    const current = cartRef.current;
    const item = current.find((line) => line.lineId === lineId);
    if (!item || !hasCartCustomization(item)) return false;
    publishShopMutation('cart/recover-standard', { lineId });
    releaseCartAttachment(
      item,
      'Personalization was removed, but its photo could not be released right now.',
    );
    notify(`Personalization was removed from ${item.product.title}. The piece remains in your bag.`, 'neutral');
    return true;
  }, [notify, publishShopMutation, releaseCartAttachment]);

  const addToCart = useCallback(
    (product, { quantity = 1, customization = {}, onAdded } = {}) => {
      const commit = () => {
        const lineId = makeLineId(product, customization);
        const next = [...cartRef.current];
        const existingIndex = next.findIndex((item) => item.lineId === lineId);
        if (existingIndex >= 0) {
          next[existingIndex] = {
            ...next[existingIndex],
            quantity: Math.min(10, next[existingIndex].quantity + quantity),
          };
        } else {
          next.push({
            lineId,
            product,
            quantity,
            customization,
          });
        }
        persistCart(next);
        notify(`${product.title} was added to your bag.`);
        onAdded?.();
      };

      if (!user) {
        requireAuth({
          message: 'Log in or create an account before adding a piece to your bag. Your choices will stay right here.',
          onAuthenticated: commit,
          onAccountMismatch: () => {
            notify('Your signed-in account changed. Review this account’s bag before adding the piece again.', 'warning');
          },
        });
        return false;
      }
      commit();
      return true;
    },
    [notify, persistCart, requireAuth, user],
  );

  const updateQuantity = useCallback(
    (lineId, quantity) => {
      const current = cartRef.current;
      if (quantity <= 0) {
        const item = current.find((line) => line.lineId === lineId);
        persistCart(current.filter((line) => line.lineId !== lineId));
        if (item) {
          releaseCartAttachment(item);
          notify(`${item.product.title} was removed.`, 'neutral');
        }
        return;
      }
      persistCart(
        current.map((line) => (line.lineId === lineId ? { ...line, quantity: Math.min(10, quantity) } : line)),
      );
    },
    [notify, persistCart, releaseCartAttachment],
  );

  const removeFromCart = useCallback(
    (lineId) => {
      const current = cartRef.current;
      const item = current.find((line) => line.lineId === lineId);
      persistCart(current.filter((line) => line.lineId !== lineId));
      if (item) {
        releaseCartAttachment(item);
        notify(`${item.product.title} was removed.`, 'neutral');
      }
    },
    [notify, persistCart, releaseCartAttachment],
  );

  const clearCart = useCallback(() => persistCart([]), [persistCart]);

  const toggleWishlist = useCallback(
    (productId) => {
      const current = wishlistRef.current;
      const included = current.includes(productId);
      const next = included ? current.filter((id) => id !== productId) : [...current, productId];
      persistWishlist(next);
      notify(included ? 'Removed from your saved pieces.' : 'Saved for later.', 'neutral');
    },
    [notify, persistWishlist],
  );

  const cartCount = cart.reduce((total, line) => total + Number(line.quantity || 0), 0);
  // Mirrors the server's order subtotal exactly (services/store.js). Any extra fee added
  // here without a matching server rule shows the customer a total the order never records.
  const subtotal = cart.reduce(
    (total, line) => total + (line.unavailable ? 0 : Number(line.product.price || 0) * Number(line.quantity || 0)),
    0,
  );

  const value = useMemo(
    () => ({
      cart,
      wishlist,
      toasts,
      studioSettings,
      studioSettingsState,
      welcomeOffer,
      claimedOfferCode,
      cartCount,
      subtotal,
      addToCart,
      updateQuantity,
      removeFromCart,
      removeCartCustomization,
      clearCart,
      toggleWishlist,
      notify,
      dismissToast,
      claimWelcomeOffer,
      removeWelcomeOffer,
      revalidateCart,
      markCartItemUnavailable,
      markCartCustomizationUnavailable,
      applyStudioSettings,
      refreshStudioSettings,
    }),
    [
      cart,
      wishlist,
      toasts,
      studioSettings,
      studioSettingsState,
      welcomeOffer,
      claimedOfferCode,
      cartCount,
      subtotal,
      addToCart,
      updateQuantity,
      removeFromCart,
      removeCartCustomization,
      clearCart,
      toggleWishlist,
      notify,
      dismissToast,
      claimWelcomeOffer,
      removeWelcomeOffer,
      revalidateCart,
      markCartItemUnavailable,
      markCartCustomizationUnavailable,
      applyStudioSettings,
      refreshStudioSettings,
    ],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const context = useContext(ShopContext);
  if (!context) throw new Error('useShop must be used inside ShopProvider');
  return context;
}
