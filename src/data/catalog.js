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

export const demoProducts = [
  {
    id: 'p1',
    slug: 'pressed-flower-name-plaque',
    title: 'Pressed Flower Name Plaque',
    category: 'Personalized gifts',
    occasion: 'Housewarming',
    price: 1899,
    compareAt: 2199,
    image: '/assets/personalized-plaque.webp',
    gallery: [
      '/assets/personalized-plaque.webp',
      '/assets/hero-resin-studio.webp',
    ],
    badge: 'Studio favourite',
    customizable: true,
    inStock: true,
    leadTime: '7–10 business days',
    description: 'A luminous, botanical name plaque composed by hand with dried flowers, fine gold accents and your chosen lettering.',
    features: ['Personalized name', 'Pressed botanical composition', 'Ready to hang'],
  },
  {
    id: 'p2',
    slug: 'midnight-geode-wall-clock',
    title: 'Midnight Geode Wall Clock',
    category: 'Resin clocks',
    occasion: 'Wedding',
    price: 4299,
    image: '/assets/hero-resin-studio.webp',
    gallery: [
      '/assets/hero-resin-studio.webp',
      '/assets/serving-collection.webp',
    ],
    badge: 'Made to order',
    customizable: true,
    inStock: true,
    leadTime: '10–15 business days',
    description: 'Deep forest tones, hand-laid stone and a restrained sweep of gold make this clock an instant heirloom.',
    features: ['Silent movement', '12-inch diameter', 'Custom colour palette'],
  },
  {
    id: 'p3',
    slug: 'blush-bloom-ring-tray',
    title: 'Blush Bloom Ring Tray',
    category: 'Wedding collection',
    occasion: 'Wedding',
    price: 1299,
    image: '/assets/wedding-keepsake.webp',
    gallery: [
      '/assets/wedding-keepsake.webp',
      '/assets/personalized-plaque.webp',
    ],
    badge: 'Wedding edit',
    customizable: true,
    inStock: true,
    leadTime: '5–8 business days',
    description: 'A keepsake ring tray with the couple’s initials, date and a delicate arrangement of blush botanicals.',
    features: ['Names or initials', 'Wedding date', 'Gift-ready packaging'],
  },
  {
    id: 'p4',
    slug: 'malachite-serving-tray',
    title: 'Malachite Serving Tray',
    category: 'Serving collection',
    occasion: 'Housewarming',
    price: 2499,
    image: '/assets/serving-collection.webp',
    gallery: [
      '/assets/serving-collection.webp',
      '/assets/hero-resin-studio.webp',
    ],
    badge: 'Small batch',
    customizable: false,
    inStock: true,
    leadTime: '3–5 business days',
    description: 'A rich green marble-effect tray finished with sculptural gold handles and an easy-clean serving surface.',
    features: ['Hand-poured pattern', 'Gold-tone handles', 'Easy-clean finish'],
  },
  {
    id: 'p5',
    slug: 'ocean-edge-coaster-set',
    title: 'Ocean Edge Coaster Set',
    category: 'Serving collection',
    occasion: 'Birthday',
    price: 999,
    image: '/assets/serving-collection.webp',
    gallery: [
      '/assets/serving-collection.webp',
    ],
    badge: 'Ready to gift',
    customizable: false,
    inStock: true,
    leadTime: '3–5 business days',
    description: 'Four hand-poured coasters that capture foamy shoreline movement in pearly blues and translucent white.',
    features: ['Set of four', 'Cork-backed', 'No two patterns alike'],
  },
  {
    id: 'p6',
    slug: 'memory-photo-frame',
    title: 'Everlasting Memory Photo Frame',
    category: 'Personalized gifts',
    occasion: 'Anniversary',
    price: 2199,
    image: '/assets/personalized-plaque.webp',
    gallery: [
      '/assets/personalized-plaque.webp',
      '/assets/wedding-keepsake.webp',
    ],
    badge: 'Personalized',
    customizable: true,
    inStock: true,
    leadTime: '7–12 business days',
    description: 'A treasured photograph framed in florals, subtle foil and a short message chosen by you.',
    features: ['Photo upload', 'Custom message', 'Freestanding display'],
  },
  {
    id: 'p7',
    slug: 'botanical-bookends',
    title: 'Botanical Arch Bookends',
    category: 'Home décor',
    occasion: 'Housewarming',
    price: 2799,
    image: '/assets/hero-resin-studio.webp',
    gallery: [
      '/assets/hero-resin-studio.webp',
    ],
    badge: 'New in the studio',
    customizable: false,
    inStock: true,
    leadTime: '5–7 business days',
    description: 'Architectural resin arches holding preserved foliage—functional sculpture for shelves, consoles and desks.',
    features: ['Pair of two', 'Real preserved botanicals', 'Weighted base'],
  },
  {
    id: 'p8',
    slug: 'pet-memory-keepsake',
    title: 'Pet Memory Keepsake',
    category: 'Personalized gifts',
    occasion: 'Memorial',
    price: 1599,
    image: '/assets/wedding-keepsake.webp',
    gallery: [
      '/assets/wedding-keepsake.webp',
    ],
    badge: 'Made with care',
    customizable: true,
    inStock: true,
    leadTime: '7–10 business days',
    description: 'A gentle, personalized memento made to honour the little companion who made a home in your heart.',
    features: ['Name and date', 'Photo or silhouette', 'Choice of flowers'],
  },
  {
    id: 'p9',
    slug: 'golden-hour-desk-plaque',
    title: 'Golden Hour Desk Plaque',
    category: 'Corporate gifts',
    occasion: 'Corporate',
    price: 1499,
    image: '/assets/corporate-gifts.webp',
    gallery: [
      '/assets/corporate-gifts.webp',
      '/assets/personalized-plaque.webp',
    ],
    badge: 'Corporate gifting',
    customizable: true,
    inStock: true,
    leadTime: '7–12 business days',
    description: 'A polished desk plaque tailored with a name, designation and business mark for elevated team gifting.',
    features: ['Name and designation', 'Logo option', 'Bulk pricing on request'],
  },
  {
    id: 'p10',
    slug: 'monogram-initial-letter',
    title: 'Botanical Monogram Letter',
    category: 'Personalized gifts',
    occasion: 'Birthday',
    price: 1199,
    image: '/assets/personalized-plaque.webp',
    gallery: [
      '/assets/personalized-plaque.webp',
    ],
    badge: 'Under ₹1,500',
    customizable: true,
    inStock: false,
    leadTime: 'Join the restock list',
    description: 'A freestanding initial layered with petals, shimmer and metallic fragments in a palette made for its recipient.',
    features: ['Any initial', 'Custom colour story', 'Freestanding'],
  },
];

export const occasions = ['Anniversary', 'Birthday', 'Corporate', 'Housewarming', 'Memorial', 'Wedding'];

export const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);

export const findDemoProduct = (slugOrId) =>
  demoProducts.find((product) => product.slug === slugOrId || product.id === slugOrId);

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

  return {
    ...product,
    id: String(id || slug),
    slug,
    title,
    category: category || 'Studio collection',
    occasion: typeof product.occasion === 'object' ? product.occasion.name : product.occasion || 'Gifting',
    price: Number(product.price || product.basePrice || 0),
    compareAt: Number(product.compareAt || product.compareAtPrice || 0) || null,
    image,
    gallery: product.gallery?.length ? product.gallery : images.length ? images : [image],
    badge: product.badge || (product.customizable ? 'Personalized' : ''),
    customizable: Boolean(product.customizable ?? product.isCustomizable ?? product.madeToOrder ?? product.customizationOptions?.length),
    inStock: product.inStock ?? (product.inventory == null ? (product.stock === undefined ? true : product.stock > 0) : product.inventory > 0),
    leadTime: product.leadTime || product.processingTime || (product.leadTimeDays ? `${product.leadTimeDays} business days` : '5–10 business days'),
    description: product.description || 'A carefully finished resin piece, handmade in the Gift N Wrap Studio.',
    features: product.features?.length
      ? product.features
      : (product.customizationOptions || []).map((option) => typeof option === 'string' ? option : option.label || option.name).filter(Boolean),
  };
}
