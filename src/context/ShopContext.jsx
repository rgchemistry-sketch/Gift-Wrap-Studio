import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const ShopContext = createContext(null);
const CART_KEY = 'gnw-cart';
const CART_OWNER_KEY = 'gnw-cart-owner';
const WISHLIST_KEY = 'gnw-wishlist';
const OFFER_CLAIMED_KEY = 'gnw-first-offer-claimed';
const OFFER_CODE_KEY = 'gnw-first-offer-code';

function readStorage(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

const cartKeyFor = (ownerId = '') => `${CART_KEY}:${ownerId || 'guest'}`;

function mergeCarts(primary = [], additions = []) {
  const merged = new Map(primary.map((line) => [line.lineId, line]));
  additions.forEach((line) => {
    const existing = merged.get(line.lineId);
    merged.set(line.lineId, existing
      ? { ...existing, quantity: Math.min(10, Number(existing.quantity || 0) + Number(line.quantity || 0)) }
      : line);
  });
  return [...merged.values()];
}

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
  const { user, loading: authLoading } = useAuth();
  const [cart, setCart] = useState(() => readStorage(cartKeyFor(), []));
  const [wishlist, setWishlist] = useState(() => readStorage(WISHLIST_KEY, []));
  const [toasts, setToasts] = useState([]);
  const [studioSettings, setStudioSettings] = useState(null);
  const [welcomeOffer, setWelcomeOffer] = useState(null);
  const [claimedOfferCode, setClaimedOfferCode] = useState(
    () => window.sessionStorage.getItem(OFFER_CODE_KEY) || '',
  );
  const releasingUploadIdsRef = useRef(new Set());
  const cartRef = useRef(cart);
  const cartStorageKeyRef = useRef(cartKeyFor());

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    if (authLoading) return;
    const nextOwnerId = String(user?.id || '');
    const previousOwnerId = window.localStorage.getItem(CART_OWNER_KEY) || '';
    const guestKey = cartKeyFor();
    const nextKey = cartKeyFor(nextOwnerId);
    let nextCart;

    // Never expose carts written by the older, unscoped build to another account.
    window.localStorage.removeItem(CART_KEY);

    if (nextOwnerId) {
      if (previousOwnerId && previousOwnerId !== nextOwnerId) {
        window.localStorage.removeItem(cartKeyFor(previousOwnerId));
      }
      const savedForUser = readStorage(nextKey, []);
      const mayTransferGuest = !previousOwnerId || previousOwnerId === nextOwnerId;
      const guestCart = mayTransferGuest && cartStorageKeyRef.current === guestKey
        ? cartRef.current
        : [];
      nextCart = mergeCarts(savedForUser, guestCart);
      window.localStorage.removeItem(guestKey);
      window.localStorage.setItem(CART_OWNER_KEY, nextOwnerId);
    } else if (previousOwnerId) {
      // Logout/session expiry clears customization names, messages and photo URLs
      // before another person can use the same browser.
      window.localStorage.removeItem(cartKeyFor(previousOwnerId));
      window.localStorage.removeItem(guestKey);
      window.localStorage.removeItem(CART_OWNER_KEY);
      nextCart = [];
    } else {
      nextCart = cartStorageKeyRef.current === guestKey
        ? cartRef.current
        : readStorage(guestKey, []);
    }

    const { kept, expired } = pruneExpiringAttachments(nextCart);
    nextCart = kept;
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
    cartRef.current = nextCart;
    setCart(nextCart);
    if (nextCart.length) window.localStorage.setItem(nextKey, JSON.stringify(nextCart));
    else window.localStorage.removeItem(nextKey);
  }, [authLoading, user?.id]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.getPublicSettings(), api.getWelcomeOffer()]).then(([settingsResult, offerResult]) => {
      if (!active) return;
      if (settingsResult.status === 'fulfilled') {
        setStudioSettings(settingsResult.value.data || settingsResult.value);
      }
      if (offerResult.status === 'fulfilled') {
        setWelcomeOffer(offerResult.value.data || offerResult.value);
      }
    });
    return () => { active = false; };
  }, []);

  const persistCart = useCallback((next) => {
    cartRef.current = next;
    setCart(next);
    if (next.length) window.localStorage.setItem(cartStorageKeyRef.current, JSON.stringify(next));
    else window.localStorage.removeItem(cartStorageKeyRef.current);
  }, []);

  const notify = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone }]);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const claimWelcomeOffer = useCallback((code) => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return;
    window.sessionStorage.setItem(OFFER_CLAIMED_KEY, 'true');
    window.sessionStorage.setItem(OFFER_CODE_KEY, normalizedCode);
    setClaimedOfferCode(normalizedCode);
  }, []);

  const releaseCartAttachment = useCallback((item) => {
    const publicId = String(item?.customization?.media?.publicId || '').trim();
    if (!publicId || releasingUploadIdsRef.current.has(publicId)) return;
    releasingUploadIdsRef.current.add(publicId);
    void api.deleteUploadedAsset(publicId)
      .catch(() => {
        notify('The item was removed, but its photo could not be released right now.', 'neutral');
      })
      .finally(() => {
        releasingUploadIdsRef.current.delete(publicId);
      });
  }, [notify]);

  const addToCart = useCallback(
    (product, { quantity = 1, customization = {} } = {}) => {
      const lineId = makeLineId(product, customization);
      const next = [...cart];
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
    },
    [cart, notify, persistCart],
  );

  const updateQuantity = useCallback(
    (lineId, quantity) => {
      if (quantity <= 0) {
        const item = cart.find((line) => line.lineId === lineId);
        persistCart(cart.filter((line) => line.lineId !== lineId));
        if (item) {
          releaseCartAttachment(item);
          notify(`${item.product.title} was removed.`, 'neutral');
        }
        return;
      }
      persistCart(
        cart.map((line) => (line.lineId === lineId ? { ...line, quantity: Math.min(10, quantity) } : line)),
      );
    },
    [cart, notify, persistCart, releaseCartAttachment],
  );

  const removeFromCart = useCallback(
    (lineId) => {
      const item = cart.find((line) => line.lineId === lineId);
      persistCart(cart.filter((line) => line.lineId !== lineId));
      if (item) {
        releaseCartAttachment(item);
        notify(`${item.product.title} was removed.`, 'neutral');
      }
    },
    [cart, notify, persistCart, releaseCartAttachment],
  );

  const clearCart = useCallback(() => persistCart([]), [persistCart]);

  const toggleWishlist = useCallback(
    (productId) => {
      const included = wishlist.includes(productId);
      const next = included ? wishlist.filter((id) => id !== productId) : [...wishlist, productId];
      setWishlist(next);
      window.localStorage.setItem(WISHLIST_KEY, JSON.stringify(next));
      notify(included ? 'Removed from your saved pieces.' : 'Saved for later.', 'neutral');
    },
    [wishlist, notify],
  );

  const cartCount = cart.reduce((total, line) => total + line.quantity, 0);
  // Mirrors the server's order subtotal exactly (services/store.js). Any extra fee added
  // here without a matching server rule shows the customer a total the order never records.
  const subtotal = cart.reduce((total, line) => total + line.product.price * line.quantity, 0);

  const value = useMemo(
    () => ({
      cart,
      wishlist,
      toasts,
      studioSettings,
      welcomeOffer,
      claimedOfferCode,
      cartCount,
      subtotal,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      toggleWishlist,
      notify,
      dismissToast,
      claimWelcomeOffer,
    }),
    [
      cart,
      wishlist,
      toasts,
      studioSettings,
      welcomeOffer,
      claimedOfferCode,
      cartCount,
      subtotal,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      toggleWishlist,
      notify,
      dismissToast,
      claimWelcomeOffer,
    ],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const context = useContext(ShopContext);
  if (!context) throw new Error('useShop must be used inside ShopProvider');
  return context;
}
