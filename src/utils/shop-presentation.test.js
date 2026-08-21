import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPieceCount,
  getCatalogEmptyCopy,
  getShopHeroCopy,
} from './shop-presentation.js';

test('shop hero reflects the selected category and occasion', () => {
  const copy = getShopHeroCopy({ category: 'Resin clocks', occasion: 'Wedding' });

  assert.equal(copy.eyebrow, 'Wedding · selected collection');
  assert.equal(copy.title, 'Resin clocks');
  assert.match(copy.description, /wedding moments/);
});

test('shop hero reflects an occasion when no collection is selected', () => {
  const copy = getShopHeroCopy({ occasion: 'Birthday' });

  assert.equal(copy.title, 'Birthday gifts');
  assert.equal(copy.accent, 'made to be remembered.');
});

test('empty collection copy does not suggest filters when none are active', () => {
  assert.equal(getCatalogEmptyCopy(false).title, 'Fresh work is taking shape.');
  assert.match(getCatalogEmptyCopy(true).description, /filters/);
});

test('piece count uses a singular label only for one', () => {
  assert.equal(formatPieceCount(0), '0 pieces');
  assert.equal(formatPieceCount(1), '1 piece');
  assert.equal(formatPieceCount(8), '8 pieces');
});
