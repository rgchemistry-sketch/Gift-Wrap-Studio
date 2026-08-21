import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findTypeaheadOptionIndex,
  firstEnabledOptionIndex,
  lastEnabledOptionIndex,
  nextEnabledOptionIndex,
} from './storefront-select.js';

const options = [
  { value: '', label: 'Select one', disabled: true },
  { value: 'birthday', label: 'Birthday' },
  { value: 'wedding', label: 'Wedding', disabled: true },
  { value: 'anniversary', label: 'Anniversary' },
];

test('storefront select finds the first and last enabled choices', () => {
  assert.equal(firstEnabledOptionIndex(options), 1);
  assert.equal(lastEnabledOptionIndex(options), 3);
  assert.equal(firstEnabledOptionIndex([{ disabled: true }]), -1);
});

test('storefront select arrows wrap and skip disabled choices', () => {
  assert.equal(nextEnabledOptionIndex(options, 1, 1), 3);
  assert.equal(nextEnabledOptionIndex(options, 3, 1), 1);
  assert.equal(nextEnabledOptionIndex(options, 1, -1), 3);
});

test('storefront select typeahead starts after the current choice', () => {
  assert.equal(findTypeaheadOptionIndex(options, 'ann', 1), 3);
  assert.equal(findTypeaheadOptionIndex(options, 'birth', 3), 1);
  assert.equal(findTypeaheadOptionIndex(options, 'wed', 0), -1);
  assert.equal(findTypeaheadOptionIndex(options, 'missing', 0), -1);
});
