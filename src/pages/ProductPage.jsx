import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Accordion from 'react-bootstrap/Accordion';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../components/Icon';
import ProductCard from '../components/ProductCard';
import SmartImage from '../components/SmartImage';
import { RouteLoader } from '../components/Feedback';
import { api } from '../api/client';
import { demoProducts, formatCurrency } from '../data/catalog';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';

const colourOptions = [
  ['Forest & gold', '#315446'],
  ['Wine & blush', '#6f263d'],
  ['Ivory & champagne', '#d3b47a'],
  ['Ocean & pearl', '#397985'],
  ['Tell the artist', '#8b7267'],
];

function MediaUpload({ onChange }) {
  const inputRef = useRef(null);
  const previewUrlRef = useRef('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const { user, openAuth } = useAuth();

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const remove = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setFile(null);
    setPreview('');
    setError('');
    setStatus('idle');
    if (inputRef.current) inputRef.current.value = '';
    onChange(null);
  };

  const uploadToCloudinary = async (selectedFile) => {
    try {
      const signatureResult = await api.requestUploadSignature({ purpose: 'orders' });
      const signature = signatureResult.data || signatureResult;
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('api_key', signature.apiKey);
      formData.append('timestamp', signature.timestamp);
      formData.append('signature', signature.signature);
      formData.append('folder', signature.folder);
      formData.append('upload_preset', signature.upload_preset);
      formData.append('allowed_formats', signature.allowed_formats);
      formData.append('transformation', signature.transformation);
      formData.append('public_id', signature.public_id);
      formData.append('overwrite', String(signature.overwrite));
      const response = await fetch(signature.uploadUrl || `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploaded = await response.json();
      if (!response.ok || !uploaded.secure_url) throw new Error(uploaded.error?.message || 'Upload could not be completed.');
      setStatus('uploaded');
      onChange({ name: selectedFile.name, url: uploaded.secure_url, publicId: uploaded.public_id });
    } catch (uploadError) {
      setStatus('local');
      setError(`${uploadError.message} Your preview is still here; remove it or try again.`);
      onChange({ name: selectedFile.name, pending: true });
    }
  };

  const selectFile = async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    setError('');
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
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
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const objectUrl = URL.createObjectURL(selectedFile);
    previewUrlRef.current = objectUrl;
    setFile(selectedFile);
    setPreview(objectUrl);
    onChange({ name: selectedFile.name, pending: true });
    if (!user) {
      setStatus('local');
      setError('Preview ready. Sign in before checkout to securely attach it to your request.');
      return;
    }
    setStatus('uploading');
    await uploadToCloudinary(selectedFile);
  };

  return (
    <div className="media-upload">
      <Form.Control ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} id="personalization-photo" />
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
            <small>
              {status === 'uploading' && <><Spinner size="sm" /> Uploading securely…</>}
              {status === 'uploaded' && <><Icon name="check" size={14} /> Securely attached</>}
              {status === 'local' && 'Preview saved for this page'}
            </small>
            <div><button type="button" onClick={() => inputRef.current?.click()}>Replace</button><button type="button" onClick={remove}>Remove</button></div>
          </div>
        </div>
      )}
      {error && (
        <p className="field-message" role="status">{error} {!user && file && <button type="button" onClick={() => openAuth('Sign in to securely save your customization image.')}>Sign in</button>}</p>
      )}
    </div>
  );
}

export default function ProductPage() {
  const { slug } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [validated, setValidated] = useState(false);
  const [customization, setCustomization] = useState({ name: '', date: '', message: '', colour: 'Forest & gold', finish: 'Gold foil', media: null });
  const { addToCart, wishlist, toggleWishlist } = useShop();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.getProduct(slug)
      .then((result) => {
        if (active) setProduct(result.product);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [slug]);

  const related = useMemo(
    () => demoProducts.filter((item) => item.id !== product?.id && item.category === product?.category).slice(0, 3),
    [product],
  );

  if (loading) return <RouteLoader />;
  if (error || !product) {
    return (
      <Container className="access-state page-section">
        <div className="access-state__icon"><Icon name="spark" size={30} /></div>
        <p className="eyebrow">This piece has wandered</p>
        <h1>We can’t find that studio piece.</h1>
        <p>{error || 'It may have been a one-of-one design or is no longer in the current collection.'}</p>
        <Button as={Link} to="/shop" className="button-burgundy">Browse the collection</Button>
      </Container>
    );
  }

  const gallery = product.gallery?.length ? product.gallery : [product.image];
  const updateCustomization = (key, value) => setCustomization((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (product.customizable && !form.checkValidity()) {
      event.stopPropagation();
      setValidated(true);
      return;
    }
    setValidated(true);
    const safeCustomization = {
      ...customization,
      media: customization.media ? {
        name: customization.media.name,
        url: customization.media.url || '',
        publicId: customization.media.publicId || '',
        pending: Boolean(customization.media.pending),
      } : null,
    };
    addToCart(product, { quantity, customization: product.customizable ? safeCustomization : {} });
  };

  const saved = wishlist.includes(product.id);

  return (
    <>
      <section className="product-page page-section">
        <Container fluid="xl">
          <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/shop">Shop</Link><span>/</span><span aria-current="page">{product.title}</span></nav>
          <Row className="g-5 product-detail-row">
            <Col lg={7}>
              <div className="product-gallery">
                <div className="product-gallery__thumbs" aria-label="Product images">
                  {gallery.map((image, index) => (
                    <button key={`${image}-${index}`} type="button" className={selectedImage === index ? 'is-active' : ''} onClick={() => setSelectedImage(index)} aria-label={`Show image ${index + 1}`} aria-pressed={selectedImage === index}>
                      <SmartImage src={image} alt="" fallbackLabel={product.category} />
                    </button>
                  ))}
                </div>
                <div className="product-gallery__main">
                  <SmartImage src={gallery[selectedImage]} alt={`${product.title}, view ${selectedImage + 1}`} fallbackLabel={product.title} />
                  {product.badge && <span className="product-gallery__badge">{product.badge}</span>}
                </div>
              </div>
            </Col>
            <Col lg={5}>
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

                <Form noValidate validated={validated} onSubmit={submit} className="personalization-form">
                  {product.customizable && (
                    <fieldset>
                      <legend><span>01</span> Personalize your piece</legend>
                      <Form.Group className="form-field" controlId="custom-name">
                        <Form.Label>Name or initials <small>required</small></Form.Label>
                        <Form.Control required maxLength={50} value={customization.name} onChange={(event) => updateCustomization('name', event.target.value)} placeholder="e.g. Aarya & Kabir" />
                        <Form.Control.Feedback type="invalid">Please enter the name or initials for your piece.</Form.Control.Feedback>
                      </Form.Group>
                      <Row className="g-3">
                        <Col sm={6}><Form.Group className="form-field" controlId="custom-date"><Form.Label>Special date <small>optional</small></Form.Label><Form.Control type="date" value={customization.date} onChange={(event) => updateCustomization('date', event.target.value)} /></Form.Group></Col>
                        <Col sm={6}><Form.Group className="form-field" controlId="custom-finish"><Form.Label>Metallic finish</Form.Label><Form.Select value={customization.finish} onChange={(event) => updateCustomization('finish', event.target.value)}><option>Gold foil</option><option>Silver foil</option><option>Rose gold</option><option>No metallic finish</option></Form.Select></Form.Group></Col>
                      </Row>
                      <Form.Group className="form-field colour-field">
                        <Form.Label>Colour story</Form.Label>
                        <div className="colour-options">
                          {colourOptions.map(([name, value]) => (
                            <label key={name} title={name}>
                              <input type="radio" name="colour" value={name} checked={customization.colour === name} onChange={(event) => updateCustomization('colour', event.target.value)} />
                              <span style={{ '--swatch': value }} /><small>{name}</small>
                            </label>
                          ))}
                        </div>
                      </Form.Group>
                      <Form.Group className="form-field" controlId="custom-message">
                        <Form.Label>Short message or artist notes <small>optional</small></Form.Label>
                        <Form.Control as="textarea" rows={3} maxLength={180} value={customization.message} onChange={(event) => updateCustomization('message', event.target.value)} placeholder="Tell us the mood, flowers or details you have in mind…" />
                        <div className="character-count">{customization.message.length}/180</div>
                      </Form.Group>
                      <Form.Group className="form-field">
                        <Form.Label>Photo or inspiration <small>optional</small></Form.Label>
                        <MediaUpload onChange={(media) => updateCustomization('media', media)} />
                      </Form.Group>
                    </fieldset>
                  )}

                  <div className="buy-actions">
                    <div className="quantity-control" aria-label="Quantity">
                      <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity"><Icon name="minus" size={16} /></button>
                      <span aria-live="polite">{quantity}</span>
                      <button type="button" onClick={() => setQuantity((value) => Math.min(10, value + 1))} aria-label="Increase quantity"><Icon name="plus" size={16} /></button>
                    </div>
                    <Button type="submit" className="button-burgundy flex-grow-1" disabled={!product.inStock}>Add to bag · {formatCurrency(product.price * quantity)}</Button>
                  </div>
                  {product.customizable && <p className="included-note"><Icon name="check" size={14} /> Standard personalization is included in the displayed price.</p>}
                </Form>

                <Accordion flush className="studio-accordion product-accordion">
                  <Accordion.Item eventKey="0"><Accordion.Header>What arrives with it</Accordion.Header><Accordion.Body><ul><li>Premium gift packaging</li><li>Protective bubble wrap and corrugated box</li><li>Care instructions and thank-you card</li></ul></Accordion.Body></Accordion.Item>
                  <Accordion.Item eventKey="1"><Accordion.Header>Care instructions</Accordion.Header><Accordion.Body>Keep away from prolonged direct sunlight. Clean with a soft microfiber cloth, avoid harsh chemicals, and handle with care to prevent scratches.</Accordion.Body></Accordion.Item>
                  <Accordion.Item eventKey="2"><Accordion.Header>Design approval & delivery</Accordion.Header><Accordion.Body>For detailed custom work, the studio confirms your notes and may share a digital concept before production. Delivery is available across India after the handmade processing window shown above.</Accordion.Body></Accordion.Item>
                </Accordion>
              </div>
            </Col>
          </Row>
        </Container>
      </section>

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
        <Button className="button-burgundy" onClick={() => document.querySelector('.personalization-form')?.requestSubmit()} disabled={!product.inStock}>{product.customizable ? 'Personalize & add' : 'Add to bag'}</Button>
      </div>
    </>
  );
}
