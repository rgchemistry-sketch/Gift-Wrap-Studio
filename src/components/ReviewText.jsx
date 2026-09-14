import { useId, useState } from 'react';

export default function ReviewText({ text = '', limit = 220 }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const content = String(text).trim();
  const isLong = content.length > limit;
  const preview = isLong ? content.slice(0, limit).replace(/\s+\S*$/, '').trimEnd() : content;

  return (
    <div className="review-text">
      <blockquote id={contentId}>{isLong && !expanded ? `${preview || content.slice(0, limit)}…` : content}</blockquote>
      {isLong && (
        <button
          type="button"
          className="review-text__toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show less' : 'Read full review'}
        </button>
      )}
    </div>
  );
}
