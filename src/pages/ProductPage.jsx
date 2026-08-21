import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import Accordion from 'react-bootstrap/Accordion';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../components/Icon';
import ProductCard from '../components/ProductCard';
import { ProductInquiryPanel } from '../components/StorefrontInquiry';
import SmartImage from '../components/SmartImage';
import StorefrontSelect from '../components/StorefrontSelect';
import { RouteLoader } from '../components/Feedback';
import { api } from '../api/client';
import { formatCurrency } from '../data/catalog';
import { useCatalog } from '../data/useCatalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';
import { focusAndRevealFirstInvalid, swipeDirection, trapDialogFocus } from '../utils/buying-flow';
import { shouldDiscardProductMedia } from '../utils/product-media-lifecycle';
import { resolveStudioContact } from '../utils/studio-contact';
import '../buying-flow.css';

const emptyCustomization = () => ({
  name: '',
  date: '',
  message: '',
  colour: 'Forest & gold',
  finish: 'Gold foil',
  media: null,
});

const colourOptions = [
  ['Forest & gold', '#315446'],
  ['Wine & blush', '#6f263d'],
  ['Ivory & champagne', '#d3b47a'],
  ['Ocean & pearl', '#397985'],
  ['Tell the artist', '#8b7267'],
];

const finishOptions = [
  'Gold foil',
  'Silver foil',
  'Rose gold',
  'No metallic finish',
];

const MediaUpload = forwardRef(function MediaUpload({ onChange, onBusyChange }, ref) {
  const inputRef = useRef(null);
  const selectedFileRef = useRef(null);
  const previewUrlRef = useRef('');
  const uncommittedPublicIdRef = useRef('');
  const uploadGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const { user, requireAuth } = useAuth();
  const busy = status === 'uploading' || status === 'deleting';

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadGenerationRef.current += 1;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const publicId = uncommittedPublicIdRef.current;
      uncommittedPublicIdRef.current = '';
      if (publicId) void api.deleteUploadedAsset(publicId).catch(() => {});
    };
  }, []);

  const resetPicker = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    selectedFileRef.current = null;
    setFile(null);
    setPreview('');
    setError('');
    setStatus('idle');
    if (inputRef.current) inputRef.current.value = '';
    onChange(null);
  }, [onChange]);

  const discardAndReset = useCallback(() => {
    // Invalidate a provider request that may still be resolving for the old
    // account. Its completion path will release the late asset as well.
    uploadGenerationRef.current += 1;
    const publicId = uncommittedPublicIdRef.current;
    uncommittedPublicIdRef.current = '';
    resetPicker();
    if (publicId) void api.deleteUploadedAsset(publicId).catch(() => {});
  }, [resetPicker]);

  useImperativeHandle(ref, () => ({
    commitAndReset() {
      uploadGenerationRef.current += 1;
      uncommittedPublicIdRef.current = '';
      resetPicker();
    },
    discardAndReset,
  }), [discardAndReset, resetPicker]);

  const releaseUncommittedUpload = useCallback(async () => {
    const publicId = uncommittedPublicIdRef.current;
    if (!publicId) return true;
    try {
      await api.deleteUploadedAsset(publicId);
      if (uncommittedPublicIdRef.current === publicId) {
        uncommittedPublicIdRef.current = '';
      }
      return true;
    } catch (deleteError) {
      if (mountedRef.current && uncommittedPublicIdRef.current === publicId) {
        setError(`${deleteError.message} Try removing the photo again.`);
      }
      return false;
    }
  }, []);

  const uploadSelectedFile = async (selectedFile) => {
    if (!mountedRef.current || selectedFileRef.current !== selectedFile) return;
    const uploadGeneration = ++uploadGenerationRef.current;
    setStatus('uploading');
    setError('');
    onChange({ name: selectedFile.name, pending: true });
    try {
      const uploaded = await api.uploadImage(selectedFile, 'orders');
      if (
        !mountedRef.current
        || uploadGeneration !== uploadGenerationRef.current
      ) {
        if (uploaded.publicId) void api.deleteUploadedAsset(uploaded.publicId).catch(() => {});
        return;
      }
      uncommittedPublicIdRef.current = uploaded.publicId;
      setStatus('uploaded');
      onChange({
        name: selectedFile.name,
        url: uploaded.url,
        publicId: uploaded.publicId,
        expiresAt: uploaded.expiresAt || '',
        pending: false,
      });
    } catch (uploadError) {
      if (
        !mountedRef.current
        || uploadGeneration !== uploadGenerationRef.current
      ) return;
      setStatus('local');
      if (uploadError.status === 401) {
        setError('Your session expired. Log in again to upload this preview securely.');
        onChange({ name: selectedFile.name, pending: true });
        requireAuth({
          force: true,
          message: 'Your session expired. Log in again to upload your customization photo; the preview will stay here.',
          onAuthenticated: () => uploadSelectedFile(selectedFile),
          onAccountMismatch: () => {
            if (mountedRef.current && selectedFileRef.current === selectedFile) {
              setError('You signed in to a different account. Review the preview, then choose “Try upload again” if you still want to use it.');
            }
          },
        });
        return;
      }
      setError(`${uploadError.message} Your preview is still here; remove it or try again.`);
      onChange({ name: selectedFile.name, pending: true });
    }
  };

  const selectFile = async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    setError('');
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!selectedFile.size) {
      setError('That image is empty. Choose another file.');
      event.target.value = '';
      return;
    }
    if (!allowed.includes(selectedFile.type)) {
      setError('Please choose a JPG, PNG or WebP image.');
      event.target.value = '';
      return;
    }
    if (selectedFile.size > 8 * 1024 * 1024) {
      setError('That file is over 8 MB. Choose a smaller image for a reliable upload.');
      event.target.value = '';
      return;
    }

    const selectionGeneration = uploadGenerationRef.current;
    if (uncommittedPublicIdRef.current) {
      setStatus('deleting');
      setError('');
      const released = await releaseUncommittedUpload();
      if (
        !mountedRef.current
        || selectionGeneration !== uploadGenerationRef.current
      ) {
        event.target.value = '';
        return;
      }
      if (!released) {
        setStatus('uploaded');
        event.target.value = '';
        return;
      }
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const objectUrl = URL.createObjectURL(selectedFile);
    previewUrlRef.current = objectUrl;
    selectedFileRef.current = selectedFile;
    setFile(selectedFile);
    setPreview(objectUrl);
    onChange({ name: selectedFile.name, pending: true });
    if (!user) {
      setStatus('local');
      setError('Preview ready. Log in or create an account to upload it securely.');
      requireAuth({
        message: 'Log in or create an account to upload your customization photo securely. Your preview will stay here.',
        onAuthenticated: () => uploadSelectedFile(selectedFile),
        onAccountMismatch: () => {
          if (mountedRef.current && selectedFileRef.current === selectedFile) {
            setError('Your signed-in account changed. Review the preview, then choose “Try upload again” to continue.');
          }
        },
      });
      return;
    }
    await uploadSelectedFile(selectedFile);
  };

  const remove = async () => {
    if (busy) return;
    const removalGeneration = uploadGenerationRef.current;
    if (uncommittedPublicIdRef.current) {
      setStatus('deleting');
      setError('');
      const released = await releaseUncommittedUpload();
      if (
        !mountedRef.current
        || removalGeneration !== uploadGenerationRef.current
      ) return;
      if (!released) {
        setStatus('uploaded');
        return;
      }
    }
    resetPicker();
  };

  const retryUpload = async () => {
    if (!file || busy) return;
    if (!user) {
      requireAuth({
        message: 'Log in or create an account to securely save your customization image.',
        onAuthenticated: () => uploadSelectedFile(file),
        onAccountMismatch: () => {
          if (mountedRef.current && selectedFileRef.current === file) {
            setError('Your signed-in account changed. Review the preview, then choose “Try upload again” to continue.');
          }
        },
      });
      return;
    }
    await uploadSelectedFile(file);
  };

  const openFilePicker = () => {
    if (busy || !inputRef.current) return;
    inputRef.current.value = '';
    inputRef.current.click();
  };

  return (
    <div className="media-upload">
      <Form.Control ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} id="personalization-photo" disabled={busy} aria-describedby={file ? 'personalization-photo-status' : undefined} />
      {!file ? (
        <label htmlFor="personalization-photo" className="upload-dropzone">
          <span><Icon name="upload" /></span>
          <strong>Add a photograph or reference</strong>
          <small>JPG, PNG or WebP · maximum 8 MB</small>
        </label>
      ) : (
        <div className="upload-preview">
          <img src={preview} alt="Selected customization reference preview" />
          <div>
            <strong>{file.name}</strong>
            <small id="personalization-photo-status" role="status" aria-live="polite">
              {status === 'uploading' && <><Spinner size="sm" /> Uploading securely…</>}
              {status === 'deleting' && <><Spinner size="sm" /> Removing previous upload…</>}
              {status === 'uploaded' && <><Icon name="check" size={14} /> Securely attached</>}
              {status === 'local' && 'Preview ready — secure upload required'}
            </small>
            <div>
              {status === 'local' && <button type="button" onClick={retryUpload} disabled={busy}>{user ? 'Try upload again' : 'Sign in to upload'}</button>}
              <button type="button" onClick={openFilePicker} disabled={busy}>Replace</button>
              <button type="button" onClick={remove} disabled={busy}>Remove</button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="field-message" role="alert">{error}</p>
      )}
    </div>
  );
});

export default function ProductPage() {
  const { slug } = useParams();
  const location = useLocation();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [validated, setValidated] = useState(false);
  const [customization, setCustomization] = useState(emptyCustomization);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaSubmitError, setMediaSubmitError] = useState('');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const mediaUploadRef = useRef(null);
  const purchaseFormRef = useRef(null);
  const lightboxTriggerRef = useRef(null);
  const lightboxRootRef = useRef(null);
  const lightboxDialogRef = useRef(null);
  const mainTouchStartRef = useRef(null);
  const lightboxTouchRef = useRef({ x: null, distance: null, zoom: 1 });
  const { addToCart, wishlist, toggleWishlist, studioSettings, notify } = useShop();
  const { user, sessionOwnerId } = useAuth();
  const currentFormOwner = String(sessionOwnerId || user?.id || '') || 'guest';
  const [formOwner, setFormOwner] = useState('guest');
  const { products: catalog } = useCatalog();
  const contact = resolveStudioContact(studioSettings);
  const gallery = useMemo(
    () => (product?.gallery?.length ? product.gallery : product?.image ? [product.image] : []),
    [product],
  );

  const showAdjacentImage = useCallback((direction) => {
    if (gallery.length < 2) return;
    setSelectedImage((current) => (current + direction + gallery.length) % gallery.length);
    setLightboxZoom(1);
  }, [gallery.length]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxZoom(1);
    window.requestAnimationFrame(() => lightboxTriggerRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const isolatedElements = [];
    let activeBranch = lightboxRootRef.current;
    while (activeBranch?.parentElement) {
      const parent = activeBranch.parentElement;
      [...parent.children].forEach((element) => {
        if (element === activeBranch) return;
        isolatedElements.push({
          element,
          hadAriaHidden: element.hasAttribute('aria-hidden'),
          ariaHidden: element.getAttribute('aria-hidden'),
          hadInert: element.hasAttribute('inert'),
          inert: Boolean(element.inert),
        });
        element.inert = true;
        element.setAttribute('aria-hidden', 'true');
      });
      if (parent === document.body) break;
      activeBranch = parent;
    }
    const onKeyDown = (event) => {
      if (trapDialogFocus(event, lightboxDialogRef.current)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        showAdjacentImage(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showAdjacentImage(-1);
      }
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      isolatedElements.forEach(({
        element,
        hadAriaHidden,
        ariaHidden,
        hadInert,
        inert,
      }) => {
        element.inert = inert;
        if (hadInert) element.setAttribute('inert', '');
        else element.removeAttribute('inert');
        if (hadAriaHidden) element.setAttribute('aria-hidden', ariaHidden);
        else element.removeAttribute('aria-hidden');
      });
    };
  }, [closeLightbox, lightboxOpen, showAdjacentImage]);

  useEffect(() => {
    if (formOwner === currentFormOwner) return;
    if (shouldDiscardProductMedia(formOwner, currentFormOwner)) {
      mediaUploadRef.current?.discardAndReset();
      setQuantity(1);
      setValidated(false);
      setCustomization(emptyCustomization());
      setMediaBusy(false);
      setMediaSubmitError('');
    }
    setFormOwner(currentFormOwner);
  }, [currentFormOwner, formOwner]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setProduct(null);
    // /product/:slug keeps the same component mounted between products, so every
    // per-product choice has to be cleared or it follows the visitor to the next piece.
    setSelectedImage(0);
    setQuantity(1);
    setValidated(false);
    setCustomization(emptyCustomization());
    setMediaSubmitError('');
    api.getProduct(slug)
      .then((result) => {
        if (active) setProduct(result.product);
      })
      .catch((requestError) => {
        if (active) setError({
          message: requestError.message,
          status: requestError.status,
          code: requestError.code,
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadAttempt, slug]);

  useEffect(() => {
    if (product?.title && product.slug === slug) {
      document.title = `${product.title} · Gift N Wrap Studio`;
    }
  }, [product?.slug, product?.title, slug]);

  const related = useMemo(
    () => catalog.filter((item) => item.id !== product?.id && item.category === product?.category).slice(0, 3),
    [catalog, product],
  );

  if (loading || (formOwner !== currentFormOwner && formOwner !== 'guest')) return <RouteLoader />;
  if (error || !product) {
    const notFound = !error || error.status === 404 || error.code === 'NOT_FOUND';
    return (
      <Container className="access-state page-section">
        <div className="access-state__icon"><Icon name="spark" size={30} /></div>
        <p className="eyebrow">{notFound ? 'This piece has wandered' : 'The studio connection slipped'}</p>
        <h1>{notFound ? 'We can’t find that studio piece.' : 'We couldn’t load this piece.'}</h1>
        <p>{error?.message || 'It may have been a one-of-one design or is no longer in the current collection.'}</p>
        <div className="d-flex flex-wrap justify-content-center gap-3">
          {!notFound && <Button type="button" className="button-burgundy" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button>}
          <Button as={Link} to="/shop" variant={notFound ? undefined : 'outline-dark'} className={notFound ? 'button-burgundy' : undefined}>Browse the collection</Button>
        </div>
      </Container>
    );
  }

  const activeImageIndex = Math.min(selectedImage, gallery.length - 1);
  const productUrl = new URL(location.pathname, window.location.origin).href;
  const updateCustomization = (key, value) => {
    if (key === 'media') setMediaSubmitError('');
    setCustomization((current) => ({ ...current, [key]: value }));
  };

  const submit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (product.customizable && !form.checkValidity()) {
      event.stopPropagation();
      setValidated(true);
      notify('Please complete the highlighted personalization detail before adding this piece.', 'error');
      focusAndRevealFirstInvalid(form);
      return;
    }
    if (mediaBusy) {
      setMediaSubmitError('Please wait for the photo upload to finish before adding this piece.');
      notify('Your photo is still uploading. We’ll keep the add button ready for you.', 'info');
      return;
    }
    if (product.customizable && customization.media && (
      customization.media.pending || !customization.media.url || !customization.media.publicId
    )) {
      setMediaSubmitError('Finish the secure photo upload or remove the preview before adding this piece.');
      notify('Finish the secure photo upload or remove the preview before adding this piece.', 'error');
      document.querySelector('.media-upload button, .upload-dropzone')?.focus?.();
      return;
    }
    setValidated(true);
    const safeCustomization = {
      ...customization,
      media: customization.media ? {
        name: customization.media.name,
        url: customization.media.url || '',
        publicId: customization.media.publicId || '',
        expiresAt: customization.media.expiresAt || '',
        pending: Boolean(customization.media.pending),
      } : null,
    };
    addToCart(product, {
      quantity,
      customization: product.customizable ? safeCustomization : {},
      onAdded: () => {
        mediaUploadRef.current?.commitAndReset();
        setMediaSubmitError('');
      },
    });
  };

  const saved = wishlist.includes(product.id);
  const handleMainTouchStart = (event) => {
    mainTouchStartRef.current = event.touches.length === 1 ? event.touches[0].clientX : null;
  };
  const handleMainTouchEnd = (event) => {
    const endX = event.changedTouches?.[0]?.clientX;
    const direction = swipeDirection(mainTouchStartRef.current, endX);
    mainTouchStartRef.current = null;
    if (direction) showAdjacentImage(direction);
  };
  const touchDistance = (touches) => {
    if (touches.length < 2) return null;
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  };
  const handleLightboxTouchStart = (event) => {
    const distance = touchDistance(event.touches);
    lightboxTouchRef.current = {
      x: event.touches.length === 1 ? event.touches[0].clientX : null,
      distance,
      zoom: lightboxZoom,
    };
  };
  const handleLightboxTouchMove = (event) => {
    const start = lightboxTouchRef.current;
    const distance = touchDistance(event.touches);
    if (!distance || !start.distance) return;
    event.preventDefault();
    setLightboxZoom(Math.max(1, Math.min(3, start.zoom * (distance / start.distance))));
  };
  const handleLightboxTouchEnd = (event) => {
    const startX = lightboxTouchRef.current.x;
    const endX = event.changedTouches?.[0]?.clientX;
    lightboxTouchRef.current = { x: null, distance: null, zoom: lightboxZoom };
    if (lightboxZoom <= 1.05) {
      const direction = swipeDirection(startX, endX);
      if (direction) showAdjacentImage(direction);
    }
  };

  return (
    <div className="product-page-shell">
      <section className="product-page page-section">
        <Container fluid="xl">
          <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/shop">Shop</Link><span>/</span><span aria-current="page">{product.title}</span></nav>
          <div className="product-mobile-identity">
            <p className="eyebrow">{product.category}</p>
            <div className="product-mobile-identity__title">
              <h1>{product.title}</h1>
              <button type="button" className={`icon-button ${saved ? 'is-active' : ''}`} onClick={() => toggleWishlist(product.id)} aria-label={saved ? 'Remove from saved pieces' : 'Save this piece'} aria-pressed={saved}><Icon name="heart" /></button>
            </div>
            <div className="product-mobile-identity__meta">
              <p className="product-price">{formatCurrency(product.price)} {product.compareAt && <del>{formatCurrency(product.compareAt)}</del>}</p>
              <span className={product.inStock ? 'in-stock' : 'out-stock'}>{product.inStock ? 'Available to order' : 'Currently unavailable'}</span>
            </div>
            <p className="tax-note">Inclusive of taxes · delivery calculated after address confirmation</p>
          </div>
          <div className="product-detail-grid">
            <div className="product-gallery-column">
              <div className="product-gallery">
                <div className="product-gallery__thumbs" role="group" aria-label="Product image choices">
                  {gallery.map((image, index) => (
                    <button key={`${image}-${index}`} type="button" className={activeImageIndex === index ? 'is-active' : ''} onClick={() => setSelectedImage(index)} aria-label={`Show image ${index + 1}`} aria-pressed={activeImageIndex === index}>
                      <SmartImage src={image} alt="" fallbackLabel={product.category} imageWidth={160} responsiveWidths={[96, 160, 240]} sizes="82px" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
                <div className="product-gallery__main" onTouchStart={handleMainTouchStart} onTouchEnd={handleMainTouchEnd}>
                  <SmartImage src={gallery[activeImageIndex]} alt={`${product.title}, view ${activeImageIndex + 1}`} fallbackLabel={product.title} imageWidth={1200} responsiveWidths={[640, 900, 1200, 1600]} sizes="(max-width: 991px) calc(100vw - 1.5rem), 58vw" loading={activeImageIndex === 0 ? 'eager' : 'lazy'} decoding="async" fetchPriority={activeImageIndex === 0 ? 'high' : 'auto'} />
                  <button ref={lightboxTriggerRef} type="button" className="product-gallery__open" onClick={() => setLightboxOpen(true)} aria-label={`Open enlarged image ${activeImageIndex + 1} of ${gallery.length}`}><Icon name="search" size={18} /><span>View details</span></button>
                  {product.badge && <span className="product-gallery__badge">{product.badge}</span>}
                  <span className="visually-hidden" role="status" aria-live="polite">Image {activeImageIndex + 1} of {gallery.length}</span>
                </div>
              </div>
            </div>
            <div className="product-buy-column">
              <div className="product-buy-panel">
                <p className="eyebrow">{product.category}</p>
                <div className="product-title-row">
                  <h1>{product.title}</h1>
                  <button type="button" className={`icon-button ${saved ? 'is-active' : ''}`} onClick={() => toggleWishlist(product.id)} aria-label={saved ? 'Remove from saved pieces' : 'Save this piece'} aria-pressed={saved}><Icon name="heart" /></button>
                </div>
                <p className="product-price">{formatCurrency(product.price)} {product.compareAt && <del>{formatCurrency(product.compareAt)}</del>}</p>
                <p className="tax-note">Inclusive of taxes · delivery calculated after address confirmation</p>
                <p className="product-description">{product.description}</p>
                <div className="product-status-line">
                  <span className={product.inStock ? 'in-stock' : 'out-stock'}>{product.inStock ? 'Available to order' : 'Currently unavailable'}</span>
                  <span><Icon name="spark" size={15} /> {product.leadTime}</span>
                </div>

                <Form ref={purchaseFormRef} noValidate validated={validated} onSubmit={submit} className="personalization-form">
                  {product.customizable && (
                    <fieldset>
                      <legend><span>01</span> Personalize your piece</legend>
                      <Form.Group className="form-field" controlId="custom-name">
                        <Form.Label>Name or initials</Form.Label>
                        <Form.Control required maxLength={50} value={customization.name} onChange={(event) => updateCustomization('name', event.target.value)} placeholder="e.g. Aarya & Kabir" />
                        <Form.Control.Feedback type="invalid">Please enter the name or initials for your piece.</Form.Control.Feedback>
                      </Form.Group>
                      <Row className="g-3">
                        <Col sm={6}>
                          <Form.Group className="form-field studio-date-field" controlId="custom-date">
                            <Form.Label>Special date <small>optional</small></Form.Label>
                            <Form.Control type="date" value={customization.date} onChange={(event) => updateCustomization('date', event.target.value)} aria-describedby="custom-date-help" />
                            <Form.Text id="custom-date-help">Past commemorative and future occasion dates are both welcome.</Form.Text>
                          </Form.Group>
                        </Col>
                        <Col sm={6}><Form.Group className="form-field" controlId="custom-finish"><Form.Label>Metallic finish</Form.Label><StorefrontSelect id="custom-finish" value={customization.finish} options={finishOptions} onChange={(value) => updateCustomization('finish', value)} ariaLabel="Choose a metallic finish" /></Form.Group></Col>
                      </Row>
                      <Form.Group className="form-field colour-field">
                        <Form.Label id="colour-story-label">Colour story <span>— {customization.colour}</span></Form.Label>
                        <div className="colour-options" role="radiogroup" aria-labelledby="colour-story-label">
                          {colourOptions.map(([name, value]) => (
                            <label key={name} title={name} className={customization.colour === name ? 'is-selected' : ''}>
                              <input type="radio" name="colour" value={name} aria-label={name} checked={customization.colour === name} onChange={(event) => updateCustomization('colour', event.target.value)} />
                              <span style={{ '--swatch': value }} /><small>{name}</small>
                            </label>
                          ))}
                        </div>
                      </Form.Group>
                      <Form.Group className="form-field" controlId="custom-message">
                        <Form.Label>Short message or artist notes <small>optional</small></Form.Label>
                        <Form.Control as="textarea" rows={3} maxLength={180} value={customization.message} onChange={(event) => updateCustomization('message', event.target.value)} placeholder="Tell us the mood, flowers or details you have in mind…" />
                        <div className="character-count character-count--static" aria-live="polite">{customization.message.length}/180</div>
                      </Form.Group>
                      <Form.Group className="form-field">
                        <Form.Label>Photo or inspiration <small>optional</small></Form.Label>
                        {/* Remounting per slug runs the unmount cleanup, which releases any
                            photo uploaded for the previous piece instead of carrying it over. */}
                        <MediaUpload key={slug} ref={mediaUploadRef} onChange={(media) => updateCustomization('media', media)} onBusyChange={setMediaBusy} />
                        {mediaSubmitError && <p className="field-message" role="alert">{mediaSubmitError}</p>}
                      </Form.Group>
                    </fieldset>
                  )}

                  <div className="buy-actions">
                    <div className="quantity-control" role="group" aria-label="Quantity" aria-describedby="product-quantity-hint">
                      <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" disabled={!product.inStock || quantity === 1}><Icon name="minus" size={16} /></button>
                      <span aria-live="polite">{quantity}</span>
                      <button type="button" onClick={() => setQuantity((value) => Math.min(10, value + 1))} aria-label="Increase quantity" disabled={!product.inStock || quantity === 10}><Icon name="plus" size={16} /></button>
                    </div>
                    <Button type="submit" className="button-burgundy flex-grow-1" disabled={!product.inStock || mediaBusy}>{mediaBusy ? 'Securing photo…' : `Add to bag · ${formatCurrency(product.price * quantity)}`}</Button>
                  </div>
                  <p className="quantity-hint" id="product-quantity-hint">Maximum 10 per online request. Need more? <Link to="/corporate-gifts">Start a bulk enquiry</Link>.</p>
                  {product.customizable && <p className="included-note"><Icon name="check" size={14} /> Standard personalization is included in the displayed price.</p>}
                </Form>
              </div>
            </div>
          </div>

          <div className="product-aftercare">
            <ProductInquiryPanel product={product} productUrl={productUrl} contact={contact} />
            <section className="product-aftercare__details" aria-labelledby="product-details-title">
              <p className="eyebrow">Made to be kept</p>
              <h2 id="product-details-title">The thoughtful details.</h2>
              <Accordion flush className="studio-accordion product-accordion">
                <Accordion.Item eventKey="0"><Accordion.Header>What arrives with it</Accordion.Header><Accordion.Body><ul><li>Premium gift packaging</li><li>Protective bubble wrap and corrugated box</li><li>Care instructions and thank-you card</li></ul></Accordion.Body></Accordion.Item>
                <Accordion.Item eventKey="1"><Accordion.Header>Care instructions</Accordion.Header><Accordion.Body>Keep away from prolonged direct sunlight. Clean with a soft microfiber cloth, avoid harsh chemicals, and handle with care to prevent scratches.</Accordion.Body></Accordion.Item>
                <Accordion.Item eventKey="2"><Accordion.Header>Design approval & delivery</Accordion.Header><Accordion.Body>For detailed custom work, the studio confirms your notes and may share a digital concept before production. Delivery is available across India after the handmade processing window shown above.</Accordion.Body></Accordion.Item>
              </Accordion>
            </section>
          </div>
        </Container>
      </section>

      {lightboxOpen && (
        <div ref={lightboxRootRef} className="product-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeLightbox(); }}>
          <section ref={lightboxDialogRef} className="product-lightbox__dialog" role="dialog" aria-modal="true" aria-label={`${product.title} image viewer`} tabIndex={-1}>
            <header className="product-lightbox__header">
              <p><strong>{product.title}</strong><span>Image {activeImageIndex + 1} of {gallery.length}</span></p>
              <div>
                <button type="button" onClick={() => setLightboxZoom((value) => Math.max(1, value - .5))} disabled={lightboxZoom <= 1} aria-label="Zoom out"><Icon name="minus" /></button>
                <span aria-live="polite">{Math.round(lightboxZoom * 100)}%</span>
                <button type="button" onClick={() => setLightboxZoom((value) => Math.min(3, value + .5))} disabled={lightboxZoom >= 3} aria-label="Zoom in"><Icon name="plus" /></button>
                <button type="button" className="product-lightbox__close" onClick={closeLightbox} aria-label="Close image viewer" autoFocus><Icon name="close" /></button>
              </div>
            </header>
            <div
              className="product-lightbox__viewport"
              onTouchStart={handleLightboxTouchStart}
              onTouchMove={handleLightboxTouchMove}
              onTouchEnd={handleLightboxTouchEnd}
            >
              {gallery.length > 1 && <button type="button" className="product-lightbox__previous" onClick={() => showAdjacentImage(-1)} aria-label="Previous image"><Icon name="chevron" /></button>}
              <button type="button" className="product-lightbox__image" onClick={() => setLightboxZoom((value) => (value > 1 ? 1 : 2))} aria-label={lightboxZoom > 1 ? 'Reset image zoom' : 'Zoom image to 200 percent'}>
                <SmartImage src={gallery[activeImageIndex]} alt={`${product.title}, enlarged view ${activeImageIndex + 1}`} fallbackLabel={product.title} imageWidth={1600} responsiveWidths={[900, 1200, 1600]} sizes="100vw" style={{ transform: `scale(${lightboxZoom})` }} />
              </button>
              {gallery.length > 1 && <button type="button" className="product-lightbox__next" onClick={() => showAdjacentImage(1)} aria-label="Next image"><Icon name="chevron" /></button>}
            </div>
            <p className="product-lightbox__hint">Tap to zoom · pinch on touch screens · swipe or use arrow keys to change view</p>
          </section>
        </div>
      )}

      <section className="product-promise">
        <Container fluid="xl"><div className="product-promise__grid"><span><Icon name="shield" /> Multiple quality checks</span><span><Icon name="package" /> Secure gift packaging</span><span><Icon name="truck" /> PAN India delivery</span></div></Container>
      </section>

      {related.length > 0 && (
        <section className="page-section related-section">
          <Container fluid="xl">
            <header className="section-heading"><p className="eyebrow">Pair it beautifully</p><h2>More from this collection.</h2></header>
            <Row className="g-4">{related.map((item, index) => <Col sm={6} lg={4} key={item.id}><ProductCard product={item} index={index} /></Col>)}</Row>
          </Container>
        </section>
      )}

      <div className="mobile-buy-bar">
        <div><small>{product.title}</small><strong>{formatCurrency(product.price * quantity)}</strong></div>
        <Button className="button-burgundy" onClick={() => document.querySelector('.personalization-form')?.requestSubmit()} disabled={!product.inStock || mediaBusy}>{mediaBusy ? 'Uploading…' : product.customizable ? 'Personalize & add' : 'Add to bag'}</Button>
      </div>
    </div>
  );
}
