const cloudinaryHost = 'res.cloudinary.com';

export function normalizeProductImageUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  if (candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/\\')) {
    return candidate;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === cloudinaryHost
      ? url.href
      : '';
  } catch {
    return '';
  }
}

export function imageKey(image) {
  return String(image?.publicId || normalizeProductImageUrl(image?.url) || image?.url || '');
}

export function imageFromReusableUrl({ url, initialImages = [], defaultAlt = '' }) {
  const normalizedUrl = normalizeProductImageUrl(url);
  if (!normalizedUrl) return null;
  const reusable = initialImages.find(
    (image) => normalizeProductImageUrl(image?.url) === normalizedUrl,
  );
  return reusable
    ? { ...reusable, url: normalizedUrl }
    : { url: normalizedUrl, publicId: '', alt: defaultAlt };
}

export function moveProductImage(images, fromIndex, toIndex) {
  const next = [...images];
  if (
    fromIndex < 0
    || fromIndex >= next.length
    || toIndex < 0
    || toIndex >= next.length
    || fromIndex === toIndex
  ) {
    return next;
  }
  const [image] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, image);
  return next;
}

export function verifyProductImageUrl(
  url,
  { ImageConstructor = globalThis.Image, timeoutMs = 12_000 } = {},
) {
  return new Promise((resolve, reject) => {
    if (typeof ImageConstructor !== 'function') {
      reject(new Error('Image preview is unavailable in this browser.'));
      return;
    }

    const image = new ImageConstructor();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      callback(value);
    };
    const timer = globalThis.setTimeout(
      () => finish(reject, new Error('The image preview timed out. Check the URL and try again.')),
      timeoutMs,
    );

    image.onload = () => {
      if (Number(image.naturalWidth) > 0 && Number(image.naturalHeight) > 0) {
        finish(resolve, { width: image.naturalWidth, height: image.naturalHeight });
      } else {
        finish(reject, new Error('That URL did not return a usable image.'));
      }
    };
    image.onerror = () => finish(
      reject,
      new Error('That image could not be loaded. Check that the URL is public and points directly to an image.'),
    );
    image.decoding = 'async';
    image.src = url;
  });
}
