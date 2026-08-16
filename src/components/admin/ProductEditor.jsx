import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../Icon';
import SmartImage from '../SmartImage';
import { api } from '../../api/client';

const emptyProduct = {
  name: '',
  slug: '',
  category: 'Personalized gifts',
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

const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const makeSlug = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const numericOrNull = (value) => value === '' || value == null ? null : Number(value);

function normalizeImageUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  if (candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/\\')) {
    return candidate;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'res.cloudinary.com'
      ? url.href
      : '';
  } catch {
    return '';
  }
}

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
    variants: Array.isArray(product.variants) ? product.variants : [],
    active: product.active ?? product.inStock ?? true,
  };
}

export default function ProductEditor({ product, onClose, onSaved }) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const fileInputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const pendingUploadIdsRef = useRef(new Set());
  const pendingRetirementIdsRef = useRef(new Set());
  const mountedRef = useRef(true);
  const [initialDraft, setInitialDraft] = useState(() => toDraft(product));
  const [draft, setDraft] = useState(() => toDraft(product));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cleaningUploads, setCleaningUploads] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const editing = Boolean(product);
  const busy = saving || uploading || cleaningUploads;
  const normalizedImageUrl = useMemo(() => normalizeImageUrl(imageUrl), [imageUrl]);
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraft) || Boolean(imageUrl.trim()),
    [draft, imageUrl, initialDraft],
  );

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
    setInitialDraft(nextDraft);
    setDraft(nextDraft);
    setImageUrl('');
    setError('');
    setUploadStatus('');
    setSlugTouched(Boolean(product));
  }, [product]);

  useEffect(() => {
    mountedRef.current = true;
    const pendingUploadIds = pendingUploadIdsRef.current;
    const pendingRetirementIds = pendingRetirementIdsRef.current;
    return () => {
      mountedRef.current = false;
      for (const publicId of new Set([...pendingUploadIds, ...pendingRetirementIds])) {
        void api.deleteUploadedAsset(publicId).catch(() => {});
      }
    };
  }, []);

  const requestClose = useCallback(async () => {
    if (busy) {
      setError(uploading
        ? 'Wait for the current image upload to finish before closing the editor.'
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
    onClose();
  }, [busy, cleaningUploads, cleanupUploadedAssets, isDirty, onClose, uploading]);

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

  const title = editing ? 'Edit studio piece' : 'Create a new piece';
  const completion = useMemo(() => {
    const fields = [draft.name, draft.category, draft.shortDescription, draft.price, draft.images.length];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [draft]);

  const setField = (name, value) => setDraft((current) => ({ ...current, [name]: value }));

  const addImage = (image) => {
    if (!image?.url) return;
    setDraft((current) => {
      if (current.images.length >= MAX_GALLERY_IMAGES) return current;
      if (current.images.some((item) => item.url === image.url)) return current;
      return { ...current, images: [...current.images, image] };
    });
  };

  const removeImage = async (index) => {
    if (busy) return;
    const image = draft.images[index];
    if (!image) return;
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
      setUploadStatus('No images were uploaded.');
      return;
    }

    setUploading(true);
    setError('');
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
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  };

  const addImageFromUrl = () => {
    if (draft.images.length >= MAX_GALLERY_IMAGES) {
      setError(`A product can have up to ${MAX_GALLERY_IMAGES} images. Remove one before adding another.`);
      return;
    }
    if (!normalizedImageUrl) {
      setError('Enter a Cloudinary HTTPS image URL or a site-relative path beginning with /.');
      return;
    }
    if (draft.images.some((image) => image.url === normalizedImageUrl)) {
      setError('That image is already in the gallery.');
      return;
    }
    addImage({ url: normalizedImageUrl, alt: draft.name || 'Gift N Wrap studio piece' });
    setImageUrl('');
    setError('');
    setUploadStatus('Image URL added to the gallery.');
  };

  const addVariant = () => setDraft((current) => current.variants.length >= 100 ? current : ({
    ...current,
    variants: [...current.variants, { name: '', sku: '', price: '', inventory: '', active: true }],
  }));

  const updateVariant = (index, name, value) => setDraft((current) => ({
    ...current,
    variants: current.variants.map((variant, itemIndex) => itemIndex === index ? { ...variant, [name]: value } : variant),
  }));

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!draft.images.length) { setError('Add at least one product image before saving.'); return; }
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

    if (productName.length < 2 || shortDescription.length < 10) {
      setError('Use at least 2 characters for the product name and 10 for the short description.');
      return;
    }
    if (compareAtPrice != null && compareAtPrice < sellingPrice) {
      setError('Compare-at price must be at least the selling price.');
      return;
    }
    if (tags.length > 30 || tags.some((tag) => tag.length > 50)) {
      setError('Use up to 30 search tags, with no more than 50 characters in each tag.');
      return;
    }
    if (customizationOptions.length > 30 || customizationOptions.some((option) => option.length > 100)) {
      setError('Use up to 30 customization choices, with no more than 100 characters in each choice.');
      return;
    }
    if (variants.some((variant) => !variant.name)) {
      setError('Name each variant, or remove any variant row you do not want to save.');
      return;
    }
    if (variants.length > 100) {
      setError('A product can have up to 100 variants.');
      return;
    }
    if (new Set(skus).size !== skus.length) {
      setError('Product and variant SKUs must be unique.');
      return;
    }
    setSaving(true); setError('');
    const payload = {
      name: productName,
      slug: makeSlug(draft.slug || draft.name),
      category: draft.category,
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
      onSaved(savedProduct, cleanupWarning);
    } catch (requestError) {
      if (mountedRef.current) setError(requestError.message);
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

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>01</span><div><h3>Identity</h3><p>The details customers see first.</p></div></div>
            <div className="product-form-grid">
              <Form.Group controlId="product-name" className="span-2"><Form.Label>Product name</Form.Label><Form.Control required minLength={2} maxLength={140} value={draft.name} onChange={(event) => { const name = event.target.value; setDraft((current) => ({ ...current, name, slug: !editing && !slugTouched ? makeSlug(name) : current.slug })); }} placeholder="Pressed flower name plaque" /></Form.Group>
              <Form.Group controlId="product-slug"><Form.Label>URL handle</Form.Label><Form.Control required maxLength={160} value={draft.slug} onChange={(event) => { setSlugTouched(true); setField('slug', makeSlug(event.target.value)); }} placeholder="pressed-flower-name-plaque" /></Form.Group>
              <Form.Group controlId="product-category"><Form.Label>Collection</Form.Label><Form.Select value={draft.category} onChange={(event) => setField('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</Form.Select></Form.Group>
              <Form.Group controlId="product-short-description" className="span-2"><Form.Label>Short description</Form.Label><Form.Control required minLength={10} maxLength={240} value={draft.shortDescription} onChange={(event) => setField('shortDescription', event.target.value)} placeholder="A concise line for catalogue cards." /></Form.Group>
              <Form.Group controlId="product-description" className="span-2"><Form.Label>Full story</Form.Label><Form.Control as="textarea" rows={4} maxLength={4000} value={draft.description} onChange={(event) => setField('description', event.target.value)} placeholder="Materials, finish, dimensions and the story behind this piece…" /></Form.Group>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>02</span><div><h3>Gallery</h3><p>Lead with a clear, beautifully lit image.</p></div></div>
            <div className="product-image-grid">
              {draft.images.map((image, index) => <div className="product-image-tile" key={`${image.url}-${index}`}><SmartImage src={image.url} alt={image.alt || ''} fallbackLabel="Product image"/><button type="button" disabled={busy} onClick={() => removeImage(index)} aria-label={`Remove image ${index + 1}`}><Icon name="close" size={15}/></button>{index === 0 && <span>Cover</span>}</div>)}
              <label
                className="product-image-upload"
                htmlFor="product-image-upload"
                role="button"
                tabIndex={busy || draft.images.length >= MAX_GALLERY_IMAGES ? -1 : 0}
                aria-disabled={busy || draft.images.length >= MAX_GALLERY_IMAGES}
                onKeyDown={(event) => {
                  if (!busy && draft.images.length < MAX_GALLERY_IMAGES && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  id="product-image-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  tabIndex={-1}
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
            {uploadStatus && <Form.Text className="d-block" role="status" aria-live="polite" aria-atomic="true">{uploadStatus}</Form.Text>}
            <div className="product-image-url">
              <Form.Label className="visually-hidden" htmlFor="product-image-url">Product image URL</Form.Label>
              <Form.Control
                id="product-image-url"
                type="text"
                inputMode="url"
                maxLength={1000}
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addImageFromUrl(); } }}
                placeholder="Or paste a Cloudinary image URL"
                aria-describedby="product-image-url-help"
                isInvalid={Boolean(imageUrl.trim()) && !normalizedImageUrl}
                disabled={busy || draft.images.length >= MAX_GALLERY_IMAGES}
              />
              <Button type="button" variant="outline-dark" onClick={addImageFromUrl} disabled={busy || !normalizedImageUrl || draft.images.length >= MAX_GALLERY_IMAGES}>Add URL</Button>
            </div>
            <Form.Text id="product-image-url-help">Use a Cloudinary HTTPS URL or a site-relative path beginning with /.</Form.Text>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>03</span><div><h3>Pricing & inventory</h3><p>Control the selling price and availability.</p></div></div>
            <div className="product-form-grid">
              <Form.Group controlId="product-price"><Form.Label>Price (₹)</Form.Label><Form.Control required min="0" max="10000000" step="1" type="number" value={draft.price} onChange={(event) => setField('price', event.target.value)} /></Form.Group>
              <Form.Group controlId="product-compare-price"><Form.Label>Compare-at price (₹)</Form.Label><Form.Control min="0" max="10000000" step="1" type="number" value={draft.compareAtPrice} onChange={(event) => setField('compareAtPrice', event.target.value)} placeholder="Optional" /></Form.Group>
              <Form.Group controlId="product-inventory"><Form.Label>Inventory</Form.Label><Form.Control min="0" max="1000000" step="1" type="number" value={draft.inventory} onChange={(event) => setField('inventory', event.target.value)} placeholder="Blank for unlimited" /></Form.Group>
              <Form.Group controlId="product-sku"><Form.Label>SKU</Form.Label><Form.Control maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]*" title="Use letters, numbers, dots, dashes, underscores or slashes" value={draft.sku} onChange={(event) => setField('sku', event.target.value)} placeholder="GNW-PLAQUE-01" /></Form.Group>
              <Form.Group controlId="product-lead-time"><Form.Label>Lead time (days)</Form.Label><Form.Control required min="1" max="60" type="number" value={draft.leadTimeDays} onChange={(event) => setField('leadTimeDays', event.target.value)} /></Form.Group>
              <Form.Group controlId="product-sort-order"><Form.Label>Catalogue order</Form.Label><Form.Control min="-10000" max="10000" type="number" value={draft.sortOrder} onChange={(event) => setField('sortOrder', event.target.value)} /></Form.Group>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>04</span><div><h3>Options</h3><p>Make personalized choices easy to understand.</p></div></div>
            <div className="product-form-grid">
              <Form.Group controlId="product-tags" className="span-2"><Form.Label>Search tags</Form.Label><Form.Control value={draft.tags} onChange={(event) => setField('tags', event.target.value)} placeholder="wedding, floral, personalized"/><Form.Text>Separate each tag with a comma.</Form.Text></Form.Group>
              <Form.Group controlId="product-customization" className="span-2"><Form.Label>Customization choices</Form.Label><Form.Control value={draft.customizationOptions} onChange={(event) => setField('customizationOptions', event.target.value)} placeholder="Name, Date, Flower palette"/></Form.Group>
            </div>
            <div className="variant-list">
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
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>05</span><div><h3>Publishing</h3><p>Choose how this piece appears in the shop.</p></div></div>
            <div className="product-publish-grid">
              <Form.Check type="switch" id="product-active" label={<><strong>Published</strong><small>Visible and available on the storefront</small></>} checked={draft.active} onChange={(event) => setField('active', event.target.checked)}/>
              <Form.Check type="switch" id="product-featured" label={<><strong>Featured piece</strong><small>Give it priority in curated sections</small></>} checked={draft.featured} onChange={(event) => setField('featured', event.target.checked)}/>
              <Form.Check type="switch" id="product-made-order" label={<><strong>Made to order</strong><small>Created after the customer orders</small></>} checked={draft.madeToOrder} onChange={(event) => setField('madeToOrder', event.target.checked)}/>
            </div>
          </section>

          <footer className="product-editor__footer"><Button type="button" variant="outline-dark" onClick={requestClose} disabled={busy}>Cancel</Button><Button type="submit" variant="dark" disabled={busy}>{saving && <Spinner animation="border" size="sm" aria-hidden="true"/>}{saving ? 'Saving piece…' : editing ? 'Save changes' : 'Create product'}</Button></footer>
        </Form>
      </aside>
    </div>
  );
}
