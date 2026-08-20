import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../Icon';
import SmartImage from '../SmartImage';
import { api } from '../../api/client';
import { occasions } from '../../data/catalog';
import { invalidateCatalog } from '../../data/useCatalog';
import {
  imageFromReusableUrl,
  imageKey,
  moveProductImage,
  normalizeProductImageUrl,
  verifyProductImageUrl,
} from './product-image-utils';

const emptyProduct = {
  name: '',
  slug: '',
  category: 'Personalized gifts',
  occasion: '',
  shortDescription: '',
  description: '',
  price: '',
  compareAtPrice: '',
  inventory: '',
  sku: '',
  leadTimeDays: 7,
  sortOrder: 0,
  images: [],
  tags: '',
  customizationOptions: '',
  variants: [],
  active: true,
  featured: false,
  madeToOrder: true,
};

const categories = [
  'Personalized gifts',
  'Resin clocks',
  'Serving collection',
  'Wedding collection',
  'Home decor',
  'Corporate gifts',
];

const MAX_GALLERY_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const FIELD_CONTROL_IDS = {
  name: 'product-name',
  slug: 'product-slug',
  category: 'product-category',
  occasion: 'product-occasion',
  shortDescription: 'product-short-description',
  description: 'product-description',
  price: 'product-price',
  compareAtPrice: 'product-compare-price',
  inventory: 'product-inventory',
  sku: 'product-sku',
  leadTimeDays: 'product-lead-time',
  sortOrder: 'product-sort-order',
  tags: 'product-tags',
  customizationOptions: 'product-customization',
};
const PRODUCT_DRAFT_KEY = 'gnw-admin-product-draft';
const PRODUCT_DRAFT_VERSION = 1;

const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const makeSlug = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const numericOrNull = (value) => value === '' || value == null ? null : Number(value);

const productDraftStorageKey = (product) => `${PRODUCT_DRAFT_KEY}:${String(product?.id || product?._id || 'new')}`;

function readProductDraft(key, product) {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(key) || 'null');
    if (
      stored?.version !== PRODUCT_DRAFT_VERSION
      || !stored.draft
      || typeof stored.draft !== 'object'
      || !Array.isArray(stored.draft.images)
      || !Array.isArray(stored.draft.variants)
    ) return null;
    return {
      ...stored,
      draft: { ...toDraft(product), ...stored.draft },
      pendingUploadIds: Array.isArray(stored.pendingUploadIds) ? stored.pendingUploadIds.filter(Boolean) : [],
      pendingRetirementIds: Array.isArray(stored.pendingRetirementIds) ? stored.pendingRetirementIds.filter(Boolean) : [],
    };
  } catch {
    try { window.sessionStorage.removeItem(key); } catch { /* optional cache */ }
    return null;
  }
}

const removeProductDraft = (key) => {
  try { window.sessionStorage.removeItem(key); } catch { /* optional cache */ }
};

function toDraft(product) {
  if (!product) return { ...emptyProduct };
  return {
    ...emptyProduct,
    ...product,
    name: product.name || product.title || '',
    compareAtPrice: product.compareAtPrice ?? product.compareAt ?? '',
    inventory: product.inventory ?? product.stock ?? '',
    images: Array.isArray(product.images)
      ? product.images.map((image) => typeof image === 'string' ? { url: image, alt: product.name || '' } : image)
      : product.image ? [{ url: product.image, alt: product.name || product.title || '' }] : [],
    tags: Array.isArray(product.tags) ? product.tags.join(', ') : product.tags || '',
    customizationOptions: Array.isArray(product.customizationOptions) ? product.customizationOptions.join(', ') : product.customizationOptions || '',
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant) => ({
        ...variant,
        name: variant.name || '',
        sku: variant.sku || '',
        price: variant.price ?? '',
        inventory: variant.inventory ?? '',
        active: variant.active !== false,
      }))
      : [],
    active: product.active ?? product.inStock ?? true,
  };
}

export default function ProductEditor({ product, onClose, onSaved }) {
  const draftStorageKey = productDraftStorageKey(product);
  const restoredStateRef = useRef(undefined);
  if (restoredStateRef.current === undefined) {
    restoredStateRef.current = readProductDraft(draftStorageKey, product);
  }
  const restoredState = restoredStateRef.current;
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const fileInputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const focusedErrorRef = useRef('');
  const pendingUploadIdsRef = useRef(new Set(restoredState?.pendingUploadIds || []));
  const pendingRetirementIdsRef = useRef(new Set(restoredState?.pendingRetirementIds || []));
  const mountedRef = useRef(true);
  const [initialDraft, setInitialDraft] = useState(() => toDraft(product));
  const [draft, setDraft] = useState(() => restoredState?.draft || toDraft(product));
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cleaningUploads, setCleaningUploads] = useState(false);
  const [checkingImageUrl, setCheckingImageUrl] = useState(false);
  const [failedImageKeys, setFailedImageKeys] = useState(() => new Set());
  const [uploadStatus, setUploadStatus] = useState('');
  const [imageUrl, setImageUrl] = useState(() => restoredState?.imageUrl || '');
  const [slugTouched, setSlugTouched] = useState(() => restoredState?.slugTouched ?? Boolean(product));
  const [restoredDraft, setRestoredDraft] = useState(Boolean(restoredState));
  const editing = Boolean(product);
  const busy = saving || uploading || cleaningUploads || checkingImageUrl;
  const normalizedImageUrl = useMemo(() => normalizeProductImageUrl(imageUrl), [imageUrl]);
  const imageUrlFormatError = imageUrl.trim() && !normalizedImageUrl
    ? 'Use a Cloudinary HTTPS image URL or a site-relative path beginning with /.'
    : '';
  const slugChanged = editing && initialDraft.active && draft.slug !== initialDraft.slug;
  const permalinkPath = `/product/${draft.slug || makeSlug(draft.name) || 'your-product'}`;
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraft) || Boolean(imageUrl.trim()),
    [draft, imageUrl, initialDraft],
  );

  const clearFieldError = useCallback((...fields) => {
    setError('');
    setFieldErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      fields.forEach((field) => delete next[field]);
      return next;
    });
  }, []);

  const showFieldError = useCallback((field, message) => {
    setError('Please review the highlighted product details.');
    setFieldErrors((current) => ({ ...current, [field]: message }));
  }, []);

  const markImageFailed = useCallback((image) => {
    const key = imageKey(image);
    if (!key) return;
    setFailedImageKeys((current) => new Set(current).add(key));
  }, []);

  const markImageLoaded = useCallback((image) => {
    const key = imageKey(image);
    if (!key) return;
    setFailedImageKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const cleanupUploadedAssets = useCallback(async (publicIds) => {
    const uniqueIds = [...new Set(publicIds)].filter(Boolean);
    if (!uniqueIds.length) return [];
    const results = await Promise.allSettled(
      uniqueIds.map((publicId) => api.deleteUploadedAsset(publicId)),
    );
    const failures = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        pendingUploadIdsRef.current.delete(uniqueIds[index]);
        pendingRetirementIdsRef.current.delete(uniqueIds[index]);
      }
      else failures.push(result.reason?.message || `Could not remove ${uniqueIds[index]}.`);
    });
    return failures;
  }, []);

  useEffect(() => {
    const nextDraft = toDraft(product);
    const stored = readProductDraft(draftStorageKey, product);
    setInitialDraft(nextDraft);
    setDraft(stored?.draft || nextDraft);
    setImageUrl(stored?.imageUrl || '');
    setError('');
    setFieldErrors({});
    setFailedImageKeys(new Set());
    setCheckingImageUrl(false);
    setUploadStatus('');
    setSlugTouched(stored?.slugTouched ?? Boolean(product));
    setRestoredDraft(Boolean(stored));
    pendingUploadIdsRef.current = new Set(stored?.pendingUploadIds || []);
    pendingRetirementIdsRef.current = new Set(stored?.pendingRetirementIds || []);
  }, [draftStorageKey, product]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isDirty) {
      removeProductDraft(draftStorageKey);
      return;
    }
    try {
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify({
        version: PRODUCT_DRAFT_VERSION,
        draft,
        imageUrl,
        slugTouched,
        pendingUploadIds: [...pendingUploadIdsRef.current],
        pendingRetirementIds: [...pendingRetirementIdsRef.current],
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // The editor remains usable when private browsing blocks session storage.
    }
  }, [draft, draftStorageKey, imageUrl, isDirty, slugTouched]);

  const requestClose = useCallback(async () => {
    if (busy) {
      setError(uploading
        ? 'Wait for the current image upload to finish before closing the editor.'
        : checkingImageUrl
          ? 'Wait while the image URL is checked.'
        : cleaningUploads
          ? 'Wait while the unused images are removed.'
          : 'Wait for the product to finish saving before closing the editor.');
      return;
    }
    if (isDirty && !window.confirm('Discard your unsaved product changes?')) return;
    const pendingIds = [...new Set([
      ...pendingUploadIdsRef.current,
      ...pendingRetirementIdsRef.current,
    ])];
    if (pendingIds.length) {
      setCleaningUploads(true);
      setUploadStatus(`Removing ${pendingIds.length} unused ${pendingIds.length === 1 ? 'image' : 'images'}…`);
      const failures = await cleanupUploadedAssets(pendingIds);
      setCleaningUploads(false);
      if (failures.length) {
        setError(`The editor stayed open because ${failures.length === 1 ? 'an unused image could not' : 'some unused images could not'} be removed. ${failures.join(' ')}`);
        setUploadStatus('Unused image cleanup needs attention.');
        return;
      }
    }
    removeProductDraft(draftStorageKey);
    onClose();
  }, [busy, checkingImageUrl, cleaningUploads, cleanupUploadedAssets, draftStorageKey, isDirty, onClose, uploading]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const inertedElements = [];
    let current = backdropRef.current;

    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;
      [...parent.children].forEach((sibling) => {
        if (sibling !== current && sibling instanceof HTMLElement) {
          inertedElements.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      });
      current = parent;
    }

    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      inertedElements.forEach(([element, wasInert]) => {
        if (element.isConnected) element.inert = wasInert;
      });
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((element) => element.offsetWidth || element.offsetHeight || element.getClientRects().length);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleDialogKeyDown);
    return () => document.removeEventListener('keydown', handleDialogKeyDown);
  }, [requestClose]);

  useEffect(() => {
    if (!isDirty && !busy) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [busy, isDirty]);

  useEffect(() => {
    const field = Object.keys(fieldErrors)[0];
    if (!field) {
      focusedErrorRef.current = '';
      return undefined;
    }
    const signature = `${field}:${fieldErrors[field]}`;
    if (focusedErrorRef.current === signature) return undefined;
    focusedErrorRef.current = signature;
    const focusFrame = window.requestAnimationFrame(() => {
      const target = FIELD_CONTROL_IDS[field]
        ? document.getElementById(FIELD_CONTROL_IDS[field])
        : field === 'variants'
          ? dialogRef.current?.querySelector('.variant-row .form-control, .variant-list button')
          : field === 'imageUrl'
            ? dialogRef.current?.querySelector('.product-image-url .form-control')
            : field === 'images'
              ? dialogRef.current?.querySelector('.product-image-upload')
              : null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus?.({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [fieldErrors]);

  const title = editing ? 'Edit studio piece' : 'Create a new piece';
  const completion = useMemo(() => {
    const fields = [draft.name, draft.category, draft.shortDescription, draft.price, draft.images.length];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [draft]);

  const setField = (name, value) => {
    const relatedFields = ['price', 'compareAtPrice'].includes(name)
      ? ['price', 'compareAtPrice']
      : [name];
    clearFieldError(...relatedFields);
    setDraft((current) => ({ ...current, [name]: value }));
  };

  const addImage = (image) => {
    if (!image?.url) return;
    clearFieldError('images', 'imageUrl');
    setDraft((current) => {
      if (current.images.length >= MAX_GALLERY_IMAGES) return current;
      if (current.images.some((item) => item.url === image.url)) return current;
      return { ...current, images: [...current.images, image] };
    });
  };

  const updateImage = (index, changes) => {
    clearFieldError('images');
    setDraft((current) => ({
      ...current,
      images: current.images.map((image, imageIndex) => (
        imageIndex === index ? { ...image, ...changes } : image
      )),
    }));
  };

  const moveImage = (fromIndex, toIndex) => {
    if (busy) return;
    clearFieldError('images');
    setDraft((current) => ({
      ...current,
      images: moveProductImage(current.images, fromIndex, toIndex),
    }));
    setUploadStatus(toIndex === 0
      ? 'Cover image updated. Save the product to publish the new gallery order.'
      : `Image moved to position ${toIndex + 1}.`);
  };

  const removeImage = async (index) => {
    if (busy) return;
    const image = draft.images[index];
    if (!image) return;
    clearFieldError('images');
    if (image.publicId && pendingUploadIdsRef.current.has(image.publicId)) {
      setCleaningUploads(true);
      setError('');
      setUploadStatus('Removing the unused uploaded image…');
      const failures = await cleanupUploadedAssets([image.publicId]);
      setCleaningUploads(false);
      if (failures.length) {
        setError(`The image stayed in the gallery because it could not be removed. ${failures.join(' ')}`);
        setUploadStatus('Image cleanup failed. Try removing it again.');
        return;
      }
      setUploadStatus('Unused image removed securely.');
    }
    setDraft((current) => ({
      ...current,
      images: current.images.filter((_, itemIndex) => itemIndex !== index),
    }));
    const removedKey = imageKey(image);
    if (removedKey) {
      setFailedImageKeys((current) => {
        const next = new Set(current);
        next.delete(removedKey);
        return next;
      });
    }
  };

  const uploadImages = async (event) => {
    const files = [...(event.currentTarget.files || [])];
    event.currentTarget.value = '';
    if (!files.length) return;

    const availableSlots = MAX_GALLERY_IMAGES - draft.images.length;
    if (availableSlots <= 0) {
      setError(`A product can have up to ${MAX_GALLERY_IMAGES} images. Remove one before uploading another.`);
      return;
    }

    const rejected = [];
    const validatedFiles = files.filter((file) => {
      if (!file.size) {
        rejected.push(`${file.name}: the file is empty.`);
        return false;
      }
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        rejected.push(`${file.name}: use a JPG, PNG or WebP image.`);
        return false;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        rejected.push(`${file.name}: images must be 8 MB or smaller.`);
        return false;
      }
      return true;
    });
    const validFiles = validatedFiles.slice(0, availableSlots);
    const ignoredForLimit = validatedFiles.length - validFiles.length;

    if (!validFiles.length) {
      setError(rejected.join(' ') || 'Choose a JPG, PNG or WebP image up to 8 MB.');
      setFieldErrors((current) => ({
        ...current,
        images: rejected.join(' ') || 'Choose a JPG, PNG or WebP image up to 8 MB.',
      }));
      setUploadStatus('No images were uploaded.');
      return;
    }

    setUploading(true);
    clearFieldError('images');
    const uploadedImages = [];
    const uploadFailures = [];
    try {
      for (let index = 0; index < validFiles.length; index += 1) {
        if (!mountedRef.current) break;
        const file = validFiles[index];
        setUploadStatus(`Uploading image ${index + 1} of ${validFiles.length}: ${file.name}`);
        try {
          const image = await api.uploadImage(file, 'products');
          if (!mountedRef.current) {
            if (image.publicId) void api.deleteUploadedAsset(image.publicId).catch(() => {});
            break;
          }
          if (image.publicId) pendingUploadIdsRef.current.add(image.publicId);
          uploadedImages.push({ ...image, alt: draft.name || 'Gift N Wrap studio piece' });
        } catch (requestError) {
          if (!mountedRef.current) break;
          uploadFailures.push(`${file.name}: ${requestError.message}`);
        }
      }

      if (!mountedRef.current) return;
      if (uploadedImages.length) {
        setDraft((current) => ({
          ...current,
          images: [...current.images, ...uploadedImages].slice(0, MAX_GALLERY_IMAGES),
        }));
      }
      const statusParts = [`Uploaded ${uploadedImages.length} of ${validFiles.length} valid ${validFiles.length === 1 ? 'image' : 'images'}.`];
      if (rejected.length) statusParts.push(`${rejected.length} invalid ${rejected.length === 1 ? 'file was' : 'files were'} skipped.`);
      if (ignoredForLimit) statusParts.push(`${ignoredForLimit} ${ignoredForLimit === 1 ? 'file was' : 'files were'} skipped because the gallery limit is ${MAX_GALLERY_IMAGES}.`);
      setUploadStatus(statusParts.join(' '));
      setError([...rejected, ...uploadFailures].join(' '));
      if (rejected.length || uploadFailures.length) {
        setFieldErrors((current) => ({
          ...current,
          images: [...rejected, ...uploadFailures].join(' '),
        }));
      }
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  };

  const addImageFromUrl = async () => {
    if (draft.images.length >= MAX_GALLERY_IMAGES) {
      showFieldError('images', `A product can have up to ${MAX_GALLERY_IMAGES} images. Remove one before adding another.`);
      return;
    }
    if (!normalizedImageUrl) {
      showFieldError('imageUrl', 'Enter a Cloudinary HTTPS image URL or a site-relative path beginning with /.');
      return;
    }
    if (draft.images.some((image) => image.url === normalizedImageUrl)) {
      showFieldError('imageUrl', 'That image is already in the gallery.');
      return;
    }
    setCheckingImageUrl(true);
    clearFieldError('imageUrl');
    setUploadStatus('Checking the image URL and preview…');
    try {
      const dimensions = await verifyProductImageUrl(normalizedImageUrl);
      if (!mountedRef.current) return;
      const image = imageFromReusableUrl({
        url: normalizedImageUrl,
        initialImages: initialDraft.images,
        defaultAlt: draft.name || 'Gift N Wrap studio piece',
      });
      addImage(image);
      setImageUrl('');
      setUploadStatus(`Image URL verified (${dimensions.width} × ${dimensions.height}) and added to the gallery.`);
    } catch (validationError) {
      if (!mountedRef.current) return;
      showFieldError('imageUrl', validationError.message);
      setUploadStatus('The image URL was not added.');
    } finally {
      if (mountedRef.current) setCheckingImageUrl(false);
    }
  };

  const addVariant = () => {
    clearFieldError('variants');
    setDraft((current) => current.variants.length >= 100 ? current : ({
      ...current,
      variants: [...current.variants, { name: '', sku: '', price: '', inventory: '', active: true }],
    }));
  };

  const updateVariant = (index, name, value) => {
    clearFieldError('variants');
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant, itemIndex) => itemIndex === index ? { ...variant, [name]: value } : variant),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setFieldErrors({});
    if (!draft.images.length) {
      showFieldError('images', 'Add at least one product image before saving.');
      return;
    }
    if (failedImageKeys.size) {
      showFieldError('images', 'Remove or replace every gallery image that failed to load before saving.');
      return;
    }
    const productName = draft.name.trim();
    const shortDescription = draft.shortDescription.trim();
    const tags = splitList(draft.tags);
    const customizationOptions = splitList(draft.customizationOptions);
    const variants = draft.variants.map((variant) => ({
      ...variant,
      name: variant.name.trim(),
      sku: variant.sku.trim(),
      price: numericOrNull(variant.price),
      inventory: numericOrNull(variant.inventory),
    }));
    const sellingPrice = Number(draft.price);
    const compareAtPrice = numericOrNull(draft.compareAtPrice);
    const skus = [draft.sku, ...variants.map((variant) => variant.sku)]
      .map((sku) => sku.trim().toUpperCase())
      .filter(Boolean);

    if (productName.length < 2) {
      showFieldError('name', 'Use at least 2 characters for the product name.');
      return;
    }
    if (shortDescription.length < 10) {
      showFieldError('shortDescription', 'Use at least 10 characters for the short description.');
      return;
    }
    if (compareAtPrice != null && compareAtPrice < sellingPrice) {
      showFieldError('compareAtPrice', 'Compare-at price must be at least the selling price.');
      return;
    }
    if (tags.length > 30 || tags.some((tag) => tag.length > 50)) {
      showFieldError('tags', 'Use up to 30 search tags, with no more than 50 characters in each tag.');
      return;
    }
    if (customizationOptions.length > 30 || customizationOptions.some((option) => option.length > 100)) {
      showFieldError('customizationOptions', 'Use up to 30 customization choices, with no more than 100 characters in each choice.');
      return;
    }
    if (variants.some((variant) => !variant.name)) {
      showFieldError('variants', 'Name each variant, or remove any variant row you do not want to save.');
      return;
    }
    if (variants.length > 100) {
      showFieldError('variants', 'A product can have up to 100 variants.');
      return;
    }
    if (new Set(skus).size !== skus.length) {
      showFieldError('variants', 'Product and variant SKUs must be unique.');
      return;
    }
    setSaving(true); setError('');
    const payload = {
      name: productName,
      slug: makeSlug(draft.slug || draft.name),
      category: draft.category,
      occasion: draft.occasion,
      shortDescription,
      description: draft.description.trim(),
      price: sellingPrice,
      compareAtPrice,
      inventory: numericOrNull(draft.inventory),
      sku: draft.sku.trim(),
      leadTimeDays: Number(draft.leadTimeDays),
      sortOrder: Number(draft.sortOrder),
      images: draft.images,
      tags,
      customizationOptions,
      variants,
      active: draft.active,
      featured: draft.featured,
      madeToOrder: draft.madeToOrder,
    };
    try {
      const result = editing
        ? await api.updateAdminProduct(product.id || product._id, payload)
        : await api.createAdminProduct(payload);
      if (!mountedRef.current) return;
      const savedProduct = result.product || result.data || result;
      const retainedImageIds = new Set(payload.images.map((image) => image.publicId).filter(Boolean));
      const retiredImageIds = editing
        ? initialDraft.images
          .map((image) => image.publicId)
          .filter((publicId) => publicId && !retainedImageIds.has(publicId))
        : [];
      pendingUploadIdsRef.current.clear();
      retiredImageIds.forEach((publicId) => pendingRetirementIdsRef.current.add(publicId));

      let cleanupWarning = '';
      if (pendingRetirementIdsRef.current.size) {
        const retirementIds = [...pendingRetirementIdsRef.current];
        setUploadStatus(`Removing ${retirementIds.length} retired product ${retirementIds.length === 1 ? 'image' : 'images'}…`);
        const failures = await cleanupUploadedAssets(retirementIds);
        if (failures.length) {
          cleanupWarning = `The product was saved, but ${failures.length === 1 ? 'one retired image still needs' : 'some retired images still need'} storage cleanup. ${failures.join(' ')}`;
        }
      }
      if (!mountedRef.current) return;
      removeProductDraft(draftStorageKey);
      invalidateCatalog();
      onSaved(savedProduct, cleanupWarning);
    } catch (requestError) {
      if (mountedRef.current) {
        const details = Array.isArray(requestError.details)
          ? requestError.details
          : Array.isArray(requestError.details?.issues)
            ? requestError.details.issues
            : [];
        const nextFieldErrors = {};
        details.forEach((detail) => {
          const field = String(detail?.field || '').split('.')[0];
          if (field) nextFieldErrors[field] = detail.message || requestError.message;
        });
        setFieldErrors(nextFieldErrors);
        setError(Object.keys(nextFieldErrors).length
          ? 'The product was not saved. Review the highlighted details below.'
          : requestError.message);
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <div ref={backdropRef} className="product-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <aside
        ref={dialogRef}
        className="product-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-editor-title"
        aria-describedby="product-editor-description"
        aria-busy={busy}
        tabIndex={-1}
      >
        <header className="product-editor__header">
          <div>
            <p className="eyebrow">Catalogue atelier</p>
            <h2 id="product-editor-title">{title}</h2>
            <small id="product-editor-description">{completion}% of essential product details complete</small>
          </div>
          <button type="button" className="product-editor__close" onClick={requestClose} disabled={busy} aria-label="Close product editor"><Icon name="close" /></button>
        </header>
        <div
          className="product-editor__progress"
          role="progressbar"
          aria-label="Essential product details completed"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={completion}
          aria-valuetext={`${completion}% complete`}
        ><span aria-hidden="true" style={{ width: `${completion}%` }} /></div>

        <Form className="product-editor__form" onSubmit={submit} aria-busy={busy}>
          {error && <Alert variant="danger" className="soft-alert">{error}</Alert>}
          {restoredDraft && isDirty && <Alert variant="info" className="soft-alert"><strong>Unsaved product restored.</strong> Your draft and newly uploaded images were kept when you left the editor.</Alert>}

          <fieldset className="product-editor__fieldset" disabled={busy}>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>01</span><div><h3>Identity</h3><p>The details customers see first.</p></div></div>
            <div className="product-form-section__body">
            <div className="product-form-grid">
              <Form.Group controlId="product-name" className="span-2">
                <Form.Label>Product name</Form.Label>
                <Form.Control
                  required
                  minLength={2}
                  maxLength={140}
                  value={draft.name}
                  isInvalid={Boolean(fieldErrors.name)}
                  onChange={(event) => {
                    const name = event.target.value;
                    clearFieldError('name', 'slug');
                    setDraft((current) => ({
                      ...current,
                      name,
                      slug: !editing && !slugTouched ? makeSlug(name) : current.slug,
                    }));
                  }}
                  placeholder="Pressed flower name plaque"
                />
                <Form.Control.Feedback type="invalid">{fieldErrors.name}</Form.Control.Feedback>
              </Form.Group>
              <Form.Group controlId="product-slug">
                <Form.Label>URL handle</Form.Label>
                <Form.Control
                  required
                  maxLength={160}
                  value={draft.slug}
                  isInvalid={Boolean(fieldErrors.slug)}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setField('slug', makeSlug(event.target.value));
                  }}
                  placeholder="pressed-flower-name-plaque"
                />
                <Form.Control.Feedback type="invalid">{fieldErrors.slug}</Form.Control.Feedback>
                <div className="product-permalink-preview" title={permalinkPath}>
                  <span>Live path</span>
                  <code>{permalinkPath}</code>
                </div>
                {slugChanged && (
                  <p className="product-slug-warning" role="alert">
                    <Icon name="shield" size={14}/>
                    This published URL is changing. Existing saved or shared links will no longer open this product.
                  </p>
                )}
              </Form.Group>
              <Form.Group controlId="product-category"><Form.Label>Collection</Form.Label><Form.Select value={draft.category} isInvalid={Boolean(fieldErrors.category)} onChange={(event) => setField('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</Form.Select><Form.Control.Feedback type="invalid">{fieldErrors.category}</Form.Control.Feedback></Form.Group>
              <Form.Group controlId="product-occasion">
                <Form.Label>Occasion</Form.Label>
                <Form.Select value={draft.occasion || ''} isInvalid={Boolean(fieldErrors.occasion)} onChange={(event) => setField('occasion', event.target.value)}>
                  <option value="">No specific occasion</option>
                  {occasions.map((occasion) => <option key={occasion} value={occasion}>{occasion}</option>)}
                </Form.Select>
                <Form.Control.Feedback type="invalid">{fieldErrors.occasion}</Form.Control.Feedback>
                <Form.Text>Powers the storefront’s occasion navigation and shop filters.</Form.Text>
              </Form.Group>
              <Form.Group controlId="product-short-description" className="span-2"><Form.Label>Short description</Form.Label><Form.Control required minLength={10} maxLength={240} value={draft.shortDescription} isInvalid={Boolean(fieldErrors.shortDescription)} onChange={(event) => setField('shortDescription', event.target.value)} placeholder="A concise line for catalogue cards." /><Form.Control.Feedback type="invalid">{fieldErrors.shortDescription}</Form.Control.Feedback></Form.Group>
              <Form.Group controlId="product-description" className="span-2"><Form.Label>Full story</Form.Label><Form.Control as="textarea" rows={4} maxLength={4000} value={draft.description} isInvalid={Boolean(fieldErrors.description)} onChange={(event) => setField('description', event.target.value)} placeholder="Materials, finish, dimensions and the story behind this piece…" /><Form.Control.Feedback type="invalid">{fieldErrors.description}</Form.Control.Feedback></Form.Group>
            </div>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>02</span><div><h3>Gallery</h3><p>Lead with a clear, beautifully lit image.</p></div></div>
            <div className="product-form-section__body product-gallery-editor">
            <div className="product-image-grid">
              {draft.images.map((image, index) => {
                const key = imageKey(image) || `${image.url}-${index}`;
                const broken = failedImageKeys.has(key);
                return (
                  <div className={`product-image-tile ${broken ? 'is-broken' : ''}`} key={key}>
                    <div className="product-image-tile__visual">
                      <SmartImage
                        src={image.url}
                        alt={image.alt || ''}
                        fallbackLabel="Image unavailable"
                        onLoad={() => markImageLoaded(image)}
                        onError={() => markImageFailed(image)}
                      />
                      <button
                        type="button"
                        className="product-image-tile__remove"
                        disabled={busy}
                        onClick={() => removeImage(index)}
                        aria-label={`Remove image ${index + 1}`}
                      ><Icon name="close" size={15}/></button>
                      {index === 0
                        ? <span className="product-image-tile__cover">Cover</span>
                        : (
                          <button
                            type="button"
                             className="product-image-tile__make-cover"
                             disabled={busy}
                             onClick={() => moveImage(index, 0)}
                             aria-label={`Make image ${index + 1} the product cover`}
                           >Make cover</button>
                        )}
                      {broken && <span className="product-image-tile__broken">Broken URL</span>}
                    </div>
                    <div className="product-image-tile__details">
                      <div className="product-image-tile__order" aria-label={`Gallery position ${index + 1} of ${draft.images.length}`}>
                        <button type="button" disabled={busy || index === 0} onClick={() => moveImage(index, index - 1)} aria-label={`Move image ${index + 1} earlier`}><Icon name="arrow" size={14} className="is-reversed"/></button>
                        <span>{index + 1} / {draft.images.length}</span>
                        <button type="button" disabled={busy || index === draft.images.length - 1} onClick={() => moveImage(index, index + 1)} aria-label={`Move image ${index + 1} later`}><Icon name="arrow" size={14}/></button>
                      </div>
                      <Form.Group controlId={`product-image-alt-${index}`}>
                        <Form.Label>Image description</Form.Label>
                        <Form.Control
                          value={image.alt || ''}
                          maxLength={160}
                          onChange={(event) => updateImage(index, { alt: event.target.value })}
                          placeholder="Describe the product for screen readers"
                        />
                      </Form.Group>
                    </div>
                  </div>
                );
              })}
              <label
                className="product-image-upload"
                htmlFor="product-image-upload"
                aria-disabled={busy || draft.images.length >= MAX_GALLERY_IMAGES}
              >
                <input
                  ref={fileInputRef}
                  id="product-image-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={uploadImages}
                  disabled={busy || draft.images.length >= MAX_GALLERY_IMAGES}
                  aria-label="Upload product images"
                  aria-describedby="product-image-upload-help"
                />
                {uploading ? <Spinner animation="border" size="sm" aria-hidden="true"/> : <Icon name="upload"/>}
                <strong>{uploading ? 'Uploading…' : draft.images.length >= MAX_GALLERY_IMAGES ? 'Gallery full' : 'Upload images'}</strong>
                <small id="product-image-upload-help">JPG, PNG or WebP · up to 8 MB each · {draft.images.length}/{MAX_GALLERY_IMAGES} used</small>
              </label>
            </div>
            {(fieldErrors.images || failedImageKeys.size > 0) && (
              <div className="invalid-feedback d-block" role="alert">
                {fieldErrors.images || 'One or more gallery images could not be loaded. Remove the broken image or add a working URL.'}
              </div>
            )}
            {uploadStatus && <Form.Text className="d-block" role="status" aria-live="polite" aria-atomic="true">{uploadStatus}</Form.Text>}
            <div className="product-image-url">
              <Form.Label className="visually-hidden" htmlFor="product-image-url">Product image URL</Form.Label>
              <Form.Control
                id="product-image-url"
                type="text"
                inputMode="url"
                 maxLength={1000}
                 value={imageUrl}
                 onChange={(event) => {
                   setImageUrl(event.target.value);
                   clearFieldError('imageUrl');
                 }}
                 onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addImageFromUrl(); } }}
                 placeholder="Or paste a Cloudinary image URL"
                 aria-describedby="product-image-url-help"
                 isInvalid={Boolean(fieldErrors.imageUrl || imageUrlFormatError)}
                 disabled={busy || draft.images.length >= MAX_GALLERY_IMAGES}
               />
               <Button type="button" variant="outline-dark" onClick={() => void addImageFromUrl()} disabled={busy || !normalizedImageUrl || draft.images.length >= MAX_GALLERY_IMAGES}>{checkingImageUrl && <Spinner animation="border" size="sm" aria-hidden="true"/>}{checkingImageUrl ? 'Checking…' : 'Verify & add'}</Button>
             </div>
             {(fieldErrors.imageUrl || imageUrlFormatError) && <div className="invalid-feedback d-block" role="alert">{fieldErrors.imageUrl || imageUrlFormatError}</div>}
             <Form.Text id="product-image-url-help">The URL is loaded and verified before it can join the gallery. Use Cloudinary HTTPS or a site-relative path beginning with /.</Form.Text>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>03</span><div><h3>Pricing & inventory</h3><p>Control the selling price and availability.</p></div></div>
            <div className="product-form-section__body">
            <div className="product-form-grid">
              <Form.Group controlId="product-price"><Form.Label>Price (₹)</Form.Label><Form.Control required min="0" max="10000000" step="1" type="number" value={draft.price} isInvalid={Boolean(fieldErrors.price)} onChange={(event) => setField('price', event.target.value)} /><Form.Control.Feedback type="invalid">{fieldErrors.price}</Form.Control.Feedback></Form.Group>
              <Form.Group controlId="product-compare-price"><Form.Label>Compare-at price (₹)</Form.Label><Form.Control min="0" max="10000000" step="1" type="number" value={draft.compareAtPrice} isInvalid={Boolean(fieldErrors.compareAtPrice)} onChange={(event) => setField('compareAtPrice', event.target.value)} placeholder="Optional" /><Form.Control.Feedback type="invalid">{fieldErrors.compareAtPrice}</Form.Control.Feedback></Form.Group>
              <Form.Group controlId="product-inventory"><Form.Label>Inventory</Form.Label><Form.Control min="0" max="1000000" step="1" type="number" value={draft.inventory} isInvalid={Boolean(fieldErrors.inventory)} onChange={(event) => setField('inventory', event.target.value)} placeholder="Blank for unlimited" /><Form.Control.Feedback type="invalid">{fieldErrors.inventory}</Form.Control.Feedback></Form.Group>
              <Form.Group controlId="product-sku"><Form.Label>SKU</Form.Label><Form.Control maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]*" title="Use letters, numbers, dots, dashes, underscores or slashes" value={draft.sku} isInvalid={Boolean(fieldErrors.sku)} onChange={(event) => setField('sku', event.target.value)} placeholder="GNW-PLAQUE-01" /><Form.Control.Feedback type="invalid">{fieldErrors.sku}</Form.Control.Feedback></Form.Group>
              <Form.Group controlId="product-lead-time"><Form.Label>Lead time (days)</Form.Label><Form.Control required min="1" max="60" type="number" value={draft.leadTimeDays} isInvalid={Boolean(fieldErrors.leadTimeDays)} onChange={(event) => setField('leadTimeDays', event.target.value)} /><Form.Control.Feedback type="invalid">{fieldErrors.leadTimeDays}</Form.Control.Feedback></Form.Group>
              <Form.Group controlId="product-sort-order"><Form.Label>Catalogue order</Form.Label><Form.Control min="-10000" max="10000" type="number" value={draft.sortOrder} isInvalid={Boolean(fieldErrors.sortOrder)} onChange={(event) => setField('sortOrder', event.target.value)} /><Form.Control.Feedback type="invalid">{fieldErrors.sortOrder}</Form.Control.Feedback></Form.Group>
            </div>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>04</span><div><h3>Options</h3><p>Make personalized choices easy to understand.</p></div></div>
            <div className="product-form-section__body">
            <div className="product-form-grid">
              <Form.Group controlId="product-tags" className="span-2"><Form.Label>Search tags</Form.Label><Form.Control value={draft.tags} isInvalid={Boolean(fieldErrors.tags)} onChange={(event) => setField('tags', event.target.value)} placeholder="wedding, floral, personalized"/><Form.Control.Feedback type="invalid">{fieldErrors.tags}</Form.Control.Feedback><Form.Text>Separate each tag with a comma.</Form.Text></Form.Group>
              <Form.Group controlId="product-customization" className="span-2"><Form.Label>Customization choices</Form.Label><Form.Control value={draft.customizationOptions} isInvalid={Boolean(fieldErrors.customizationOptions)} onChange={(event) => setField('customizationOptions', event.target.value)} placeholder="Name, Date, Flower palette"/><Form.Control.Feedback type="invalid">{fieldErrors.customizationOptions}</Form.Control.Feedback></Form.Group>
            </div>
            <div className={`variant-list ${fieldErrors.variants ? 'is-invalid' : ''}`}>
              <div className="variant-list__head"><div><h4>Variants</h4><p>Optional sizes, finishes or bundles.</p></div><Button type="button" size="sm" variant="outline-dark" onClick={addVariant} disabled={busy || draft.variants.length >= 100}><Icon name="plus" size={15}/> Add variant</Button></div>
              {draft.variants.map((variant, index) => <div className="variant-row" key={index}>
                <Form.Control required aria-label={`Variant ${index + 1} name`} maxLength={100} value={variant.name} onChange={(event) => updateVariant(index, 'name', event.target.value)} placeholder="Large / Emerald"/>
                <Form.Control aria-label={`Variant ${index + 1} SKU`} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]*" title="Use letters, numbers, dots, dashes, underscores or slashes" value={variant.sku} onChange={(event) => updateVariant(index, 'sku', event.target.value)} placeholder="SKU"/>
                <Form.Control aria-label={`Variant ${index + 1} price`} type="number" min="0" max="10000000" step="1" value={variant.price} onChange={(event) => updateVariant(index, 'price', event.target.value)} placeholder="Price ₹"/>
                <div>
                  <Form.Control aria-label={`Variant ${index + 1} inventory`} type="number" min="0" max="1000000" step="1" value={variant.inventory} onChange={(event) => updateVariant(index, 'inventory', event.target.value)} placeholder="Stock"/>
                  <Form.Check type="switch" id={`variant-${index + 1}-active`} label="Active" checked={variant.active !== false} onChange={(event) => updateVariant(index, 'active', event.target.checked)}/>
                </div>
                <button type="button" onClick={() => setField('variants', draft.variants.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove variant ${index + 1}`}><Icon name="close" size={16}/></button>
              </div>)}
              {!draft.variants.length && <p className="variant-list__empty">One design, one price — no variants added.</p>}
              {fieldErrors.variants && <div className="invalid-feedback d-block">{fieldErrors.variants}</div>}
            </div>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>05</span><div><h3>Publishing</h3><p>Choose how this piece appears in the shop.</p></div></div>
            <div className="product-form-section__body">
            <div className="product-publish-grid">
              <Form.Check type="switch" id="product-active" label={<><strong>Published</strong><small>Visible and available on the storefront</small></>} checked={draft.active} onChange={(event) => setField('active', event.target.checked)}/>
              <Form.Check type="switch" id="product-featured" label={<><strong>Featured piece</strong><small>Give it priority in curated sections</small></>} checked={draft.featured} onChange={(event) => setField('featured', event.target.checked)}/>
              <Form.Check type="switch" id="product-made-order" label={<><strong>Made to order</strong><small>Created after the customer orders</small></>} checked={draft.madeToOrder} onChange={(event) => setField('madeToOrder', event.target.checked)}/>
            </div>
            </div>
          </section>

          </fieldset>

          <footer className="product-editor__footer"><Button type="button" variant="outline-dark" onClick={requestClose} disabled={busy}>Cancel</Button><Button type="submit" variant="dark" disabled={busy}>{saving && <Spinner animation="border" size="sm" aria-hidden="true"/>}{saving ? 'Saving piece…' : editing ? 'Save changes' : 'Create product'}</Button></footer>
        </Form>
      </aside>
    </div>
  );
}
