import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canDedupeToast,
  isToastActionAvailable,
  normalizeToastAction,
  retainActionableToasts,
} from './toast-actions.js';

test('toast actions use one absolute deadline even when the visual toast is paused', () => {
  const action = normalizeToastAction({
    label: ' Undo ',
    expiresMs: 8_000,
    onClick() {},
  }, { now: 10_000 });

  assert.equal(action.label, 'Undo');
  assert.equal(action.expiresAt, 18_000);
  assert.equal(isToastActionAvailable(action, 17_999), true);
  assert.equal(isToastActionAvailable(action, 18_000), false);

  const expired = normalizeToastAction({
    label: 'Undo',
    expiresAt: 9_000,
    expiresMs: 8_000,
    onClick() {},
  }, { now: 10_000 });
  assert.equal(expired.expiresAt, 9_000, 'an explicit deadline must never be extended');
  assert.equal(isToastActionAvailable(expired, 10_000), false);
});

test('actionable toasts never dedupe or fall out of the passive queue cap', () => {
  const firstUndo = { id: 'undo-1', message: 'Piece was removed.', tone: 'neutral', action: { label: 'Undo' } };
  const secondUndo = { id: 'undo-2', message: 'Piece was removed.', tone: 'neutral', action: { label: 'Undo' } };
  assert.equal(canDedupeToast(firstUndo, secondUndo), false);
  assert.equal(canDedupeToast(
    { message: 'Saved.', tone: 'success' },
    { message: 'Saved.', tone: 'success' },
  ), true);

  const retained = retainActionableToasts([
    firstUndo,
    { id: 'passive-1' },
    { id: 'passive-2' },
    { id: 'passive-3' },
    { id: 'passive-4' },
    { id: 'passive-5' },
    secondUndo,
  ], 2);
  assert.deepEqual(retained.map(({ id }) => id), ['undo-1', 'passive-4', 'passive-5', 'undo-2']);
});
