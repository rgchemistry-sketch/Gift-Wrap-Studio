import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDiscardProductMedia } from './product-media-lifecycle.js';

test('product media follows a guest through their first sign-in', () => {
  assert.equal(shouldDiscardProductMedia('guest', 'buyer-a'), false);
});

test('product media is discarded when an authenticated owner leaves', () => {
  assert.equal(shouldDiscardProductMedia('buyer-a', 'guest'), true);
  assert.equal(shouldDiscardProductMedia('buyer-a', 'buyer-b'), true);
});

test('product media remains stable while the authenticated owner is unchanged', () => {
  assert.equal(shouldDiscardProductMedia('buyer-a', 'buyer-a'), false);
});
