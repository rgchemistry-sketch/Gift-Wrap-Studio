import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadCheckoutConfirmation,
  removeCheckoutConfirmation,
  storeCheckoutConfirmation,
} from './checkout-confirmation.js';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('checkout confirmation survives a refresh without persisting customer details', () => {
  const storage = memoryStorage();
  const stored = storeCheckoutConfirmation('buyer-1', {
    _id: 'order-id',
    orderNumber: 'GNW-1042',
    shippingAddress: { line1: 'private address' },
    email: 'private@example.com',
  }, storage);
  const restored = loadCheckoutConfirmation('buyer-1', storage, stored.storedAt + 1_000);

  assert.deepEqual(restored, stored);
  assert.equal(JSON.stringify(restored).includes('private address'), false);
  assert.equal(JSON.stringify(restored).includes('private@example.com'), false);
  assert.equal(loadCheckoutConfirmation('buyer-2', storage, stored.storedAt + 1_000), null);
});

test('checkout confirmations expire and can be explicitly dismissed', () => {
  const storage = memoryStorage();
  const stored = storeCheckoutConfirmation('buyer-1', { orderNumber: 'GNW-1043' }, storage);
  assert.equal(loadCheckoutConfirmation('buyer-1', storage, stored.storedAt + 25 * 60 * 60 * 1_000), null);

  storeCheckoutConfirmation('buyer-1', { orderNumber: 'GNW-1044' }, storage);
  removeCheckoutConfirmation('buyer-1', storage);
  assert.equal(loadCheckoutConfirmation('buyer-1', storage), null);
});
