const CLOUDINARY_HOST = 'res.cloudinary.com';
const UPLOAD_SEGMENT = '/image/upload/';

export function optimizeCloudinaryImage(value, width = 720) {
  const source = String(value || '').trim();
  if (!source) return '';

  try {
    const url = new URL(source);
    const deliveryWidth = Math.min(2400, Math.max(64, Math.round(Number(width) || 720)));
    const uploadIndex = url.pathname.indexOf(UPLOAD_SEGMENT);
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== CLOUDINARY_HOST
      || uploadIndex < 0
    ) return source;

    const assetPath = url.pathname.slice(uploadIndex + UPLOAD_SEGMENT.length);
    // A signed delivery URL would need a new Cloudinary signature after changing transforms.
    if (assetPath.startsWith('s--')) return source;

    const transformation = `f_auto,q_auto,w_${deliveryWidth}`;
    url.pathname = `${url.pathname.slice(0, uploadIndex + UPLOAD_SEGMENT.length)}${transformation}/${assetPath}`;
    return url.href;
  } catch {
    return source;
  }
}
