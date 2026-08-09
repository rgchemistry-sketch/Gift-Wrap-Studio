import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ShopContext = createContext(null);
const CART_KEY = 'gnw-cart';
const WISHLIST_KEY = 'gnw-wishlist';

function readStorage(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function makeLineId(product, customization = {}) {
  const signature = Object.entries(customization)
    .filter(([, value]) => value && typeof value !== 'object')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
  return `${product.id}-${signature || 'standard'}`;
}

export function ShopProvider({ children }) {
  const [cart, setCart] = useState(() => readStorage(CART_KEY, []));
  const [wishlist, setWishlist] = useState(() => readStorage(WISHLIST_KEY, []));
  const [toasts, setToasts] = useState([]);

  const persistCart = useCallback((next) => {
    setCart(next);
    window.localStorage.setItem(CART_KEY, JSON.stringify(next));
  }, []);

  const notify = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone }]);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToCart = useCallback(
    (product, { quantity = 1, customization = {}, customizationFee = 0 } = {}) => {
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
          customizationFee,
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
        if (item) notify(`${item.product.title} was removed.`, 'neutral');
        return;
      }
      persistCart(
        cart.map((line) => (line.lineId === lineId ? { ...line, quantity: Math.min(10, quantity) } : line)),
      );
    },
    [cart, notify, persistCart],
  );

  const removeFromCart = useCallback(
    (lineId) => {
      const item = cart.find((line) => line.lineId === lineId);
      persistCart(cart.filter((line) => line.lineId !== lineId));
      if (item) notify(`${item.product.title} was removed.`, 'neutral');
    },
    [cart, notify, persistCart],
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
  const subtotal = cart.reduce(
    (total, line) => total + (line.product.price + (line.customizationFee || 0)) * line.quantity,
    0,
  );

  const value = useMemo(
    () => ({
      cart,
      wishlist,
      toasts,
      cartCount,
      subtotal,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      toggleWishlist,
      notify,
      dismissToast,
    }),
    [
      cart,
      wishlist,
      toasts,
      cartCount,
      subtotal,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      toggleWishlist,
      notify,
      dismissToast,
    ],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const context = useContext(ShopContext);
  if (!context) throw new Error('useShop must be used inside ShopProvider');
  return context;
}
