import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactCartMutationHistory,
  mutationKeyPrefixFor,
  reduceCartMutations,
  reduceWishlistMutations,
} from './shop-sync.js';

const line = (lineId) => ({
  lineId,
  product: { id: lineId, slug: lineId, price: 100 },
  quantity: 1,
  customization: {},
});

const op = (overrides) => ({
  version: 1,
  ownerId: 'buyer-a',
  sourceId: 'tab-a',
  operationId: `op-${overrides.clock}-${overrides.sourceId || 'tab-a'}`,
  ...overrides,
});

test('concurrent cart additions converge and same-line deltas apply exactly once', () => {
  const operations = [
    op({ action: 'cart/add', clock: 1, line: line('rose'), quantity: 1 }),
    op({ action: 'cart/add', clock: 1, sourceId: 'tab-b', line: line('rose'), quantity: 2 }),
    op({ action: 'cart/add', clock: 1, sourceId: 'tab-c', line: line('candle'), quantity: 1 }),
  ];
  const duplicateDelivery = [operations[2], operations[1], operations[0], operations[1]];
  assert.deepEqual(
    reduceCartMutations([], duplicateDelivery, 'buyer-a'),
    reduceCartMutations([], operations, 'buyer-a'),
  );
  assert.deepEqual(
    reduceCartMutations([], duplicateDelivery, 'buyer-a').map(({ lineId, quantity }) => ({ lineId, quantity })),
    [{ lineId: 'rose', quantity: 3 }, { lineId: 'candle', quantity: 1 }],
  );
});

test('remove and clear replay in deterministic order without snapshot resurrection', () => {
  const operations = [
    op({ action: 'cart/add', clock: 1, line: line('rose'), quantity: 1 }),
    op({ action: 'cart/remove', clock: 2, lineId: 'rose' }),
    op({ action: 'cart/add', clock: 3, line: line('candle'), quantity: 1 }),
    op({ action: 'cart/clear', clock: 4 }),
  ];
  assert.deepEqual(reduceCartMutations([line('stale')], operations.toReversed(), 'buyer-a'), []);
});

test('concurrent wishlist changes merge, dedupe, and stay owner scoped', () => {
  const operations = [
    op({ action: 'wishlist/set', clock: 1, productId: 'rose', included: true }),
    op({ action: 'wishlist/set', clock: 1, sourceId: 'tab-b', productId: 'candle', included: true }),
  ];
  assert.deepEqual(
    reduceWishlistMutations([], [operations[1], operations[0], operations[0]], 'buyer-a').sort(),
    ['candle', 'rose'],
  );
  assert.deepEqual(reduceWishlistMutations([], operations, 'buyer-b'), []);
  assert.notEqual(mutationKeyPrefixFor('buyer-a'), mutationKeyPrefixFor('buyer-b'));
});

test('malformed journal lines are ignored instead of poisoning the projection', () => {
  const malformed = op({
    action: 'cart/add',
    clock: 1,
    line: { lineId: 'broken', product: null, customization: {} },
    quantity: 1,
  });
  assert.deepEqual(reduceCartMutations([line('safe')], [malformed], 'buyer-a'), [line('safe')]);
  assert.deepEqual(reduceCartMutations([line('safe')], [{
    ...op({ action: 'cart/clear', clock: 1 }),
    clock: Number.MAX_SAFE_INTEGER,
  }], 'buyer-a'), [line('safe')]);
});

test('cart patches replace stale optional fields while preserving identity and quantity', () => {
  const unavailable = {
    ...line('rose'),
    quantity: 2,
    unavailable: true,
    unavailableReason: 'Sold out',
  };
  const refreshed = line('rose');
  const { lineId: _lineId, quantity: _quantity, ...patch } = refreshed;
  const operation = op({ action: 'cart/patch', clock: 1, lineId: 'rose', patch });
  assert.deepEqual(reduceCartMutations([unavailable], [operation], 'buyer-a'), [{
    ...refreshed,
    quantity: 2,
  }]);
});

test('simultaneous two-tab personalization recovery changes quantity exactly once', () => {
  const standard = {
    ...line('plaque-standard'),
    product: { id: 'plaque', slug: 'plaque', price: 100 },
    quantity: 3,
  };
  const customized = {
    ...line('plaque-name-mira'),
    product: { id: 'plaque', slug: 'plaque', price: 100 },
    quantity: 2,
    customization: { name: 'Mira' },
  };
  const recoveries = [
    op({ action: 'cart/recover-standard', clock: 1, lineId: customized.lineId }),
    op({
      action: 'cart/recover-standard',
      clock: 1,
      sourceId: 'tab-b',
      lineId: customized.lineId,
    }),
  ];

  assert.deepEqual(
    reduceCartMutations([standard, customized], recoveries, 'buyer-a'),
    [{ ...standard, quantity: 5 }],
  );
});

test('a clear boundary compacts only known earlier cart operations', () => {
  const before = op({ action: 'cart/add', clock: 1, line: line('rose'), quantity: 1 });
  const clear = op({ action: 'cart/clear', clock: 2 });
  const after = op({ action: 'cart/add', clock: 3, line: line('candle'), quantity: 1 });
  const compacted = compactCartMutationHistory([line('legacy')], [after, before, clear], 'buyer-a');
  assert.deepEqual(compacted.base, []);
  assert.deepEqual(compacted.removed.map(({ operationId }) => operationId), [before.operationId]);
  assert.deepEqual(compacted.operations.map(({ operationId }) => operationId), [
    clear.operationId,
    after.operationId,
  ]);
});
