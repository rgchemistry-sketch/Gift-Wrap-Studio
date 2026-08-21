const MIN_TOAST_DURATION_MS = 1_500;
const MAX_TOAST_DURATION_MS = 30_000;

export function clampToastDuration(value) {
  if (!Number.isFinite(Number(value))) return undefined;
  return Math.max(MIN_TOAST_DURATION_MS, Math.min(MAX_TOAST_DURATION_MS, Number(value)));
}

export function normalizeToastAction(action, { duration, now = Date.now() } = {}) {
  if (
    !action
    || typeof action.onClick !== 'function'
    || !String(action.label || '').trim()
  ) return undefined;

  const expiresMs = clampToastDuration(action.expiresMs) ?? clampToastDuration(duration);
  const requestedDeadline = Number(action.expiresAt);
  const expiresAt = Number.isFinite(requestedDeadline)
    ? requestedDeadline
    : expiresMs
      ? now + expiresMs
      : undefined;

  return {
    label: String(action.label).trim(),
    onClick: action.onClick,
    expiresMs,
    expiresAt,
  };
}

export function isToastActionAvailable(action, now = Date.now()) {
  if (!action || typeof action.onClick !== 'function') return false;
  return !Number.isFinite(Number(action.expiresAt)) || now < Number(action.expiresAt);
}

export function canDedupeToast(existing, incoming) {
  if (existing?.action || incoming?.action) return false;
  return existing?.message === incoming?.message && existing?.tone === incoming?.tone;
}

export function retainActionableToasts(toasts = [], passiveLimit = 4) {
  let passiveSlots = Math.max(0, passiveLimit);
  const retained = [];
  for (let index = toasts.length - 1; index >= 0; index -= 1) {
    const toast = toasts[index];
    if (toast?.action) {
      retained.push(toast);
    } else if (passiveSlots > 0) {
      retained.push(toast);
      passiveSlots -= 1;
    }
  }
  return retained.reverse();
}
