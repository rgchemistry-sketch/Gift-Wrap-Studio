export const CART_CUSTOMIZATION_UNAVAILABLE_REASON =
  'Personalization is no longer available for this piece.';

export const hasCartCustomization = (line) => Boolean(
  line?.customization
  && typeof line.customization === 'object'
  && !Array.isArray(line.customization)
  && Object.keys(line.customization).length > 0
);

const liveCustomizationAvailable = (product = {}) => (
  product.customizationAvailable ?? product.customizable
);

const versionTime = (value) => Date.parse(String(value || ''));

const isExplicitlyNewerVersion = (candidate, baseline) => {
  const candidateTime = versionTime(candidate);
  const baselineTime = versionTime(baseline);
  return Number.isFinite(candidateTime)
    && Number.isFinite(baselineTime)
    && candidateTime > baselineTime;
};

const newestBlockingVersion = (existing, candidate) => {
  if (!existing) return String(candidate || '');
  return isExplicitlyNewerVersion(candidate, existing) ? String(candidate) : String(existing);
};

export function removeCartLineCustomization(line) {
  const recovered = { ...line, customization: {} };
  delete recovered.customizationUnavailable;
  delete recovered.customizationUnavailableReason;
  delete recovered.customizationUnavailableSource;
  delete recovered.customizationUnavailableCatalogVersion;
  // Removed after the rollout that unified server and catalogue version ordering.
  delete recovered.customizationUnavailableVersionSource;
  return recovered;
}

export function markCartCustomizationUnavailable(lines = [], {
  productId = '',
  slug = '',
  productVersion = '',
} = {}) {
  let matched = false;
  let changed = false;
  const cart = lines.map((line) => {
    const sameProduct = (productId && String(line.product.id) === String(productId))
      || (slug && String(line.product.slug) === String(slug));
    if (!sameProduct || !hasCartCustomization(line)) return line;
    matched = true;
    const blockedVersion = newestBlockingVersion(
      line.customizationUnavailableCatalogVersion,
      productVersion || line.product.updatedAt,
    );
    if (
      line.customizationUnavailable
      && line.customizationUnavailableReason === CART_CUSTOMIZATION_UNAVAILABLE_REASON
      && line.customizationUnavailableSource === 'server'
      && String(line.customizationUnavailableCatalogVersion || '') === blockedVersion
    ) return line;
    changed = true;
    return {
      ...line,
      customizationUnavailable: true,
      customizationUnavailableReason: CART_CUSTOMIZATION_UNAVAILABLE_REASON,
      customizationUnavailableSource: 'server',
      customizationUnavailableCatalogVersion: blockedVersion,
    };
  });
  return { cart, matched, changed };
}

export function recoverCartLineWithoutCustomization(lines = [], lineId = '') {
  const item = lines.find((line) => line.lineId === lineId);
  if (!item || !hasCartCustomization(item)) return { cart: lines, item: null };

  const recovered = removeCartLineCustomization(item);
  const productId = String(item.product?.id || item.product?.slug || '').trim();
  const standardLineId = productId ? `${productId}-standard` : item.lineId;
  const standardLine = lines.find((line) => (
    line.lineId === standardLineId && line.lineId !== item.lineId
  ));

  if (standardLine && standardLine.quantity + item.quantity <= 10) {
    return {
      item,
      cart: lines
        .filter((line) => line.lineId !== item.lineId)
        .map((line) => (
          line.lineId === standardLine.lineId
            ? { ...line, quantity: line.quantity + item.quantity }
            : line
        )),
    };
  }

  return {
    item,
    cart: lines.map((line) => (
      line.lineId === item.lineId
        ? {
          ...recovered,
          lineId: standardLine ? recovered.lineId : standardLineId,
        }
        : line
    )),
  };
}

export function revalidateCartLines(lines = [], catalog = []) {
  const byId = new Map(catalog.map((product) => [String(product.id || ''), product]));
  const bySlug = new Map(catalog.map((product) => [String(product.slug || ''), product]));
  let changed = false;
  let priceChanges = 0;
  let newlyUnavailable = 0;
  let newlyCustomizationUnavailable = 0;

  const cart = lines.map((line) => {
    const liveProduct = byId.get(String(line.product.id || ''))
      || bySlug.get(String(line.product.slug || ''));
    if (!liveProduct) {
      if (line.unavailable && line.unavailableReason === 'This piece is no longer available.') {
        return line;
      }
      changed = true;
      if (!line.unavailable) newlyUnavailable += 1;
      return {
        ...line,
        unavailable: true,
        unavailableReason: 'This piece is no longer available.',
      };
    }

    if (isExplicitlyNewerVersion(line.product.updatedAt, liveProduct.updatedAt)) {
      // Cross-tab and in-flight catalogue responses may arrive out of order. Never
      // let an older product snapshot regress a line that already saw a newer one.
      return line;
    }

    const previousPrice = Number(line.product.price);
    const currentPrice = Number(liveProduct.price);
    const priceChanged = previousPrice !== currentPrice;
    const hasFiniteInventory = liveProduct.inventory != null
      && Number.isFinite(Number(liveProduct.inventory));
    const availableInventory = hasFiniteInventory ? Number(liveProduct.inventory) : null;
    const insufficientStock = availableInventory != null
      && availableInventory < Number(line.quantity || 0);
    const unavailable = liveProduct.inStock === false || insufficientStock;
    const unavailableReason = insufficientStock && availableInventory > 0
      ? `Only ${availableInventory} available. Reduce the quantity or remove this piece.`
      : unavailable
        ? 'This piece is currently unavailable.'
        : '';
    const customizationAvailability = liveCustomizationAvailable(liveProduct);
    const liveVersion = String(liveProduct.updatedAt || '');
    const blockedSource = ['catalog', 'server'].includes(line.customizationUnavailableSource)
      ? line.customizationUnavailableSource
      : '';
    const blockedVersion = String(line.customizationUnavailableCatalogVersion || '');
    const newerCatalogAllowsCustomization = customizationAvailability === true
      && blockedSource
      && isExplicitlyNewerVersion(liveVersion, blockedVersion);
    const customizationUnavailable = hasCartCustomization(line)
      && (
        customizationAvailability === false
        || (blockedSource && !newerCatalogAllowsCustomization)
      );
    const customizationUnavailableSource = customizationUnavailable
      ? blockedSource || 'catalog'
      : '';
    const customizationUnavailableVersion = customizationUnavailable
      ? customizationAvailability === false
        ? newestBlockingVersion(blockedVersion, liveVersion)
        : blockedVersion
      : '';

    if (priceChanged) priceChanges += 1;
    if (unavailable && !line.unavailable) newlyUnavailable += 1;
    if (customizationUnavailable && !line.customizationUnavailable) {
      newlyCustomizationUnavailable += 1;
    }
    if (
      line.product !== liveProduct
      || priceChanged
      || Boolean(line.unavailable) !== unavailable
      || String(line.unavailableReason || '') !== unavailableReason
      || Boolean(line.customizationUnavailable) !== customizationUnavailable
      || String(line.customizationUnavailableReason || '') !== (
        customizationUnavailable ? CART_CUSTOMIZATION_UNAVAILABLE_REASON : ''
      )
      || String(line.customizationUnavailableSource || '')
        !== customizationUnavailableSource
      || String(line.customizationUnavailableCatalogVersion || '')
        !== customizationUnavailableVersion
    ) {
      changed = true;
      const refreshed = {
        ...line,
        product: liveProduct,
        ...(priceChanged ? { priceUpdatedFrom: previousPrice } : {}),
      };
      if (unavailable) {
        refreshed.unavailable = true;
        refreshed.unavailableReason = unavailableReason;
      } else {
        delete refreshed.unavailable;
        delete refreshed.unavailableReason;
      }
      if (customizationUnavailable) {
        refreshed.customizationUnavailable = true;
        refreshed.customizationUnavailableReason = CART_CUSTOMIZATION_UNAVAILABLE_REASON;
        refreshed.customizationUnavailableSource = customizationUnavailableSource;
        refreshed.customizationUnavailableCatalogVersion = customizationUnavailableVersion;
        delete refreshed.customizationUnavailableVersionSource;
      } else {
        delete refreshed.customizationUnavailable;
        delete refreshed.customizationUnavailableReason;
        delete refreshed.customizationUnavailableSource;
        delete refreshed.customizationUnavailableCatalogVersion;
        delete refreshed.customizationUnavailableVersionSource;
      }
      return refreshed;
    }
    return line;
  });

  return {
    cart,
    changed,
    priceChanges,
    newlyUnavailable,
    newlyCustomizationUnavailable,
  };
}
