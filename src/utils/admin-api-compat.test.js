import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminOrderErrorMessage,
  requestAdminOrderWithFallback,
} from './admin-api-compat.js';

test('admin order loading prefers the dedicated route', async () => {
  const calls = [];
  const result = await requestAdminOrderWithFallback(async (path, options) => {
    calls.push({ path, options });
    return { data: { orderNumber: 'GNW-1' } };
  }, 'order/with spaces');
  assert.deepEqual(calls, [{
    path: '/admin/orders/order%2Fwith%20spaces',
    options: { cache: 'no-store' },
  }]);
  assert.equal(result.data.orderNumber, 'GNW-1');
});

test('a missing admin route falls back to the existing protected order route', async () => {
  const calls = [];
  const result = await requestAdminOrderWithFallback(async (path, options) => {
    calls.push({ path, options });
    if (calls.length === 1) {
      const error = new Error('No API route matches GET /api/admin/orders/order-1');
      error.code = 'ROUTE_NOT_FOUND';
      throw error;
    }
    return { data: { orderNumber: 'GNW-1', shippingAddress: { city: 'Delhi' } } };
  }, 'order-1');
  assert.deepEqual(calls, [
    { path: '/admin/orders/order-1', options: { cache: 'no-store' } },
    { path: '/orders/order-1', options: { cache: 'no-store' } },
  ]);
  assert.equal(result.data.shippingAddress.city, 'Delhi');
});

test('non-route failures are not retried and internal route text is hidden', async () => {
  const networkError = new Error('Network unavailable');
  await assert.rejects(
    requestAdminOrderWithFallback(async () => { throw networkError; }, 'order-1'),
    networkError,
  );
  assert.equal(
    adminOrderErrorMessage({ code: 'ROUTE_NOT_FOUND', message: 'No API route matches GET /api/admin/orders/1' }),
    'The secure order service is being updated. The verified summary remains available; please try again shortly.',
  );
  assert.equal(adminOrderErrorMessage(networkError), 'Network unavailable');
});
