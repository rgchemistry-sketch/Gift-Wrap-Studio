export const CUSTOM_REFERENCE_MAX_BYTES = 8 * 1_024 * 1_024;
export const CUSTOM_REFERENCE_MAX_FILES = 5;
export const CUSTOM_REFERENCE_ACCEPT = 'image/jpeg,image/png,image/webp';

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const validateCustomReferenceFile = (file) => {
  if (!file || typeof file !== 'object') return 'Choose an image to upload.';
  if (!Number(file.size)) return 'That image is empty. Choose another file.';
  if (Number(file.size) > CUSTOM_REFERENCE_MAX_BYTES) {
    return 'That image is over 8 MB. Choose a smaller JPG, PNG or WebP file.';
  }
  if (!allowedImageTypes.has(String(file.type || '').toLowerCase())) {
    return 'Choose a JPG, PNG or WebP image.';
  }
  return '';
};

const safeExpiry = (value, now) => {
  const expiresAt = String(value || '').trim();
  const timestamp = Date.parse(expiresAt);
  // Do not revive an upload that is already expired or so close to expiry that
  // it could fail while the customer reviews the final step.
  return Number.isFinite(timestamp) && timestamp > now + 30_000 ? expiresAt : '';
};

const verifiedReference = (candidate, ownerId, now) => {
  if (!candidate || typeof candidate !== 'object' || !ownerId) return null;
  const publicId = String(candidate.publicId || '').trim();
  const expectedPublicId = new RegExp(
    `^gift-n-wrap/custom-inquiries/${escapeRegExp(ownerId)}/${uuidPattern}$`,
  );
  if (!expectedPublicId.test(publicId)) return null;

  const urlValue = String(candidate.url || '').trim();
  let url;
  let decodedPath;
  try {
    url = new URL(urlValue);
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'res.cloudinary.com') return null;
  const uploadMarker = '/image/upload/';
  const uploadIndex = decodedPath.indexOf(uploadMarker);
  if (uploadIndex < 1) return null;
  const deliveredPath = decodedPath.slice(uploadIndex + uploadMarker.length);
  if (!new RegExp(`(?:^|/)${escapeRegExp(publicId)}(?:\\.[A-Za-z0-9]+)?$`).test(deliveredPath)) {
    return null;
  }

  const expiresAt = safeExpiry(candidate.expiresAt, now);
  if (!expiresAt) return null;
  const name = String(candidate.name || 'Reference image').trim().slice(0, 180)
    || 'Reference image';
  return { name, url: urlValue, publicId, expiresAt };
};

export const normalizeCustomReferenceImages = (
  value,
  { ownerId = '', now = Date.now() } = {},
) => {
  const normalizedOwner = String(ownerId || '').trim();
  if (!normalizedOwner || !Array.isArray(value)) return [];
  const unique = new Map();
  value.forEach((candidate) => {
    const image = verifiedReference(candidate, normalizedOwner, now);
    if (image && !unique.has(image.publicId)) unique.set(image.publicId, image);
  });
  return [...unique.values()].slice(0, CUSTOM_REFERENCE_MAX_FILES);
};

export const customReferencePayload = (value, options) => {
  const images = normalizeCustomReferenceImages(value, options);
  return {
    referenceImages: images.map((image) => image.url),
    publicIds: images.map((image) => image.publicId),
  };
};

export const stripCustomReferenceImages = (draft) => ({
  ...(draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}),
  referenceImages: [],
});

const normalizeOwner = (owner) => String(owner || '').trim() || 'guest';

export const shouldDiscardCustomReferences = (previousOwner, nextOwner) => {
  const previous = normalizeOwner(previousOwner);
  return previous !== 'guest' && previous !== normalizeOwner(nextOwner);
};

export const initialReferenceUploadState = Object.freeze({
  status: 'idle',
  progress: 0,
  error: '',
});

const progressValue = (value) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));

export const referenceUploadReducer = (state, action) => {
  switch (action.type) {
    case 'selected':
      return { status: 'ready', progress: 0, error: '' };
    case 'started':
    case 'retried':
      return { status: 'uploading', progress: 0, error: '' };
    case 'progress':
      return { ...state, status: 'uploading', progress: progressValue(action.value), error: '' };
    case 'failed':
      return { ...state, status: 'error', error: String(action.error || 'The upload failed.') };
    case 'completed':
      return { status: 'complete', progress: 100, error: '' };
    case 'reset':
      return initialReferenceUploadState;
    default:
      return state;
  }
};
