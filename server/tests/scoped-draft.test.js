import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  loadScopedDraft,
  saveScopedDraft,
  scopedDraftKey,
} from '../../src/utils/scoped-draft.js';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

beforeEach(() => {
  globalThis.window = { localStorage: new MemoryStorage() };
});

afterEach(() => {
  delete globalThis.window;
});

test('a guest draft transfers once to the account that authenticates', () => {
  const baseKey = 'test-checkout-draft';
  const guestDraft = { fullName: 'Guest Buyer', addressLine1: '12 Studio Road' };
  saveScopedDraft(baseKey, '', guestDraft);

  assert.deepEqual(
    loadScopedDraft(baseKey, 'buyer-a', { transferGuest: true }),
    guestDraft,
  );
  assert.equal(window.localStorage.getItem(scopedDraftKey(baseKey)), null);
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem(scopedDraftKey(baseKey, 'buyer-a'))),
    guestDraft,
  );
});

test('an account never hydrates another account draft', () => {
  const baseKey = 'test-custom-draft';
  const buyerADraft = { name: 'Buyer A', description: 'Private anniversary idea' };
  saveScopedDraft(baseKey, 'buyer-a', buyerADraft);

  assert.equal(loadScopedDraft(baseKey, 'buyer-b'), null);
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem(scopedDraftKey(baseKey, 'buyer-a'))),
    buyerADraft,
  );
});

test('a current guest draft replaces an older destination draft after sign-in', () => {
  const baseKey = 'test-returning-buyer-draft';
  const olderAccountDraft = { fullName: 'Returning Buyer', notes: 'Old request' };
  const currentGuestDraft = { fullName: 'Returning Buyer', notes: 'Fresh request' };
  saveScopedDraft(baseKey, 'buyer-a', olderAccountDraft);
  saveScopedDraft(baseKey, '', currentGuestDraft);

  assert.deepEqual(
    loadScopedDraft(baseKey, 'buyer-a', { transferGuest: true }),
    currentGuestDraft,
  );
  assert.equal(window.localStorage.getItem(scopedDraftKey(baseKey)), null);
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem(scopedDraftKey(baseKey, 'buyer-a'))),
    currentGuestDraft,
  );
});

test('an anonymous visitor never receives a legacy unscoped draft', () => {
  const baseKey = 'legacy-draft';
  window.localStorage.setItem(baseKey, JSON.stringify({ name: 'Previous Buyer' }));

  assert.equal(loadScopedDraft(baseKey), null);
  assert.equal(window.localStorage.getItem(baseKey), null);
});
