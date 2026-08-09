import { useEffect, useState } from 'react';

export default function SmartImage({ src, alt, className = '', fallbackLabel = 'Gift N Wrap', ...props }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (failed || !src) {
    return (
      <div className={`image-fallback ${className}`} role="img" aria-label={alt || fallbackLabel} {...props}>
        <span className="image-fallback__flower" aria-hidden="true">✦</span>
        <span>{fallbackLabel}</span>
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} {...props} />;
}
