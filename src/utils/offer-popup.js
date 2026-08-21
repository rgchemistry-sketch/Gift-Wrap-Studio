export const OFFER_POPUP_MIN_DELAY_SECONDS = 10;
export const OFFER_POPUP_MAX_DELAY_SECONDS = 60;
export const OFFER_DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function effectiveOfferDelaySeconds(value) {
  const numeric = Number(value);
  const configured = Number.isFinite(numeric) ? numeric : OFFER_POPUP_MIN_DELAY_SECONDS;
  return Math.min(
    OFFER_POPUP_MAX_DELAY_SECONDS,
    Math.max(OFFER_POPUP_MIN_DELAY_SECONDS, configured),
  );
}

export function offerDismissalExpiresAt(now = Date.now()) {
  return Number(now) + OFFER_DISMISSAL_TTL_MS;
}

export function offerDismissalIsActive(storedExpiry, now = Date.now()) {
  if (storedExpiry === null || storedExpiry === undefined || storedExpiry === '') return false;
  const expiry = Number(storedExpiry);
  return Number.isFinite(expiry) && expiry > Number(now);
}
