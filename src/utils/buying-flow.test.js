import assert from 'node:assert/strict';
import test from 'node:test';
import {
  focusAndRevealFirstInvalid,
  shouldDisableBuyingAction,
  swipeDirection,
  trapDialogFocus,
} from './buying-flow.js';

test('invalid purchase fields receive focus and are revealed in the viewport', () => {
  const calls = [];
  const invalid = {
    tagName: 'INPUT',
    focus(options) { calls.push(['focus', options]); },
    scrollIntoView(options) { calls.push(['scroll', options]); },
  };
  const form = {
    querySelectorAll(selector) {
      assert.equal(selector, ':invalid');
      return [{ tagName: 'FIELDSET', focus() { calls.push(['wrong-focus']); } }, invalid];
    },
    querySelector(selector) {
      assert.equal(selector, ':invalid');
      return invalid;
    },
  };

  assert.equal(focusAndRevealFirstInvalid(form, { schedule: (callback) => callback() }), invalid);
  assert.deepEqual(calls, [
    ['focus', { preventScroll: true }],
    ['scroll', { behavior: 'smooth', block: 'center', inline: 'nearest' }],
  ]);
});

test('short drags are ignored while deliberate gallery swipes resolve direction', () => {
  assert.equal(swipeDirection(100, 75), 0);
  assert.equal(swipeDirection(200, 120), 1);
  assert.equal(swipeDirection(120, 200), -1);
});

test('a failed live catalogue check keeps its retry action enabled', () => {
  assert.equal(shouldDisableBuyingAction({
    catalogError: true,
    checkPending: true,
    needsAttention: true,
    acknowledgementRequired: true,
  }), false);
  assert.equal(shouldDisableBuyingAction({ checkPending: true }), true);
  assert.equal(shouldDisableBuyingAction({ needsAttention: true }), true);
  assert.equal(shouldDisableBuyingAction({ acknowledgementRequired: true }), true);
});

test('dialog focus wraps in both directions and recovers focus from outside', () => {
  const focusCalls = [];
  const hidden = { getClientRects: () => [] };
  const first = { focus: (options) => focusCalls.push(['first', options]) };
  const middle = { focus: (options) => focusCalls.push(['middle', options]) };
  const last = { focus: (options) => focusCalls.push(['last', options]) };
  let activeElement = last;
  const dialog = {
    ownerDocument: { get activeElement() { return activeElement; } },
    querySelectorAll: () => [hidden, first, middle, last],
    contains: (element) => [first, middle, last].includes(element),
  };
  const forwardEvent = {
    key: 'Tab',
    shiftKey: false,
    preventDefault: () => focusCalls.push(['prevent']),
  };

  assert.equal(trapDialogFocus(forwardEvent, dialog), true);
  assert.deepEqual(focusCalls, [
    ['prevent'],
    ['first', { preventScroll: true }],
  ]);

  focusCalls.length = 0;
  activeElement = first;
  assert.equal(trapDialogFocus({ ...forwardEvent, shiftKey: true }, dialog), true);
  assert.deepEqual(focusCalls, [
    ['prevent'],
    ['last', { preventScroll: true }],
  ]);

  focusCalls.length = 0;
  activeElement = { focus() {} };
  assert.equal(trapDialogFocus(forwardEvent, dialog), true);
  assert.deepEqual(focusCalls, [
    ['prevent'],
    ['first', { preventScroll: true }],
  ]);
});
