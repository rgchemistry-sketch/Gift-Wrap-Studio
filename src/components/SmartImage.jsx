import { useEffect, useState } from 'react';
import { optimizeCloudinaryImage } from '../utils/cloudinary-image';

const localStudioImages = {
  '/assets/corporate-gifts.webp': { originalWidth: 960, widths: [320, 480, 600, 800, 960] },
  '/assets/hero-resin-studio.webp': { originalWidth: 1536, widths: [320, 480, 600, 800, 1200] },
  '/assets/milestone-keepsakes-v3.webp': { originalWidth: 1672, widths: [480, 768, 960, 1280, 1600] },
  '/assets/personalized-plaque.webp': { originalWidth: 960, widths: [320, 480, 600, 800, 960] },
  '/assets/personalization-atelier-v2.webp': { originalWidth: 960, widths: [320, 480, 600, 800, 960] },
  '/assets/resin-atelier-hero-v3.webp': { originalWidth: 1672, widths: [480, 768, 960, 1280, 1600] },
  '/assets/serving-collection.webp': { originalWidth: 960, widths: [320, 480, 600, 800, 960] },
  '/assets/signature-resin-collection-v3.webp': { originalWidth: 1672, widths: [480, 768, 960, 1280, 1600] },
  '/assets/wedding-keepsake.webp': { originalWidth: 960, widths: [320, 480, 600, 800, 960] },
};

const localVariantUrl = (src, width) => (
  localStudioImages[src]?.widths.includes(width)
    ? src.replace(/\.webp$/i, `-${width}.webp`)
    : ''
);

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
  const localImage = localStudioImages[src];
  const requestedWidths = responsiveWidths.length ? responsiveWidths : (localImage?.widths || []);
  const candidateWidths = [...new Set(requestedWidths
    .map((width) => Math.round(Number(width)))
    .filter((width) => Number.isFinite(width) && width > 0))]
    .sort((a, b) => a - b);
  const optimizedSource = imageWidth
    ? localVariantUrl(src, Math.round(Number(imageWidth))) || optimizeCloudinaryImage(src, imageWidth)
    : src;
  const generatedCandidates = candidateWidths.flatMap((width) => {
    const localVariant = localVariantUrl(src, width);
    if (localImage && !localVariant) return [];
    return [[localVariant || optimizeCloudinaryImage(src, width), width]];
  });
  if (
    !responsiveWidths.length
    && localImage?.originalWidth
    && !localImage.widths.includes(localImage.originalWidth)
  ) {
    generatedCandidates.push([src, localImage.originalWidth]);
  }
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
