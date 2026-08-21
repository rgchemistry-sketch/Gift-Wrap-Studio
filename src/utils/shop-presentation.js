export function getShopHeroCopy(filters = {}) {
  const category = String(filters.category || '').trim();
  const occasion = String(filters.occasion || '').trim();
  const query = String(filters.q || '').trim();

  if (category) {
    return {
      eyebrow: occasion ? `${occasion} · selected collection` : 'Selected collection',
      title: category,
      accent: 'with a story inside.',
      description: occasion
        ? `Hand-finished ${category.toLowerCase()} chosen for ${occasion.toLowerCase()} moments and made personal in the studio.`
        : `Explore ${category.toLowerCase()} shaped, finished and checked by hand—then made personal for the way you want to gift.`,
    };
  }

  if (occasion) {
    return {
      eyebrow: 'Gifts by occasion',
      title: `${occasion} gifts`,
      accent: 'made to be remembered.',
      description: `Meaningful pieces for ${occasion.toLowerCase()} moments, with room for names, photographs, flowers and your own details.`,
    };
  }

  if (query) {
    return {
      eyebrow: 'The studio search',
      title: `Pieces for “${query}”`,
      accent: 'found with care.',
      description: 'Refine the results below, or begin a custom brief if the piece in your mind has not been made yet.',
    };
  }

  return {
    eyebrow: 'The studio collection',
    title: 'Made slowly.',
    accent: 'Kept forever.',
    description: 'Discover personalized gifts, sculptural clocks, table accents and memory-rich décor—finished by hand, one piece at a time.',
  };
}

export function getCatalogEmptyCopy(hasActiveFilters) {
  if (hasActiveFilters) {
    return {
      title: 'No pieces match those choices—yet.',
      description: 'Remove one or more filters, or tell us what you imagined and we can create it especially for you.',
    };
  }

  return {
    title: 'Fresh work is taking shape.',
    description: 'The ready-to-shop shelf is between releases. The custom atelier is still open for your idea.',
  };
}

export function formatPieceCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  return `${safeCount} ${safeCount === 1 ? 'piece' : 'pieces'}`;
}
