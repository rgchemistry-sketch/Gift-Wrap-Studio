import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import Icon from '../Icon';
import SmartImage from '../SmartImage';
import { ReviewStars, StarRatingInput } from '../ReviewStars';
import ReviewText from '../ReviewText';
import '../../customer-reviews.css';

const payload = (result) => result?.data || result || {};
const reviewId = (review) => review?.id || review?._id || '';
const productFrom = (entry) => entry?.product || {};
const productId = (entry) => productFrom(entry).id || entry?.productId || '';
const productName = (entry) => (
  productFrom(entry).name
  || productFrom(entry).title
  || entry?.productName
  || entry?.productTitle
  || 'Your handmade piece'
);
const productImage = (entry) => productFrom(entry).image || entry?.productImage || entry?.image || '';
const deliveredLabel = (value) => {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Delivered order';
  return `Delivered ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

function ReviewEditor({ entry, existingReview, expectedUserId, onSaved, onCancel }) {
  const formRef = useRef(null);
  const inputId = useId().replaceAll(':', '');
  const [rating, setRating] = useState(Number(existingReview?.rating) || 0);
  const [comment, setComment] = useState(existingReview?.comment || existingReview?.text || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEditing = Boolean(reviewId(existingReview));
  const trimmedComment = comment.trim();

  useEffect(() => {
    const selectedRating = formRef.current?.querySelector('input[type="radio"]:checked');
    (selectedRating || formRef.current?.querySelector('input[type="radio"]'))?.focus({ preventScroll: true });
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!rating) {
      setError('Choose a rating from 1 to 5 stars.');
      return;
    }
    if (trimmedComment.length < 10) {
      setError('Add a short note of at least 10 characters.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const values = { rating, comment: trimmedComment };
      if (isEditing) {
        await api.updateReview(reviewId(existingReview), values, expectedUserId);
      } else {
        await api.createReview({ productId: productId(entry), ...values }, expectedUserId);
      }
      await onSaved(isEditing ? 'Your review has been updated.' : 'Thank you—your verified review is now in the studio guestbook.');
    } catch (requestError) {
      setError(requestError.message || 'Your review could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form ref={formRef} className="account-review-editor" onSubmit={submit}>
      <StarRatingInput
        value={rating}
        onChange={setRating}
        disabled={saving}
        name={`review-rating-${inputId}`}
      />
      <label htmlFor={`review-comment-${inputId}`}>
        <span>Your note</span>
        <textarea
          id={`review-comment-${inputId}`}
          value={comment}
          minLength={10}
          maxLength={1000}
          rows={3}
          required
          disabled={saving}
          onChange={(event) => setComment(event.target.value)}
          placeholder="What made this piece feel special?"
          aria-describedby={`review-comment-help-${inputId}`}
        />
      </label>
      <div id={`review-comment-help-${inputId}`} className="account-review-editor__privacy">
        <Icon name="shield" size={14} />
        <span>Your privacy-safe customer name, rating and note will appear publicly. Your email and order details stay private.</span>
        <small aria-live="polite">{trimmedComment.length}/1000 characters · minimum 10</small>
      </div>
      {error && <Alert variant="warning" className="soft-alert" role="alert">{error}</Alert>}
      <div className="account-review-editor__actions">
        {onCancel && <Button type="button" variant="outline-dark" disabled={saving} onClick={onCancel}>Cancel</Button>}
        <Button type="submit" className="button-burgundy" disabled={saving || !rating || trimmedComment.length < 10}>
          {saving && <Spinner animation="border" size="sm" aria-hidden="true" />}
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Share review'}
        </Button>
      </div>
    </form>
  );
}

function ProductReviewIdentity({ entry, delivery = false }) {
  const product = productFrom(entry);
  return (
    <div className="account-review-product">
      <SmartImage
        src={productImage(entry)}
        alt=""
        fallbackLabel={productName(entry)}
        loading="lazy"
        decoding="async"
        imageWidth={240}
      />
      <span>
        <small>{delivery ? deliveredLabel(entry.deliveredAt) : 'Verified purchase'}</small>
        <strong>{productName(entry)}</strong>
        {product.slug && <Link to={product.href || `/product/${product.slug}`}>View piece <Icon name="arrow" size={13} /></Link>}
      </span>
    </div>
  );
}

export default function CustomerReviewsPanel({ userId }) {
  const [reviews, setReviews] = useState([]);
  const [eligible, setEligible] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [composerKey, setComposerKey] = useState('');
  const triggerRefs = useRef(new Map());
  const noticeRef = useRef(null);

  const load = useCallback(async ({ preserveNotice = false } = {}) => {
    setLoading(true);
    setError('');
    if (!preserveNotice) setNotice('');
    try {
      const [mineResult, eligibleResult] = await Promise.all([
        api.getMyReviews(userId),
        api.getEligibleReviews(userId),
      ]);
      const minePayload = payload(mineResult);
      const eligiblePayload = payload(eligibleResult);
      setReviews(Array.isArray(minePayload.reviews) ? minePayload.reviews : []);
      setEligible(Array.isArray(eligiblePayload.products) ? eligiblePayload.products : []);
    } catch (requestError) {
      setError(requestError.message || 'Your reviews could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus({ preventScroll: true });
  }, [notice]);

  const reviewedProductIds = useMemo(() => new Set(reviews.map(productId).filter(Boolean)), [reviews]);
  const availableProducts = eligible.filter((entry) => !reviewedProductIds.has(productId(entry)));
  const saved = async (message) => {
    setNotice(message);
    setComposerKey('');
    await load({ preserveNotice: true });
  };
  const closeEditor = (key) => {
    setComposerKey('');
    requestAnimationFrame(() => triggerRefs.current.get(key)?.focus({ preventScroll: true }));
  };
  const rememberTrigger = (key) => (element) => {
    if (element) triggerRefs.current.set(key, element);
    else triggerRefs.current.delete(key);
  };

  if (loading && !reviews.length && !eligible.length) {
    return <div className="account-loading" role="status"><Spinner /><span>Opening your guestbook…</span></div>;
  }

  if (error && !reviews.length && !eligible.length) {
    return (
      <div className="account-empty account-empty--wide account-reviews-empty" role="alert">
        <span><Icon name="star" /></span>
        <div><p className="eyebrow">Your reviews</p><h2>Your guestbook could not be opened.</h2><p>{error}</p><div className="account-empty__actions"><Button type="button" className="button-burgundy" onClick={() => load()}>Try again</Button></div></div>
      </div>
    );
  }

  if (!reviews.length && !availableProducts.length) {
    return (
      <div className="account-empty account-empty--wide account-reviews-empty">
        <span><Icon name="star" /></span>
        <div><p className="eyebrow">Your reviews</p><h2>A review unlocks after delivery.</h2><p>Once one of your handmade pieces is marked delivered, return here to leave a 1–5 star rating and a note in the studio guestbook.</p></div>
      </div>
    );
  }

  return (
    <div className="account-reviews-panel">
      <header className="account-reviews-panel__head">
        <div><p className="eyebrow">Your customer guestbook</p><h2>Your reviews</h2><p>Review your delivered purchases and edit your feedback here.</p></div>
        <span><Icon name="shield" size={16} /> Verified by delivery</span>
      </header>

      {notice && <Alert ref={noticeRef} tabIndex={-1} variant="success" className="soft-alert" role="status">{notice}</Alert>}
      {error && <Alert variant="warning" className="soft-alert">{error} <button type="button" className="plain-link" onClick={() => load({ preserveNotice: true })}>Retry</button></Alert>}

      {availableProducts.length > 0 && (
        <section className="account-reviews-ready" aria-labelledby="reviews-ready-title">
          <div className="account-reviews-section-title"><span>01</span><div><p className="eyebrow">Ready when you are</p><h3 id="reviews-ready-title">Share a delivered piece.</h3></div></div>
          <div className="account-reviews-ready__grid">
            {availableProducts.map((entry) => {
              const key = `new-${productId(entry)}`;
              const open = composerKey === key;
              return (
                <article className={`account-review-card${open ? ' is-composing' : ''}`} key={key}>
                  <ProductReviewIdentity entry={entry} delivery />
                  {open
                    ? <ReviewEditor entry={entry} expectedUserId={userId} onSaved={saved} onCancel={() => closeEditor(key)} />
                    : <><p>Your piece has arrived. How was it?</p><Button ref={rememberTrigger(key)} type="button" className="button-burgundy" onClick={() => setComposerKey(key)}>Write a review <Icon name="arrow" size={16} /></Button></>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="account-reviews-published" aria-labelledby="reviews-published-title">
          <div className="account-reviews-section-title"><span>{availableProducts.length ? '02' : '01'}</span><div><p className="eyebrow">In the guestbook</p><h3 id="reviews-published-title">Words you have shared.</h3></div></div>
          <div className="account-reviews-published__list">
            {reviews.map((review) => {
              const key = `edit-${reviewId(review)}`;
              const open = composerKey === key;
              return (
                <article className={`account-review-card account-review-card--published${open ? ' is-composing' : ''}`} key={key}>
                  <ProductReviewIdentity entry={review} />
                  {open
                    ? <ReviewEditor entry={review} existingReview={review} expectedUserId={userId} onSaved={saved} onCancel={() => closeEditor(key)} />
                    : <>
                      <div className="account-review-card__quote"><ReviewStars rating={review.rating} /><ReviewText text={review.comment || review.text} limit={240} /></div>
                      <button ref={rememberTrigger(key)} type="button" className="plain-link" onClick={() => setComposerKey(key)}>Edit review <Icon name="arrow" size={14} /></button>
                    </>}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
