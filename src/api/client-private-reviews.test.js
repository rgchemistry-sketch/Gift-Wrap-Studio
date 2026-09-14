import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { api } from './client.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const jsonResponse = (data) => new Response(JSON.stringify({ data }), {
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  globalThis.window = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
});

test('private review and eligibility reads stay separate during an account switch', async () => {
  const pending = new Map();
  globalThis.fetch = (url, options) => new Promise((resolve) => {
    assert.equal(options.cache, 'no-store');
    pending.set(`${url}:${options.headers.get('X-Expected-User-Id')}`, resolve);
  });
  const aReviews = api.getMyReviews('buyer-a');
  const aEligible = api.getEligibleReviews('buyer-a');
  const bReviews = api.getMyReviews('buyer-b');
  const bEligible = api.getEligibleReviews('buyer-b');

  assert.equal(pending.size, 4, 'different owners must not reuse an in-flight private response');
  for (const owner of ['buyer-b', 'buyer-a']) {
    pending.get(`/api/reviews/mine:${owner}`)(jsonResponse({ reviews: [{ id: `${owner}-review` }] }));
    pending.get(`/api/reviews/eligible:${owner}`)(jsonResponse({ products: [{ id: `${owner}-product` }] }));
  }
  assert.deepEqual((await aReviews).data.reviews, [{ id: 'buyer-a-review' }]);
  assert.deepEqual((await aEligible).data.products, [{ id: 'buyer-a-product' }]);
  assert.deepEqual((await bReviews).data.reviews, [{ id: 'buyer-b-review' }]);
  assert.deepEqual((await bEligible).data.products, [{ id: 'buyer-b-product' }]);
});
