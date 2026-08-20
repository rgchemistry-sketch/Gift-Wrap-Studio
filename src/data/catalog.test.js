import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProduct } from './catalog.js';

test('explicit customization availability overrides legacy product signals', () => {
  const product = normalizeProduct({
    id: 'disabled-customization',
    name: 'Ready-made tray',
    madeToOrder: true,
    customizationOptions: ['Name'],
    customizationAvailable: false,
  });

  assert.equal(product.customizationAvailable, false);
  assert.equal(product.customizable, false);
  assert.equal(product.badge, '');
});

test('legacy products keep their historical customization behavior', () => {
  assert.equal(normalizeProduct({ id: 'made-to-order', madeToOrder: true }).customizable, true);
  assert.equal(
    normalizeProduct({
      id: 'ready-made',
      madeToOrder: false,
      customizationOptions: ['Legacy option'],
    }).customizable,
    false,
  );
  assert.equal(
    normalizeProduct({ id: 'options-only', customizationOptions: ['Name'] }).customizable,
    true,
  );
});
