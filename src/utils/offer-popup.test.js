import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFER_DISMISSAL_TTL_MS,
  effectiveOfferDelaySeconds,
  offerDismissalExpiresAt,
  offerDismissalIsActive,
} from './offer-popup.js';

test('welcome offer always waits at least ten seconds', () => {
  assert.equal(effectiveOfferDelaySeconds(0), 10);
  assert.equal(effectiveOfferDelaySeconds(-4), 10);
  assert.equal(effectiveOfferDelaySeconds('not-a-number'), 10);
  assert.equal(effectiveOfferDelaySeconds(18), 18);
  assert.equal(effectiveOfferDelaySeconds(90), 60);
});

test('welcome offer dismissal remains active for seven days', () => {
  const now = 1_700_000_000_000;
  const expiry = offerDismissalExpiresAt(now);

  assert.equal(expiry, now + OFFER_DISMISSAL_TTL_MS);
  assert.equal(offerDismissalIsActive(String(expiry), now), true);
  assert.equal(offerDismissalIsActive(String(expiry), expiry), false);
  assert.equal(offerDismissalIsActive('true', now), false);
  assert.equal(offerDismissalIsActive(null, now), false);
});
