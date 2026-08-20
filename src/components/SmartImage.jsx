import { useEffect, useState } from 'react';
import { optimizeCloudinaryImage } from '../utils/cloudinary-image';

export default function SmartImage({
  src,
  alt,
  className = '',
  fallbackLabel = 'Gift N Wrap',
  imageWidth,
  responsiveWidths = [],
  sizes,
  srcSet,
  loading,
  decoding,
  fetchPriority,
  onError,
  onLoad,
  ...props
}) {
  const [failed, setFailed] = useState(false);
  const candidateWidths = [...new Set(responsiveWidths
    .map((width) => Math.round(Number(width)))
    .filter((width) => Number.isFinite(width) && width > 0))]
    .sort((a, b) => a - b);
  const optimizedSource = imageWidth ? optimizeCloudinaryImage(src, imageWidth) : src;
  const generatedCandidates = candidateWidths.map((width) => [
    optimizeCloudinaryImage(src, width),
    width,
  ]);
  const generatedSrcSet = generatedCandidates.some(([url]) => url !== src)
    ? generatedCandidates.map(([url, width]) => `${url} ${width}w`).join(', ')
    : undefined;

  useEffect(() => setFailed(false), [src]);

  if (failed || !src) {
    return (
      <div className={`image-fallback ${className}`} role="img" aria-label={alt || fallbackLabel} {...props}>
        <span className="image-fallback__flower" aria-hidden="true">✦</span>
        <span>{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <img
      src={optimizedSource}
      srcSet={srcSet || generatedSrcSet}
      sizes={sizes}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      {...props}
      onLoad={(event) => {
        setFailed(false);
        onLoad?.(event);
      }}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
