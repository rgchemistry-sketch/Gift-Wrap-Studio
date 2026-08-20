export const categories = [
  {
    name: 'Personalized gifts',
    slug: 'personalized-gifts',
    image: '/assets/personalized-plaque.webp',
    description: 'Names, photographs and moments, held in resin.',
  },
  {
    name: 'Resin clocks',
    slug: 'resin-clocks',
    image: '/assets/hero-resin-studio.webp',
    description: 'Sculptural timepieces with geode and ocean finishes.',
  },
  {
    name: 'Serving collection',
    slug: 'serving-collection',
    image: '/assets/serving-collection.webp',
    description: 'Serveware made for long lunches and lovely tables.',
  },
  {
    name: 'Home décor',
    slug: 'home-decor',
    image: '/assets/wedding-keepsake.webp',
    description: 'One-of-one art for corners that deserve attention.',
  },
];

// The canonical occasion vocabulary. Kept in step with the admin product editor so
// storefront occasion links (/shop?occasion=Wedding) always match stored values.
export const occasions = ['Anniversary', 'Birthday', 'Corporate', 'Housewarming', 'Memorial', 'Wedding'];

export const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);

const categoryFallbacks = {
  'Personalized gifts': '/assets/personalized-plaque.webp',
  'Resin clocks': '/assets/hero-resin-studio.webp',
  'Serving collection': '/assets/serving-collection.webp',
  'Wedding collection': '/assets/wedding-keepsake.webp',
  'Home décor': '/assets/hero-resin-studio.webp',
  'Corporate gifts': '/assets/corporate-gifts.webp',
};

export function normalizeProduct(product = {}) {
  const rawCategory = typeof product.category === 'object' ? product.category.name : product.category;
  const category = rawCategory === 'Home decor' ? 'Home décor' : rawCategory;
  const images = Array.isArray(product.images)
    ? product.images.map((image) => (typeof image === 'string' ? image : image?.url)).filter(Boolean)
    : [];
  const id = product.id || product._id || product.slug || product.name;
  const title = product.title || product.name || 'Untitled studio piece';
  const slug = product.slug || String(id || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const image = product.image || images[0] || categoryFallbacks[category] || '/assets/hero-resin-studio.webp';
  const rawOccasion = typeof product.occasion === 'object' ? product.occasion?.name : product.occasion;
  const customizable = Boolean(
    product.customizationAvailable
      ?? product.customizable
      ?? product.isCustomizable
      ?? product.madeToOrder
      ?? product.customizationOptions?.length,
  );

  return {
    ...product,
    id: String(id || slug),
    slug,
    title,
    category: category || 'Studio collection',
    // Blank stays blank: an unset occasion must not masquerade as a real one, or the
    // storefront's occasion filters silently match every product.
    occasion: String(rawOccasion || '').trim(),
    price: Number(product.price || product.basePrice || 0),
    compareAt: Number(product.compareAt || product.compareAtPrice || 0) || null,
    image,
    gallery: product.gallery?.length ? product.gallery : images.length ? images : [image],
    badge: product.badge || (customizable ? 'Personalized' : ''),
    customizationAvailable: customizable,
    customizable,
    inStock: product.inStock ?? (product.inventory == null ? (product.stock === undefined ? true : product.stock > 0) : product.inventory > 0),
    leadTime: product.leadTime || product.processingTime || (product.leadTimeDays ? `${product.leadTimeDays} business days` : '5–10 business days'),
    description: product.description || 'A carefully finished resin piece, handmade in the Gift N Wrap Studio.',
    features: product.features?.length
      ? product.features
      : (product.customizationOptions || []).map((option) => typeof option === 'string' ? option : option.label || option.name).filter(Boolean),
  };
}
