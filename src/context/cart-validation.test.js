import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CART_CUSTOMIZATION_UNAVAILABLE_REASON,
  markCartCustomizationUnavailable,
  recoverCartLineWithoutCustomization,
  removeCartLineCustomization,
  revalidateCartLines,
} from './cart-validation.js';

const customizedLine = () => ({
  lineId: 'plaque-name-mira',
  product: {
    id: 'plaque',
    slug: 'pressed-flower-plaque',
    title: 'Pressed Flower Plaque',
    price: 1_899,
    customizable: true,
  },
  quantity: 1,
  customization: {
    name: 'Mira',
    colour: 'Forest & gold',
    media: { publicId: 'gift-n-wrap/orders/photo-1' },
  },
});

test('live revalidation blocks stale personalization without discarding it', () => {
  const line = {
    ...customizedLine(),
    product: { ...customizedLine().product, updatedAt: '2026-08-21T10:00:00.000Z' },
  };
  const liveProduct = {
    ...line.product,
    customizationAvailable: false,
    customizable: false,
    inStock: true,
    updatedAt: '2026-08-21T10:02:00.000Z',
  };
  const result = revalidateCartLines([line], [liveProduct]);

  assert.equal(result.changed, true);
  assert.equal(result.newlyCustomizationUnavailable, 1);
  assert.equal(result.cart[0].customizationUnavailable, true);
  assert.equal(
    result.cart[0].customizationUnavailableReason,
    CART_CUSTOMIZATION_UNAVAILABLE_REASON,
  );
  assert.deepEqual(result.cart[0].customization, line.customization);
  assert.equal(result.cart[0].unavailable, undefined);
  assert.equal(result.cart[0].customizationUnavailableSource, 'catalog');
  assert.equal(
    result.cart[0].customizationUnavailableCatalogVersion,
    liveProduct.updatedAt,
  );
});

test('catalog blocks ignore stale true snapshots and clear on an explicitly newer true version', () => {
  const line = {
    ...customizedLine(),
    product: { ...customizedLine().product, updatedAt: '2026-08-21T10:00:00.000Z' },
  };
  const disabledT2 = {
    ...line.product,
    customizationAvailable: false,
    customizable: false,
    inStock: true,
    updatedAt: '2026-08-21T10:02:00.000Z',
  };
  const blocked = revalidateCartLines([line], [disabledT2]);

  const staleEnabledT1 = {
    ...line.product,
    customizationAvailable: true,
    customizable: true,
    inStock: true,
  };
  const stillBlocked = revalidateCartLines(blocked.cart, [staleEnabledT1]);
  assert.equal(stillBlocked.cart[0].customizationUnavailable, true);
  assert.equal(
    stillBlocked.cart[0].customizationUnavailableCatalogVersion,
    disabledT2.updatedAt,
  );

  const enabledT3 = {
    ...staleEnabledT1,
    updatedAt: '2026-08-21T10:05:00.000Z',
  };
  const cleared = revalidateCartLines(stillBlocked.cart, [enabledT3]);
  assert.equal(cleared.cart[0].customizationUnavailable, undefined);
  assert.deepEqual(cleared.cart[0].customization, line.customization);

  const staleDisabledAgain = revalidateCartLines(cleared.cart, [disabledT2]);
  assert.equal(staleDisabledAgain.cart[0].customizationUnavailable, undefined);
  assert.equal(staleDisabledAgain.cart[0].product.updatedAt, enabledT3.updatedAt);
});

test('standard lines remain orderable when personalization is disabled', () => {
  const line = { ...customizedLine(), customization: {} };
  const liveProduct = {
    ...line.product,
    customizationAvailable: false,
    customizable: false,
    inStock: true,
  };
  const result = revalidateCartLines([line], [liveProduct]);

  assert.equal(result.cart[0].customizationUnavailable, undefined);
  assert.equal(result.newlyCustomizationUnavailable, 0);
});

test('the explicit recovery clears personalization and its blocking state', () => {
  const blocked = {
    ...customizedLine(),
    customizationUnavailable: true,
    customizationUnavailableReason: CART_CUSTOMIZATION_UNAVAILABLE_REASON,
  };
  const recovered = removeCartLineCustomization(blocked);

  assert.deepEqual(recovered.customization, {});
  assert.equal(recovered.customizationUnavailable, undefined);
  assert.equal(recovered.customizationUnavailableReason, undefined);
  assert.notDeepEqual(blocked.customization, {});
});

test('recovery rekeys or merges the line without losing quantity', () => {
  const customized = { ...customizedLine(), quantity: 2 };
  const rekeyed = recoverCartLineWithoutCustomization([customized], customized.lineId);
  assert.equal(rekeyed.cart[0].lineId, 'plaque-standard');
  assert.equal(rekeyed.cart[0].quantity, 2);
  assert.deepEqual(rekeyed.cart[0].customization, {});

  const standard = {
    ...customizedLine(),
    lineId: 'plaque-standard',
    quantity: 3,
    customization: {},
  };
  const merged = recoverCartLineWithoutCustomization(
    [standard, customized],
    customized.lineId,
  );
  assert.equal(merged.cart.length, 1);
  assert.equal(merged.cart[0].lineId, 'plaque-standard');
  assert.equal(merged.cart[0].quantity, 5);
  assert.deepEqual(merged.item.customization, customized.customization);

  const fullStandard = { ...standard, quantity: 10 };
  const keptSeparate = recoverCartLineWithoutCustomization(
    [fullStandard, customized],
    customized.lineId,
  );
  assert.equal(keptSeparate.cart.length, 2);
  assert.equal(keptSeparate.cart.reduce((total, line) => total + line.quantity, 0), 12);
  assert.deepEqual(keptSeparate.cart[1].customization, {});
});

test('a server rejection stays blocking until a newer catalogue version is observed', () => {
  const line = {
    ...customizedLine(),
    product: { ...customizedLine().product, updatedAt: '2026-08-21T10:00:00.000Z' },
  };
  const marked = markCartCustomizationUnavailable([line], {
    productId: 'plaque',
    productVersion: '2026-08-21T10:02:00.000Z',
  });
  assert.equal(marked.matched, true);
  assert.equal(marked.cart[0].customizationUnavailableSource, 'server');

  const staleCatalog = {
    ...line.product,
    customizationAvailable: true,
    customizable: true,
    inStock: true,
  };
  const stillBlocked = revalidateCartLines(marked.cart, [staleCatalog]);
  assert.equal(stillBlocked.cart[0].customizationUnavailable, true);

  const restoredCatalog = {
    ...staleCatalog,
    updatedAt: '2026-08-21T10:05:00.000Z',
  };
  const cleared = revalidateCartLines(stillBlocked.cart, [restoredCatalog]);
  assert.equal(cleared.cart[0].customizationUnavailable, undefined);
  assert.deepEqual(cleared.cart[0].customization, line.customization);
});

test('revalidation clears the warning if the studio restores personalization', () => {
  const blocked = {
    ...customizedLine(),
    customizationUnavailable: true,
    customizationUnavailableReason: CART_CUSTOMIZATION_UNAVAILABLE_REASON,
  };
  const liveProduct = {
    ...blocked.product,
    customizationAvailable: true,
    customizable: true,
    inStock: true,
  };
  const result = revalidateCartLines([blocked], [liveProduct]);

  assert.equal(result.cart[0].customizationUnavailable, undefined);
  assert.equal(result.cart[0].customizationUnavailableReason, undefined);
  assert.deepEqual(result.cart[0].customization, blocked.customization);
});
