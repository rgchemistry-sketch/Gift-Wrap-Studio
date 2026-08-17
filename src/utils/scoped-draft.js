const guestOwner = 'guest';

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const parseDraft = (value) => {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const scopedDraftOwner = (userId = '') => String(userId || '').trim() || guestOwner;

export const scopedDraftKey = (baseKey, userId = '') => (
  `${baseKey}:${scopedDraftOwner(userId)}`
);

export function loadScopedDraft(
  baseKey,
  userId = '',
  { transferGuest = false, migrateLegacy = false } = {},
) {
  const localStorage = storage();
  if (!localStorage) return null;
  const normalizedUserId = String(userId || '').trim();
  const destinationKey = scopedDraftKey(baseKey, normalizedUserId);
  let draft;
  try {
    const accountDraft = parseDraft(localStorage.getItem(destinationKey));
    const guestDraft = normalizedUserId && transferGuest
      ? parseDraft(localStorage.getItem(scopedDraftKey(baseKey)))
      : null;

    // A draft written in this guest session is the user's current work. It wins
    // over an older account-scoped draft when sign-in completes.
    draft = guestDraft || accountDraft;
    if (normalizedUserId && !draft && migrateLegacy) {
      draft = parseDraft(localStorage.getItem(baseKey));
    }

  } catch {
    return null;
  }

  let transferred = !normalizedUserId || !draft;
  if (normalizedUserId && draft) {
    try {
      localStorage.setItem(destinationKey, JSON.stringify(draft));
      transferred = true;
    } catch {
      transferred = false;
    }
  }
  try {
    if (normalizedUserId && transferGuest && transferred) {
      localStorage.removeItem(scopedDraftKey(baseKey));
    }
    // Older builds used an unscoped key. Never expose it to an anonymous viewer.
    localStorage.removeItem(baseKey);
  } catch {
    // The loaded in-memory form remains usable when storage becomes unavailable.
  }
  return draft;
}

export function saveScopedDraft(baseKey, userId, draft) {
  const localStorage = storage();
  if (!localStorage) return false;
  try {
    localStorage.setItem(scopedDraftKey(baseKey, userId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeScopedDraft(baseKey, userId) {
  const localStorage = storage();
  if (!localStorage) return;
  try {
    localStorage.removeItem(scopedDraftKey(baseKey, userId));
    localStorage.removeItem(baseKey);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}
