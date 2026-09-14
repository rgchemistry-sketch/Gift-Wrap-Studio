import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuyerOrdersLoader, initialBuyerOrdersState } from './buyer-orders-loader.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test('first order load begins pending and ignores an older request finishing last', async () => {
  const requests = [deferred(), deferred()];
  const owners = [];
  let state = initialBuyerOrdersState('buyer-a');
  assert.equal(state.loading, true);
  const loader = createBuyerOrdersLoader({
    ownerId: 'buyer-a',
    fetchOrders: (owner) => { owners.push(owner); return requests[owners.length - 1].promise; },
    onChange: (next) => { state = next; },
  });
  const first = loader.load();
  const latest = loader.load();
  requests[1].resolve([{ id: 'newest' }]);
  await latest;
  requests[0].resolve([{ id: 'stale' }]);
  await first;
  assert.deepEqual(owners, ['buyer-a', 'buyer-a']);
  assert.deepEqual(state.orders, [{ id: 'newest' }]);
  assert.equal(state.loading, false);
});

test('refresh keeps existing orders visible even when the refresh fails', async () => {
  const refresh = deferred();
  let calls = 0;
  let state;
  const loader = createBuyerOrdersLoader({
    ownerId: 'buyer-a',
    fetchOrders: () => ++calls === 1 ? Promise.resolve([{ id: 'saved-order' }]) : refresh.promise,
    onChange: (next) => { state = next; },
  });
  await loader.load();
  const pending = loader.load();
  assert.equal(state.loading, false);
  assert.equal(state.refreshing, true);
  assert.deepEqual(state.orders, [{ id: 'saved-order' }]);
  refresh.reject(new Error('Temporarily unavailable'));
  await pending;
  assert.deepEqual(state.orders, [{ id: 'saved-order' }]);
  assert.equal(state.refreshing, false);
  assert.equal(state.error, 'Temporarily unavailable');
});

test('owner changes discard pending old-owner responses and stale refresh callbacks', async () => {
  const oldRequest = deferred();
  const states = [];
  let oldCalls = 0;
  const oldLoader = createBuyerOrdersLoader({
    ownerId: 'buyer-a',
    fetchOrders: () => { oldCalls += 1; return oldRequest.promise; },
    onChange: (next) => states.push(next),
  });
  const pending = oldLoader.load();
  oldLoader.dispose();
  const newLoader = createBuyerOrdersLoader({
    ownerId: 'buyer-b',
    fetchOrders: () => Promise.resolve([{ id: 'buyer-b-order' }]),
    onChange: (next) => states.push(next),
  });
  await newLoader.load();
  oldRequest.resolve([{ id: 'buyer-a-private-order' }]);
  await pending;
  await oldLoader.load();
  assert.equal(oldCalls, 1);
  assert.equal(states.at(-1).ownerId, 'buyer-b');
  assert.deepEqual(states.at(-1).orders, [{ id: 'buyer-b-order' }]);
  assert.equal(states.some((state) => state.orders.some((order) => order.id === 'buyer-a-private-order')), false);
});
