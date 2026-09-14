import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { api } from './client.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const jsonResponse = (data, meta = { totalPages: 1 }) => new Response(JSON.stringify({ data, meta }), {
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  globalThis.window = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
});

test('simultaneous order reads for different account owners never share a response', async () => {
  const pending = new Map();
  globalThis.fetch = (_url, options) => new Promise((resolve) => {
    pending.set(options.headers.get('X-Expected-User-Id'), resolve);
  });
  const a = api.getAllBuyerOrders('buyer-a');
  const b = api.getAllBuyerOrders('buyer-b');
  assert.equal(pending.size, 2);
  pending.get('buyer-b')(jsonResponse([{ id: 'b-private' }]));
  pending.get('buyer-a')(jsonResponse([{ id: 'a-private' }]));
  assert.deepEqual(await a, [{ id: 'a-private' }]);
  assert.deepEqual(await b, [{ id: 'b-private' }]);
});

test('all order pages retain the expected owner and existing unscoped callers still work', async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), owner: options.headers.get('X-Expected-User-Id'), cache: options.cache });
    const page = new URL(String(url), 'https://studio.test').searchParams.get('page') || '1';
    return jsonResponse([{ id: `order-${page}` }], { totalPages: 2 });
  };
  assert.equal((await api.getAllBuyerOrders('buyer-a')).length, 2);
  assert.deepEqual(requests.map(({ owner }) => owner), ['buyer-a', 'buyer-a']);
  assert.equal(requests.every(({ cache }) => cache === 'no-store'), true);
  await api.getBuyerOrders({ page: 1, limit: 5 });
  assert.equal(requests.at(-1).owner, null);
  assert.match(requests.at(-1).url, /limit=5/);
});
