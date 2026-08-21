import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dateInputIsBeforeMinimum,
  localDateInputValue,
} from './date-input.js';

test('localDateInputValue keeps local calendar parts in native input order', () => {
  assert.equal(localDateInputValue(new Date(2026, 7, 5, 0, 5)), '2026-08-05');
  assert.equal(localDateInputValue(new Date('not-a-date')), '');
});

test('dateInputIsBeforeMinimum ignores blank optional dates and rejects past ones', () => {
  assert.equal(dateInputIsBeforeMinimum('', '2026-08-21'), false);
  assert.equal(dateInputIsBeforeMinimum('2026-08-20', '2026-08-21'), true);
  assert.equal(dateInputIsBeforeMinimum('2026-08-21', '2026-08-21'), false);
  assert.equal(dateInputIsBeforeMinimum('2026-08-22', '2026-08-21'), false);
});
