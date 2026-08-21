import Icon from './Icon';

const numericRating = (value) => Math.max(0, Math.min(5, Number(value) || 0));

export function ReviewStars({ rating, compact = false, className = '' }) {
  const value = numericRating(rating);
  const accessibleValue = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <span
      className={`review-stars${compact ? ' review-stars--compact' : ''}${className ? ` ${className}` : ''}`}
      aria-label={`${accessibleValue} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          className="review-star-glyph"
          style={{ '--star-fill': `${Math.max(0, Math.min(1, value - index)) * 100}%` }}
          aria-hidden="true"
          key={index}
        >
          <Icon name="star" size={compact ? 13 : 17} />
          <span><Icon name="star" size={compact ? 13 : 17} /></span>
        </span>
      ))}
    </span>
  );
}

export function StarRatingInput({ value, onChange, disabled = false, name = 'rating' }) {
  const selected = Math.round(numericRating(value));
  return (
    <fieldset className="star-rating-input" disabled={disabled}>
      <legend>Your rating</legend>
      <div>
        {Array.from({ length: 5 }, (_, index) => {
          const rating = index + 1;
          return (
            <label className={rating <= selected ? 'is-selected' : ''} key={rating}>
              <input
                type="radio"
                name={name}
                value={rating}
                checked={selected === rating}
                onChange={() => onChange(rating)}
                required
              />
              <Icon name="star" size={25} />
              <span className="visually-hidden">{rating} {rating === 1 ? 'star' : 'stars'}</span>
            </label>
          );
        })}
      </div>
      <output aria-live="polite">{selected ? `${selected} out of 5` : 'Choose 1 to 5 stars'}</output>
    </fieldset>
  );
}
