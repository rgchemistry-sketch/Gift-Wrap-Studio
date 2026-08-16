import { useMemo, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Icon from '../Icon';
import SmartImage from '../SmartImage';
import { api } from '../../api/client';
import { formatCurrency, normalizeProduct } from '../../data/catalog';
import AdminSectionState from './AdminSectionState';
import ProductEditor from './ProductEditor';

export default function ProductManager({ products: initialProducts = [], preview = false, notify, onRefresh }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('current');
  const [editorProduct, setEditorProduct] = useState(undefined);
  const [editorOpen, setEditorOpen] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const products = useMemo(() => Array.isArray(initialProducts) ? initialProducts : [], [initialProducts]);

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((raw) => {
      const product = normalizeProduct(raw);
      const archived = Boolean(raw.archivedAt);
      const active = !archived && (raw.active ?? product.inStock);
      const matchesStatus = status === 'current'
        ? !archived
        : status === 'published'
          ? active
          : status === 'draft'
            ? !active && !archived
            : archived;
      const matchesQuery = !needle || `${product.title} ${product.category} ${raw.sku || ''} ${product.slug}`.toLowerCase().includes(needle);
      return matchesStatus && matchesQuery;
    });
  }, [products, query, status]);

  const openCreate = () => { setEditorProduct(undefined); setEditorOpen(true); };
  const openEdit = (product) => { setEditorProduct(product); setEditorOpen(true); };

  const copyProductLink = async (slug) => {
    const url = new URL(`/product/${slug}`, window.location.origin).href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      notify('Product link copied.');
    } catch {
      notify('The product link could not be copied. Open it and copy the address from your browser.', 'error');
    }
  };

  const togglePublished = async (raw) => {
    if (raw.archivedAt) return;
    const id = raw.id || raw._id;
    const nextActive = !(raw.active ?? normalizeProduct(raw).inStock);
    setWorkingId(id);
    try {
      await api.updateAdminProduct(id, { active: nextActive });
      notify(nextActive ? 'Product published to the storefront.' : 'Product moved to draft.');
      await onRefresh();
    } catch (requestError) { notify(requestError.message, 'error'); }
    finally { setWorkingId(''); }
  };

  const restoreProduct = async (raw) => {
    const id = raw.id || raw._id;
    setWorkingId(id);
    try {
      await api.updateAdminProduct(id, { active: true });
      notify('Product restored and published to the storefront.');
      await onRefresh();
    } catch (requestError) { notify(requestError.message, 'error'); }
    finally { setWorkingId(''); }
  };

  const archiveProduct = async (raw) => {
    const product = normalizeProduct(raw);
    if (!window.confirm(`Archive “${product.title}”? It will be removed from the live catalogue.`)) return;
    const id = raw.id || raw._id;
    setWorkingId(id);
    try {
      await api.archiveAdminProduct(id);
      notify('Product archived and removed from the live catalogue.');
      await onRefresh();
    } catch (requestError) { notify(requestError.message, 'error'); }
    finally { setWorkingId(''); }
  };

  return <>
    <div className="admin-section-head admin-catalogue-head">
      <div><p className="eyebrow">Catalogue atelier</p><h2>Products</h2><p className="admin-section-copy">Create, price and publish every piece from one workspace.</p></div>
      <Button type="button" variant="dark" onClick={openCreate} disabled={preview}><Icon name="plus" size={17}/> New product</Button>
    </div>
    {preview && <Alert variant="warning" className="soft-alert">Catalogue controls are unavailable while the studio is showing preview data.</Alert>}
    <div className="catalogue-toolbar">
      <div className="admin-search"><Icon name="search"/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, collection or SKU" aria-label="Search products"/></div>
      <div className="catalogue-toolbar__status" role="group" aria-label="Filter products by publishing status"><button type="button" className={status === 'current' ? 'is-active' : ''} aria-pressed={status === 'current'} onClick={() => setStatus('current')}>Current <span>{products.filter((product) => !product.archivedAt).length}</span></button><button type="button" className={status === 'published' ? 'is-active' : ''} aria-pressed={status === 'published'} onClick={() => setStatus('published')}>Published <span>{products.filter((product) => !product.archivedAt && (product.active ?? normalizeProduct(product).inStock)).length}</span></button><button type="button" className={status === 'draft' ? 'is-active' : ''} aria-pressed={status === 'draft'} onClick={() => setStatus('draft')}>Drafts <span>{products.filter((product) => !product.archivedAt && !(product.active ?? normalizeProduct(product).inStock)).length}</span></button><button type="button" className={status === 'archived' ? 'is-active' : ''} aria-pressed={status === 'archived'} onClick={() => setStatus('archived')}>Archived <span>{products.filter((product) => product.archivedAt).length}</span></button></div>
    </div>
    {visibleProducts.length ? <div className="admin-product-grid admin-product-grid--editable">{visibleProducts.map((raw) => {
      const product = normalizeProduct(raw);
      const archived = Boolean(raw.archivedAt);
      const active = !archived && (raw.active ?? product.inStock);
      const stock = raw.inventory ?? raw.stock;
      const id = raw.id || raw._id || product.id;
      return <article key={id}>
        <div className="admin-product-card__image"><SmartImage src={product.image} alt="" fallbackLabel={product.category}/>{raw.featured && <span className="admin-product-card__feature"><Icon name="spark" size={12}/> Featured</span>}</div>
        <div className="admin-product-card__body">
          <div className="admin-product-card__meta"><span className={archived ? 'is-archived' : active ? 'in-stock' : 'out-stock'}>{archived ? 'Archived' : active ? 'Published' : 'Draft'}</span><small>{raw.sku || 'No SKU'}</small></div>
          <h3>{product.title}</h3>
          <p>{product.category}</p>
          <div className="admin-product-card__price"><strong>{formatCurrency(product.price)}</strong>{product.compareAt && <del>{formatCurrency(product.compareAt)}</del>}<span className={stock != null && stock <= 3 ? 'is-low' : ''}>{stock == null ? 'Made to order' : `${stock} in stock`}</span></div>
          <div className="admin-product-card__permalink">
            <div><span>Permalink</span><code title={`/product/${product.slug}`}>/product/{product.slug}</code></div>
            <div>
              {active
                ? <a href={`/product/${product.slug}`} target="_blank" rel="noreferrer" aria-label={`Open ${product.title} on the storefront`}>Open <Icon name="arrow" size={13}/></a>
                : <span className="admin-product-card__not-live">Not live</span>}
              <button type="button" onClick={() => void copyProductLink(product.slug)} aria-label={`Copy link for ${product.title}`}>Copy</button>
            </div>
          </div>
          <div className="admin-product-card__actions"><Button type="button" variant="outline-dark" size="sm" onClick={() => openEdit(raw)} disabled={preview || workingId === id}>Edit</Button>{archived?<button type="button" className="plain-link" disabled={preview || workingId === id} onClick={() => restoreProduct(raw)}>Restore & publish</button>:<><button type="button" className="plain-link" disabled={preview || workingId === id} onClick={() => togglePublished(raw)}>{active ? 'Unpublish' : 'Publish'}</button><button type="button" className="plain-link is-danger" disabled={preview || workingId === id} onClick={() => archiveProduct(raw)}>Archive</button></>}</div>
        </div>
      </article>;
    })}</div> : <AdminSectionState title="No pieces found" message={query || status !== 'current' ? 'Try another search or catalogue status.' : 'Create your first piece to begin the studio catalogue.'} actionLabel={!preview && !query && status === 'current' ? 'Create product' : undefined} onAction={!preview ? openCreate : undefined}/>}
    {editorOpen && (
      <ProductEditor
        product={editorProduct}
        onClose={() => setEditorOpen(false)}
        onSaved={async (_savedProduct, cleanupWarning) => {
          setEditorOpen(false);
          notify(
            cleanupWarning || (editorProduct
              ? 'Product changes saved.'
              : 'New product created and ready in the catalogue.'),
            cleanupWarning ? 'error' : 'success',
          );
          await onRefresh();
        }}
      />
    )}
  </>;
}
