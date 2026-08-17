import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import Icon from '../Icon';
import SmartImage from '../SmartImage';
import { api } from '../../api/client';
import { formatCurrency, normalizeProduct } from '../../data/catalog';
import { optimizeCloudinaryImage } from '../../utils/cloudinary-image';
import AdminSectionState from './AdminSectionState';

const importProductEditor = () => import('./ProductEditor');
const ProductEditor = lazy(importProductEditor);
const productStatuses = [
  ['current', 'Current'],
  ['published', 'Published'],
  ['draft', 'Drafts'],
  ['archived', 'Archived'],
];

export default function ProductManager({
  products: initialProducts = [],
  preview = false,
  notify,
  onRefresh,
  query = '',
  status = 'current',
  pagination = {},
  loading = false,
  onQueryChange,
}) {
  const [searchInput, setSearchInput] = useState(query);
  const [editorProduct, setEditorProduct] = useState(undefined);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [archiveCandidate, setArchiveCandidate] = useState(null);
  const [workingIds, setWorkingIds] = useState({});
  const products = useMemo(() => Array.isArray(initialProducts) ? initialProducts : [], [initialProducts]);
  const page = Math.max(1, Number(pagination.page || 1));
  const pages = Math.max(1, Number(pagination.pages || pagination.totalPages || 1));
  const total = Math.max(0, Number(pagination.total || 0));
  const limit = Math.max(1, Number(pagination.limit || products.length || 1));
  const first = total ? (page - 1) * limit + 1 : 0;
  const last = total && products.length ? Math.min(total, first + products.length - 1) : 0;

  useEffect(() => {
    const nextQuery = searchInput.trim();
    if (nextQuery === query || !onQueryChange) return undefined;
    const debounce = window.setTimeout(() => {
      void onQueryChange({ q: nextQuery, page: 1 });
    }, 350);
    return () => window.clearTimeout(debounce);
  }, [onQueryChange, query, searchInput]);

  const openCreate = () => {
    void importProductEditor();
    setEditorProduct(undefined);
    setEditorOpen(true);
  };
  const openEdit = async (raw) => {
    const id = raw.id || raw._id;
    if (!id || editingId) return;
    setEditingId(id);
    try {
      const [result] = await Promise.all([api.getAdminProduct(id), importProductEditor()]);
      setEditorProduct(result?.data || result?.product || result);
      setEditorOpen(true);
    } catch (requestError) {
      notify(requestError.message || 'The full product details could not load.', 'error');
    } finally {
      setEditingId(null);
    }
  };
  const markWorking = (id, working) => setWorkingIds((current) => {
    if (working) return { ...current, [id]: true };
    const next = { ...current };
    delete next[id];
    return next;
  });

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
    if (workingIds[id]) return;
    const nextActive = !(raw.active ?? normalizeProduct(raw).inStock);
    markWorking(id, true);
    try {
      await api.updateAdminProduct(id, { active: nextActive });
      notify(nextActive ? 'Product published to the storefront.' : 'Product moved to draft.');
      await onRefresh();
    } catch (requestError) { notify(requestError.message, 'error'); }
    finally { markWorking(id, false); }
  };

  const restoreProduct = async (raw) => {
    const id = raw.id || raw._id;
    if (workingIds[id]) return;
    markWorking(id, true);
    try {
      await api.updateAdminProduct(id, { active: true });
      notify('Product restored and published to the storefront.');
      await onRefresh();
    } catch (requestError) { notify(requestError.message, 'error'); }
    finally { markWorking(id, false); }
  };

  const archiveProduct = async (raw) => {
    const id = raw.id || raw._id;
    if (workingIds[id]) return;
    markWorking(id, true);
    try {
      await api.archiveAdminProduct(id);
      notify('Product archived and removed from the live catalogue.');
      setArchiveCandidate(null);
      await onRefresh();
    } catch (requestError) { notify(requestError.message, 'error'); }
    finally { markWorking(id, false); }
  };

  return <>
    <div className="admin-section-head admin-catalogue-head">
      <div><p className="eyebrow">Catalogue atelier</p><h2>Products</h2><p className="admin-section-copy">Create, price and publish every piece from one workspace.</p></div>
      <Button type="button" variant="dark" onClick={openCreate} disabled={preview}><Icon name="plus" size={17}/> New product</Button>
    </div>
    {preview && <Alert variant="warning" className="soft-alert">Catalogue controls are unavailable while the studio is showing preview data.</Alert>}
    <div className="catalogue-toolbar">
      <div className="admin-search"><Icon name="search"/><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search name, collection or SKU" aria-label="Search products" autoComplete="off"/></div>
      <div className="catalogue-toolbar__status" role="group" aria-label="Filter products by publishing status">
        {productStatuses.map(([value, label]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} aria-pressed={status === value} onClick={() => status !== value && onQueryChange?.({ status: value, page: 1 })}>{label}{status === value && <span aria-label={`${total} matching products`}>{total}</span>}</button>)}
      </div>
    </div>
    <div className={`admin-product-results ${loading ? 'is-updating' : ''}`} aria-busy={loading}>
      {loading && <span className="admin-product-results__status" role="status">Updating catalogue…</span>}
      {products.length ? <div className="admin-product-grid admin-product-grid--editable">{products.map((raw) => {
      const product = normalizeProduct(raw);
      const archived = Boolean(raw.archivedAt);
      const active = !archived && (raw.active ?? product.inStock);
      const stock = raw.inventory ?? raw.stock;
      const id = raw.id || raw._id || product.id;
      const isWorking = Boolean(workingIds[id]);
      return <article key={id}>
        <div className="admin-product-card__image"><SmartImage src={optimizeCloudinaryImage(product.image, 720)} alt="" fallbackLabel={product.category} loading="lazy" decoding="async"/>{raw.featured && <span className="admin-product-card__feature"><Icon name="spark" size={12}/> Featured</span>}</div>
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
          <div className="admin-product-card__actions"><Button type="button" variant="outline-dark" size="sm" aria-label={`Edit ${product.title}`} onClick={() => void openEdit(raw)} disabled={preview || isWorking || editingId !== null}>{editingId === id ? 'Opening…' : 'Edit'}</Button>{archived?<button type="button" className="plain-link" aria-label={`Restore and publish ${product.title}`} disabled={preview || isWorking} onClick={() => restoreProduct(raw)}>Restore & publish</button>:<><button type="button" className="plain-link" aria-label={`${active ? 'Unpublish' : 'Publish'} ${product.title}`} disabled={preview || isWorking} onClick={() => togglePublished(raw)}>{active ? 'Unpublish' : 'Publish'}</button><button type="button" className="plain-link is-danger" aria-label={`Archive ${product.title}`} disabled={preview || isWorking} onClick={() => setArchiveCandidate(raw)}>Archive</button></>}</div>
        </div>
      </article>;
      })}</div> : <AdminSectionState title="No pieces found" message={query || status !== 'current' ? 'Try another search or catalogue status.' : 'Create your first piece to begin the studio catalogue.'} actionLabel={!preview && !query && status === 'current' ? 'Create product' : undefined} onAction={!preview ? openCreate : undefined}/>}
      {total > 0 && <footer className="users-pagination admin-collection-pagination admin-product-pagination"><span>Showing {first}–{last} of {total} products</span><div><Button type="button" size="sm" variant="outline-dark" disabled={loading || page <= 1} onClick={() => onQueryChange?.({ page: page - 1 })}>Previous</Button><span>Page {page} of {pages}</span><Button type="button" size="sm" variant="outline-dark" disabled={loading || page >= pages} onClick={() => onQueryChange?.({ page: page + 1 })}>Next</Button></div></footer>}
    </div>
    {editorOpen && <Suspense fallback={<div className="product-editor-backdrop"><aside className="product-editor product-editor--loading"><AdminSectionState loading title="Opening product editor" message="Preparing gallery and publishing tools…"/></aside></div>}>
      <ProductEditor product={editorProduct} onClose={() => setEditorOpen(false)} onSaved={async (_savedProduct, cleanupWarning) => {
        setEditorOpen(false);
        notify(cleanupWarning || (editorProduct ? 'Product changes saved.' : 'New product created and ready in the catalogue.'), cleanupWarning ? 'error' : 'success');
        await onRefresh();
      }}/>
    </Suspense>}
    <Modal
      show={Boolean(archiveCandidate)}
      onHide={() => setArchiveCandidate(null)}
      centered
      className="admin-confirm-modal"
      aria-labelledby="archive-product-title"
    >
      <Modal.Header closeButton>
        <div><p className="eyebrow">Catalogue action</p><Modal.Title id="archive-product-title">Archive this piece?</Modal.Title></div>
      </Modal.Header>
      <Modal.Body>
        <p><strong>{archiveCandidate ? normalizeProduct(archiveCandidate).title : 'This product'}</strong> will leave the live catalogue. You can restore it later from the Archived filter.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="outline-dark" onClick={() => setArchiveCandidate(null)}>Keep product</Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => archiveCandidate && archiveProduct(archiveCandidate)}
          disabled={Boolean(archiveCandidate && workingIds[archiveCandidate.id || archiveCandidate._id])}
        >Archive product</Button>
      </Modal.Footer>
    </Modal>
  </>;
}
