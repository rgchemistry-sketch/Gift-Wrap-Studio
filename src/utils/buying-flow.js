export function focusAndRevealFirstInvalid(form, {
  schedule = (callback) => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(callback);
    } else {
      callback();
    }
  },
} = {}) {
  const invalidControls = [...(form?.querySelectorAll?.(':invalid') || [])];
  const invalid = invalidControls.find((control) => {
    if (control.disabled) return false;
    if (typeof control.matches === 'function') {
      return control.matches('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
    }
    return ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(control.tagName);
  }) || form?.querySelector?.(':invalid');
  if (!invalid) return null;
  try {
    invalid.focus({ preventScroll: true });
  } catch {
    invalid.focus?.();
  }
  schedule(() => {
    invalid.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  });
  return invalid;
}

export function swipeDirection(startX, endX, minimumDistance = 44) {
  if (!Number.isFinite(startX) || !Number.isFinite(endX)) return 0;
  const distance = endX - startX;
  if (Math.abs(distance) < minimumDistance) return 0;
  return distance < 0 ? 1 : -1;
}

export function shouldDisableBuyingAction({
  catalogError = false,
  checkPending = false,
  needsAttention = false,
  acknowledgementRequired = false,
} = {}) {
  if (catalogError) return false;
  if (checkPending) return true;
  return Boolean(needsAttention || acknowledgementRequired);
}

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function canReceiveDialogFocus(element) {
  if (!element || element.disabled || element.hidden) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;
  if (element.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
  const styles = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  if (styles?.display === 'none' || styles?.visibility === 'hidden') return false;
  return true;
}

export function trapDialogFocus(event, dialog) {
  if (event?.key !== 'Tab' || !dialog?.querySelectorAll) return false;

  const focusable = [...dialog.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR)]
    .filter(canReceiveDialogFocus);
  const activeElement = dialog.ownerDocument?.activeElement
    || globalThis.document?.activeElement;
  const first = focusable[0];
  const last = focusable.at(-1);
  let destination = null;

  if (!first) {
    destination = dialog;
  } else if (event.shiftKey && (activeElement === first || !dialog.contains?.(activeElement))) {
    destination = last;
  } else if (!event.shiftKey && (activeElement === last || !dialog.contains?.(activeElement))) {
    destination = first;
  }

  if (!destination) return false;
  event.preventDefault?.();
  try {
    destination.focus?.({ preventScroll: true });
  } catch {
    destination.focus?.();
  }
  return true;
}
