import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_REFERENCE_MAX_BYTES,
  customReferencePayload,
  initialReferenceUploadState,
  normalizeCustomReferenceImages,
  referenceUploadReducer,
  shouldDiscardCustomReferences,
  stripCustomReferenceImages,
  validateCustomReferenceFile,
} from './custom-reference-upload.js';

const ownerId = 'buyer-a';
const publicId = `gift-n-wrap/custom-inquiries/${ownerId}/123e4567-e89b-12d3-a456-426614174000`;
const reference = {
  name: 'wedding-flowers.jpg',
  publicId,
  url: `https://res.cloudinary.com/studio-cloud/image/upload/v42/${publicId}.jpg`,
  expiresAt: '2030-01-01T12:00:00.000Z',
};

test('custom reference files accept supported images and reject unsafe or oversized files', () => {
  assert.equal(validateCustomReferenceFile({ size: 512, type: 'image/jpeg' }), '');
  assert.equal(validateCustomReferenceFile({ size: 512, type: 'image/png' }), '');
  assert.equal(validateCustomReferenceFile({ size: 512, type: 'image/webp' }), '');
  assert.match(validateCustomReferenceFile({ size: 0, type: 'image/jpeg' }), /empty/i);
  assert.match(
    validateCustomReferenceFile({ size: CUSTOM_REFERENCE_MAX_BYTES + 1, type: 'image/jpeg' }),
    /over 8 MB/i,
  );
  assert.match(validateCustomReferenceFile({ size: 512, type: 'image/svg+xml' }), /JPG, PNG or WebP/i);
});

test('verified custom references round-trip into URLs and cleanup public IDs', () => {
  const payload = customReferencePayload([reference, reference], {
    ownerId,
    now: Date.parse('2029-12-31T12:00:00.000Z'),
  });
  assert.deepEqual(payload.referenceImages, [reference.url]);
  assert.deepEqual(payload.publicIds, [reference.publicId]);
});

test('draft hydration rejects expired, foreign-owner and unverified reference metadata', () => {
  assert.deepEqual(normalizeCustomReferenceImages([reference], {
    ownerId: 'buyer-b',
    now: Date.parse('2029-12-31T12:00:00.000Z'),
  }), []);
  assert.deepEqual(normalizeCustomReferenceImages([reference], {
    ownerId,
    now: Date.parse('2030-01-01T12:00:00.000Z'),
  }), []);
  assert.deepEqual(normalizeCustomReferenceImages([{
    ...reference,
    url: 'https://example.com/tracking.jpg',
  }], {
    ownerId,
    now: Date.parse('2029-12-31T12:00:00.000Z'),
  }), []);
});

test('upload state preserves the preview through failure and supports a clean retry', () => {
  const selected = referenceUploadReducer(initialReferenceUploadState, { type: 'selected' });
  const started = referenceUploadReducer(selected, { type: 'started' });
  const progressed = referenceUploadReducer(started, { type: 'progress', value: 47.6 });
  const failed = referenceUploadReducer(progressed, { type: 'failed', error: 'Provider unavailable' });
  const retried = referenceUploadReducer(failed, { type: 'retried' });
  const completed = referenceUploadReducer(retried, { type: 'completed' });

  assert.deepEqual(progressed, { status: 'uploading', progress: 48, error: '' });
  assert.deepEqual(failed, { status: 'error', progress: 48, error: 'Provider unavailable' });
  assert.deepEqual(retried, { status: 'uploading', progress: 0, error: '' });
  assert.deepEqual(completed, { status: 'complete', progress: 100, error: '' });
});

test('authenticated owner changes discard upload metadata while keeping written draft fields', () => {
  assert.equal(shouldDiscardCustomReferences('buyer-a', 'buyer-b'), true);
  assert.equal(shouldDiscardCustomReferences('buyer-a', 'guest'), true);
  assert.equal(shouldDiscardCustomReferences('guest', 'buyer-a'), false);
  assert.deepEqual(
    stripCustomReferenceImages({ description: 'Keep this idea', referenceImages: [reference] }),
    { description: 'Keep this idea', referenceImages: [] },
  );
});
