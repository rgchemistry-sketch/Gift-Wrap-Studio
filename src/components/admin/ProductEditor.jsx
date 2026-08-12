import { useEffect, useMemo, useState } from 'react';
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

const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const makeSlug = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const numericOrNull = (value) => value === '' || value == null ? null : Number(value);

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
  const [draft, setDraft] = useState(() => toDraft(product));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const editing = Boolean(product);

  useEffect(() => { setDraft(toDraft(product)); setSlugTouched(Boolean(product)); }, [product]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => event.key === 'Escape' && onClose();
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  const title = editing ? 'Edit studio piece' : 'Create a new piece';
  const completion = useMemo(() => {
    const fields = [draft.name, draft.category, draft.shortDescription, draft.price, draft.images.length];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [draft]);

  const setField = (name, value) => setDraft((current) => ({ ...current, [name]: value }));

  const addImage = (image) => {
    if (!image?.url) return;
    setDraft((current) => ({ ...current, images: [...current.images, image] }));
  };

  const uploadImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose a JPG, PNG or WebP image.'); return; }
    setUploading(true); setError('');
    try {
      const image = await api.uploadImage(file, 'products');
      addImage({ ...image, alt: draft.name || 'Gift N Wrap studio piece' });
    } catch (requestError) {
      setError(requestError.message);
    } finally { setUploading(false); }
  };

  const addVariant = () => setDraft((current) => ({
    ...current,
    variants: [...current.variants, { name: '', sku: '', price: '', inventory: '', active: true }],
  }));

  const updateVariant = (index, name, value) => setDraft((current) => ({
    ...current,
    variants: current.variants.map((variant, itemIndex) => itemIndex === index ? { ...variant, [name]: value } : variant),
  }));

  const submit = async (event) => {
    event.preventDefault();
    if (!draft.images.length) { setError('Add at least one product image before saving.'); return; }
    setSaving(true); setError('');
    const payload = {
      name: draft.name.trim(),
      slug: makeSlug(draft.slug || draft.name),
      category: draft.category,
      shortDescription: draft.shortDescription.trim(),
      description: draft.description.trim(),
      price: Number(draft.price),
      compareAtPrice: numericOrNull(draft.compareAtPrice),
      inventory: numericOrNull(draft.inventory),
      sku: draft.sku.trim(),
      leadTimeDays: Number(draft.leadTimeDays),
      sortOrder: Number(draft.sortOrder),
      images: draft.images,
      tags: splitList(draft.tags),
      customizationOptions: splitList(draft.customizationOptions),
      variants: draft.variants.map((variant) => ({
        ...variant,
        name: variant.name.trim(),
        sku: variant.sku.trim(),
        price: numericOrNull(variant.price),
        inventory: numericOrNull(variant.inventory),
      })).filter((variant) => variant.name),
      active: draft.active,
      featured: draft.featured,
      madeToOrder: draft.madeToOrder,
    };
    try {
      const result = editing
        ? await api.updateAdminProduct(product.id || product._id, payload)
        : await api.createAdminProduct(payload);
      onSaved(result.product || result.data || result);
    } catch (requestError) {
      setError(requestError.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="product-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="product-editor" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
        <header className="product-editor__header">
          <div>
            <p className="eyebrow">Catalogue atelier</p>
            <h2 id="product-editor-title">{title}</h2>
            <small>{completion}% of essential product details complete</small>
          </div>
          <button type="button" className="product-editor__close" onClick={onClose} aria-label="Close product editor"><Icon name="close" /></button>
        </header>
        <div className="product-editor__progress"><span style={{ width: `${completion}%` }} /></div>

        <Form className="product-editor__form" onSubmit={submit}>
          {error && <Alert variant="danger" className="soft-alert">{error}</Alert>}

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>01</span><div><h3>Identity</h3><p>The details customers see first.</p></div></div>
            <div className="product-form-grid">
              <Form.Group controlId="product-name" className="span-2"><Form.Label>Product name</Form.Label><Form.Control required maxLength={140} value={draft.name} onChange={(event) => { const name = event.target.value; setDraft((current) => ({ ...current, name, slug: !editing && !slugTouched ? makeSlug(name) : current.slug })); }} placeholder="Pressed flower name plaque" /></Form.Group>
              <Form.Group controlId="product-slug"><Form.Label>URL handle</Form.Label><Form.Control required value={draft.slug} onChange={(event) => { setSlugTouched(true); setField('slug', makeSlug(event.target.value)); }} placeholder="pressed-flower-name-plaque" /></Form.Group>
              <Form.Group controlId="product-category"><Form.Label>Collection</Form.Label><Form.Select value={draft.category} onChange={(event) => setField('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</Form.Select></Form.Group>
              <Form.Group controlId="product-short-description" className="span-2"><Form.Label>Short description</Form.Label><Form.Control required maxLength={240} value={draft.shortDescription} onChange={(event) => setField('shortDescription', event.target.value)} placeholder="A concise line for catalogue cards." /></Form.Group>
              <Form.Group controlId="product-description" className="span-2"><Form.Label>Full story</Form.Label><Form.Control as="textarea" rows={4} maxLength={4000} value={draft.description} onChange={(event) => setField('description', event.target.value)} placeholder="Materials, finish, dimensions and the story behind this piece…" /></Form.Group>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>02</span><div><h3>Gallery</h3><p>Lead with a clear, beautifully lit image.</p></div></div>
            <div className="product-image-grid">
              {draft.images.map((image, index) => <div className="product-image-tile" key={`${image.url}-${index}`}><SmartImage src={image.url} alt={image.alt || ''} fallbackLabel="Product image"/><button type="button" onClick={() => setField('images', draft.images.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove image ${index + 1}`}><Icon name="close" size={15}/></button>{index === 0 && <span>Cover</span>}</div>)}
              <label className="product-image-upload"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} disabled={uploading}/>{uploading ? <Spinner animation="border" size="sm"/> : <Icon name="upload"/>}<strong>{uploading ? 'Uploading…' : 'Upload image'}</strong><small>JPG, PNG or WebP · up to 8 MB</small></label>
            </div>
            <div className="product-image-url"><Form.Control type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="Or paste an image URL"/><Button type="button" variant="outline-dark" onClick={() => { addImage({ url: imageUrl.trim(), alt: draft.name }); setImageUrl(''); }} disabled={!imageUrl.trim()}>Add URL</Button></div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>03</span><div><h3>Pricing & inventory</h3><p>Control the selling price and availability.</p></div></div>
            <div className="product-form-grid">
              <Form.Group controlId="product-price"><Form.Label>Price (₹)</Form.Label><Form.Control required min="0" step="1" type="number" value={draft.price} onChange={(event) => setField('price', event.target.value)} /></Form.Group>
              <Form.Group controlId="product-compare-price"><Form.Label>Compare-at price (₹)</Form.Label><Form.Control min="0" step="1" type="number" value={draft.compareAtPrice} onChange={(event) => setField('compareAtPrice', event.target.value)} placeholder="Optional" /></Form.Group>
              <Form.Group controlId="product-inventory"><Form.Label>Inventory</Form.Label><Form.Control min="0" step="1" type="number" value={draft.inventory} onChange={(event) => setField('inventory', event.target.value)} placeholder="Blank for unlimited" /></Form.Group>
              <Form.Group controlId="product-sku"><Form.Label>SKU</Form.Label><Form.Control value={draft.sku} onChange={(event) => setField('sku', event.target.value)} placeholder="GNW-PLAQUE-01" /></Form.Group>
              <Form.Group controlId="product-lead-time"><Form.Label>Lead time (days)</Form.Label><Form.Control required min="1" max="60" type="number" value={draft.leadTimeDays} onChange={(event) => setField('leadTimeDays', event.target.value)} /></Form.Group>
              <Form.Group controlId="product-sort-order"><Form.Label>Catalogue order</Form.Label><Form.Control min="0" type="number" value={draft.sortOrder} onChange={(event) => setField('sortOrder', event.target.value)} /></Form.Group>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section__intro"><span>04</span><div><h3>Options</h3><p>Make personalized choices easy to understand.</p></div></div>
            <div className="product-form-grid">
              <Form.Group controlId="product-tags" className="span-2"><Form.Label>Search tags</Form.Label><Form.Control value={draft.tags} onChange={(event) => setField('tags', event.target.value)} placeholder="wedding, floral, personalized"/><Form.Text>Separate each tag with a comma.</Form.Text></Form.Group>
              <Form.Group controlId="product-customization" className="span-2"><Form.Label>Customization choices</Form.Label><Form.Control value={draft.customizationOptions} onChange={(event) => setField('customizationOptions', event.target.value)} placeholder="Name, Date, Flower palette"/></Form.Group>
            </div>
            <div className="variant-list">
              <div className="variant-list__head"><div><h4>Variants</h4><p>Optional sizes, finishes or bundles.</p></div><Button type="button" size="sm" variant="outline-dark" onClick={addVariant}><Icon name="plus" size={15}/> Add variant</Button></div>
              {draft.variants.map((variant, index) => <div className="variant-row" key={index}>
                <Form.Control aria-label={`Variant ${index + 1} name`} value={variant.name} onChange={(event) => updateVariant(index, 'name', event.target.value)} placeholder="Large / Emerald"/>
                <Form.Control aria-label={`Variant ${index + 1} SKU`} value={variant.sku} onChange={(event) => updateVariant(index, 'sku', event.target.value)} placeholder="SKU"/>
                <Form.Control aria-label={`Variant ${index + 1} price`} type="number" min="0" value={variant.price} onChange={(event) => updateVariant(index, 'price', event.target.value)} placeholder="Price ₹"/>
                <Form.Control aria-label={`Variant ${index + 1} inventory`} type="number" min="0" value={variant.inventory} onChange={(event) => updateVariant(index, 'inventory', event.target.value)} placeholder="Stock"/>
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

          <footer className="product-editor__footer"><Button type="button" variant="outline-dark" onClick={onClose}>Cancel</Button><Button type="submit" variant="dark" disabled={saving || uploading}>{saving && <Spinner animation="border" size="sm"/>}{saving ? 'Saving piece…' : editing ? 'Save changes' : 'Create product'}</Button></footer>
        </Form>
      </aside>
    </div>
  );
}
