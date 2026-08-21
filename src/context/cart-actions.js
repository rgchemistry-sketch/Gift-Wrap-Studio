export const ONLINE_QUANTITY_LIMIT = 10;
export const CART_REMOVAL_UNDO_MS = 8_000;

const normalizedQuantity = (value) => Math.max(
  1,
  Math.min(ONLINE_QUANTITY_LIMIT, Number.parseInt(value, 10) || 1),
);

export function cartLineId(product, customization = {}) {
  const signatureParts = Object.entries(customization)
    .filter(([, value]) => value && typeof value !== 'object')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`);
  const mediaPublicId = String(customization.media?.publicId || '').trim();
  if (mediaPublicId) signatureParts.push(`media:${mediaPublicId}`);
  const signature = signatureParts.join('|');
  return `${product.id}-${signature || 'standard'}`;
}

export function requiresAuthenticatedCartAddition(customization = {}) {
  const media = customization?.media;
  if (!media || typeof media !== 'object') return false;
  return Boolean(
    media.pending
    || String(media.name || '').trim()
    || String(media.url || '').trim()
    || String(media.publicId || '').trim(),
  );
}

export function addCartLine(lines = [], product, { quantity = 1, customization = {} } = {}) {
  const lineId = cartLineId(product, customization);
  const addition = normalizedQuantity(quantity);
  const existingIndex = lines.findIndex((item) => item.lineId === lineId);
  if (existingIndex < 0) {
    return {
      cart: [...lines, {
        lineId,
        product,
        quantity: addition,
        customization,
      }],
      lineId,
    };
  }

  const cart = [...lines];
  cart[existingIndex] = {
    ...cart[existingIndex],
    quantity: Math.min(ONLINE_QUANTITY_LIMIT, cart[existingIndex].quantity + addition),
  };
  return { cart, lineId };
}

export function removeCartLine(lines = [], lineId) {
  const item = lines.find((line) => line.lineId === lineId) || null;
  return {
    cart: item ? lines.filter((line) => line.lineId !== lineId) : lines,
    item,
  };
}

export function createDeferredAttachmentCleanup(
  item,
  {
    delay = CART_REMOVAL_UNDO_MS,
    schedule = globalThis.setTimeout,
    cancelSchedule = globalThis.clearTimeout,
    onCleanup = () => {},
  } = {},
) {
  const publicId = String(item?.customization?.media?.publicId || '').trim();
  let state = 'pending';
  const timer = schedule(() => {
    if (state !== 'pending') return;
    state = 'committed';
    if (publicId) onCleanup(item, publicId);
  }, delay);

  return {
    get state() {
      return state;
    },
    cancel() {
      if (state !== 'pending') return false;
      cancelSchedule(timer);
      state = 'cancelled';
      return true;
    },
    flush() {
      if (state !== 'pending') return false;
      cancelSchedule(timer);
      state = 'committed';
      onCleanup(item, publicId);
      return true;
    },
  };
}
