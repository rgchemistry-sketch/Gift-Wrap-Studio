import { useEffect, useState } from 'react';
import Container from 'react-bootstrap/Container';
import { api } from '../api/client';
import Icon from './Icon';
import SmartImage from './SmartImage';
import { ReviewStars } from './ReviewStars';
import '../customer-reviews.css';

const dateLabel = (value) => {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Recently shared';
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

const reviewerName = (review) => (
  review.customerName
  || review.reviewerName
  || review.authorName
  || review.user?.name
  || 'Verified customer'
);

const productName = (review) => (
  review.product?.name
  || review.product?.title
  || review.productName
  || review.productTitle
  || 'Handmade piece'
);

const productImage = (review) => (
  review.product?.image
  || review.productImage
  || review.image
  || ''
);

export default function CustomerReviewsSection() {
  const [feed, setFeed] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let active = true;
    api.getReviews()
      .then((result) => {
        if (active) setFeed(result?.data || result || null);
      })
      .catch(() => {
        if (active) setFeed(null);
      });
    return () => { active = false; };
  }, []);

  const reviews = Array.isArray(feed?.reviews) ? feed.reviews : [];
  useEffect(() => {
    if (activeIndex >= reviews.length) setActiveIndex(0);
  }, [activeIndex, reviews.length]);

  if (!reviews.length) return null;

  const activeReview = reviews[activeIndex] || reviews[0];
  const summary = feed?.summary || {};
  const averageRating = Number(summary.averageRating || (
    reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length
  ));
  const totalReviews = Math.max(reviews.length, Number(summary.totalReviews) || 0);
  const move = (direction) => setActiveIndex((current) => (
    (current + direction + reviews.length) % reviews.length
  ));
  const indexWindowStart = Math.min(
    Math.max(activeIndex - 1, 0),
    Math.max(reviews.length - 3, 0),
  );
  const indexedReviews = reviews
    .slice(indexWindowStart, indexWindowStart + 3)
    .map((review, offset) => ({ review, index: indexWindowStart + offset }));

  return (
    <section className="customer-reviews" aria-labelledby="customer-reviews-title">
      <Container fluid="xl">
        <div className="customer-reviews__frame">
          <span className="customer-reviews__seal" aria-hidden="true"><Icon name="star" size={30} /></span>
          <header className="customer-reviews__heading">
            <div>
              <p className="eyebrow light-eyebrow">The customer guestbook</p>
              <h2 id="customer-reviews-title">Made for them.<br /><em>Remembered here.</em></h2>
            </div>
            <p>Every note comes from a signed-in customer after their piece was delivered. No anonymous ratings, no borrowed words.</p>
          </header>

          <div className={`customer-reviews__layout${reviews.length > 1 ? ' has-index' : ''}`}>
            <aside className="customer-reviews__score" aria-label={`Average customer rating: ${averageRating.toFixed(1)} out of 5`}>
              <span className="customer-reviews__score-kicker">Studio average</span>
              <strong>{averageRating.toFixed(1)}</strong>
              <ReviewStars rating={averageRating} />
              <span>{totalReviews.toLocaleString('en-IN')} verified {totalReviews === 1 ? 'review' : 'reviews'}</span>
              <i aria-hidden="true" />
              <p><Icon name="shield" size={16} /> Delivered-order verified</p>
            </aside>

            <article className="customer-review-feature" key={activeReview.id || activeReview._id} aria-live="polite">
              <span className="customer-review-feature__mark" aria-hidden="true">“</span>
              <div className="customer-review-feature__product">
                <SmartImage
                  src={productImage(activeReview)}
                  alt=""
                  fallbackLabel={productName(activeReview)}
                  loading="lazy"
                  decoding="async"
                  imageWidth={240}
                />
                <span><small>Made & delivered</small><strong>{productName(activeReview)}</strong></span>
              </div>
              <ReviewStars rating={activeReview.rating} />
              <blockquote>{activeReview.comment || activeReview.text}</blockquote>
              <footer>
                <span className="customer-review-feature__initial" aria-hidden="true">{reviewerName(activeReview).trim().charAt(0).toUpperCase() || 'G'}</span>
                <div><strong>{reviewerName(activeReview)}</strong><span>{dateLabel(activeReview.createdAt || activeReview.reviewedAt)}</span></div>
                <span className="customer-review-feature__verified"><Icon name="check" size={13} /> Verified purchase</span>
              </footer>
            </article>

            {reviews.length > 1 && (
              <aside className="customer-review-index">
                <p>More notes</p>
                <div role="group" aria-label="Choose a customer review">
                  {indexedReviews.map(({ review, index }) => (
                    <button
                      type="button"
                      aria-pressed={index === activeIndex}
                      className={index === activeIndex ? 'is-active' : ''}
                      onClick={() => setActiveIndex(index)}
                      key={review.id || review._id || `${reviewerName(review)}-${index}`}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <span><strong>{reviewerName(review)}</strong><small>{productName(review)}</small></span>
                      <ReviewStars rating={review.rating} compact />
                    </button>
                  ))}
                </div>
                <nav aria-label="Review controls">
                  <button type="button" onClick={() => move(-1)} aria-label="Previous review"><Icon name="arrow" /></button>
                  <span>{String(activeIndex + 1).padStart(2, '0')} / {String(reviews.length).padStart(2, '0')}</span>
                  <button type="button" onClick={() => move(1)} aria-label="Next review"><Icon name="arrow" /></button>
                </nav>
              </aside>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
