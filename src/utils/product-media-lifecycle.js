const normalizeOwner = (owner) => String(owner || '').trim() || 'guest';

export const shouldDiscardProductMedia = (previousOwner, nextOwner) => {
  const previous = normalizeOwner(previousOwner);
  const next = normalizeOwner(nextOwner);
  return previous !== 'guest' && previous !== next;
};
