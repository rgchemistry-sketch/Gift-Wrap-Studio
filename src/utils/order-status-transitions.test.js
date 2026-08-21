import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BULK_ORDER_STATUS_TARGETS,
  canMoveAllOrdersTo,
  canMoveOrderStatus,
  canUpdateOrderStatus,
  canUseBulkOrderActions,
  legalOrderStatusOptions,
} from './order-status-transitions.js';

const options = [
  { value: 'placed', label: 'Placed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'ready', label: 'Ready' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

test('normal order transitions only move forward and cancel before shipping', () => {
  assert.equal(canMoveOrderStatus('placed', 'confirmed'), true);
  assert.equal(canMoveOrderStatus('placed', 'delivered'), true);
  assert.equal(canMoveOrderStatus('ready', 'cancelled'), true);
  assert.equal(canMoveOrderStatus('ready', 'in_progress'), false);
  assert.equal(canMoveOrderStatus('shipped', 'ready'), false);
  assert.equal(canMoveOrderStatus('shipped', 'cancelled'), false);
  assert.equal(canMoveOrderStatus('shipped', 'delivered'), true);
  assert.equal(canMoveOrderStatus('delivered', 'cancelled'), false);
  assert.equal(canMoveOrderStatus('cancelled', 'placed'), false);
});

test('row options retain the current value and expose only server-legal destinations', () => {
  assert.deepEqual(
    legalOrderStatusOptions('ready', options).map(({ value }) => value),
    ['ready', 'shipped', 'delivered', 'cancelled'],
  );
  assert.deepEqual(
    legalOrderStatusOptions('shipped', options).map(({ value }) => value),
    ['shipped', 'delivered'],
  );
  assert.deepEqual(
    legalOrderStatusOptions('delivered', options).map(({ value }) => value),
    ['delivered'],
  );
});

test('bulk controls are available only when every selected order can make the move', () => {
  assert.deepEqual(BULK_ORDER_STATUS_TARGETS, ['in_progress', 'ready']);
  assert.equal(canUseBulkOrderActions('placed'), true);
  assert.equal(canUseBulkOrderActions('in_progress'), true);
  assert.equal(canUseBulkOrderActions('ready'), false);
  assert.equal(canUseBulkOrderActions('shipped'), false);
  assert.equal(canMoveAllOrdersTo([{ status: 'placed' }, { status: 'confirmed' }], 'in_progress'), true);
  assert.equal(canMoveAllOrdersTo([{ status: 'placed' }, { status: 'in_progress' }], 'in_progress'), false);
  assert.equal(canMoveAllOrdersTo([{ status: 'placed' }, { status: 'in_progress' }], 'ready'), true);
  assert.equal(canMoveAllOrdersTo([], 'ready'), false);
});

test('guarded undo matches the server contract for recent fulfilment changes', () => {
  assert.equal(canUpdateOrderStatus('ready', 'placed', {
    undo: true,
    expectedStatus: 'ready',
  }), true);
  assert.equal(canUpdateOrderStatus('ready', 'placed', {
    undo: true,
    expectedStatus: 'in_progress',
  }), false);
  assert.equal(canUpdateOrderStatus('ready', 'ready', { undo: true }), false);
  assert.equal(canUpdateOrderStatus('delivered', 'ready', {
    undo: true,
    expectedStatus: 'delivered',
  }), false);
});
