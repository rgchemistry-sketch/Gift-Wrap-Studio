import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { api, ApiError } from './client.js';
import { productImagesPayload } from '../components/admin/product-image-utils.js';
import { createProductSchema, updateProductSchema } from '../../server/validation/schemas.js';

const publicId = 'gift-n-wrap/custom-inquiries/buyer-a/123e4567-e89b-12d3-a456-426614174000';
const secureUrl = `https://res.cloudinary.com/studio-cloud/image/upload/v7/${publicId}.jpg`;
const expiresAt = '2030-01-01T00:00:00.000Z';
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalXhr = globalThis.XMLHttpRequest;

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

const signature = {
  apiKey: 'key',
  timestamp: 123,
  signature: 'signed',
  folder: 'gift-n-wrap/custom-inquiries/buyer-a',
  upload_preset: 'locked-preset',
  allowed_formats: 'jpg,jpeg,png,webp',
  public_id: '123e4567-e89b-12d3-a456-426614174000',
  overwrite: false,
  fullPublicId: publicId,
  expiresAt,
  uploadUrl: 'https://api.cloudinary.test/upload',
};

const providerResult = { public_id: publicId, secure_url: secureUrl };

const installApiFetch = ({
  providerViaFetch = false,
  deleted = [],
  completionStatus = 200,
  completionStatuses = [],
  completionErrorCode = 'UPLOAD_VERIFICATION_FAILED',
  completionRequests = [],
  requests = [],
  uploadedFiles = [],
} = {}) => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push(target);
    if (target === '/api/uploads/signature') return jsonResponse({ data: signature });
    if (target === signature.uploadUrl && providerViaFetch) {
      uploadedFiles.push(options.body.get('file'));
      return jsonResponse(providerResult);
    }
    if (target === '/api/uploads/complete') {
      const status = completionStatuses[completionRequests.length] ?? completionStatus;
      completionRequests.push(JSON.parse(options.body).publicId);
      if (status !== 200) {
        return jsonResponse({
          error: {
            code: completionErrorCode,
            message: 'The provider upload could not be verified.',
          },
        }, status);
      }
      return jsonResponse({ data: { publicId, url: secureUrl } });
    }
    if (target === '/api/uploads/asset' && options.method === 'DELETE') {
      deleted.push(JSON.parse(options.body).publicId);
      return jsonResponse({ data: { success: true } });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
};

class ProgressXhr {
  static mode = 'success';

  constructor() {
    this.listeners = new Map();
    this.uploadListeners = new Map();
    this.upload = {
      addEventListener: (name, listener) => this.uploadListeners.set(name, listener),
    };
    this.status = 0;
    this.response = null;
    this.responseText = '';
  }

  open() {}

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  abort() {}

  send() {
    queueMicrotask(() => {
      if (ProgressXhr.mode === 'error') {
        this.listeners.get('error')?.();
        return;
      }
      this.uploadListeners.get('progress')?.({ lengthComputable: true, loaded: 1, total: 2 });
      this.status = 200;
      this.response = providerResult;
      this.listeners.get('load')?.();
    });
  }
}

beforeEach(() => {
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  ProgressXhr.mode = 'success';
  globalThis.XMLHttpRequest = ProgressXhr;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  if (originalXhr === undefined) delete globalThis.XMLHttpRequest;
  else globalThis.XMLHttpRequest = originalXhr;
});

test('signed provider upload reports XHR progress and returns verified grant metadata', async () => {
  installApiFetch();
  const progress = [];
  const result = await api.uploadImage(
    new File(['reference'], 'reference.jpg', { type: 'image/jpeg' }),
    'custom-inquiries',
    { onProgress: (value) => progress.push(value) },
  );

  assert.deepEqual(progress, [0, 46, 95, 100]);
  assert.deepEqual(result, {
    url: secureUrl,
    publicId,
    alt: '',
    expiresAt,
  });
});

test('upload progress falls back to fetch when XMLHttpRequest is unavailable', async () => {
  delete globalThis.XMLHttpRequest;
  installApiFetch({ providerViaFetch: true });
  const progress = [];
  await api.uploadImage(
    new File(['reference'], 'reference.webp', { type: 'image/webp' }),
    'custom-inquiries',
    { onProgress: (value) => progress.push(value) },
  );

  assert.deepEqual(progress, [0, 92, 95, 100]);
});

test('product files without MIME metadata use a supported extension and preserve the original bytes', async () => {
  const uploadedFiles = [];
  installApiFetch({ providerViaFetch: true, uploadedFiles });
  const file = new File(['camera-image-bytes'], 'Camera Photo.PNG');
  await api.uploadImage(file, 'products');
  assert.equal(uploadedFiles[0].type, 'image/png');
  assert.equal(uploadedFiles[0].name, file.name);
  assert.equal(await uploadedFiles[0].text(), await file.text());
});

test('fresh uploads can be saved as product images without leaking temporary draft metadata', async () => {
  installApiFetch({ providerViaFetch: true });
  const uploadedImage = await api.uploadImage(new File(['product'], 'product.jpg', { type: 'image/jpeg' }), 'products');
  const draftImages = [{ ...uploadedImage, alt: 'Handmade tray' }];
  const images = productImagesPayload(draftImages);
  const product = {
    name: 'Handmade tray',
    slug: 'handmade-tray',
    category: 'Serving collection',
    shortDescription: 'A handmade tray with a green resin finish.',
    price: 1200,
    images,
  };

  assert.equal(createProductSchema.safeParse(product).success, true);
  assert.equal(updateProductSchema.safeParse({ images }).success, true);
  assert.deepEqual(images, [{ url: secureUrl, publicId, alt: 'Handmade tray' }]);
  assert.equal(draftImages[0].expiresAt, expiresAt);
  assert.equal(createProductSchema.safeParse({ ...product, images: draftImages }).success, false);
});

test('unsupported or conflicting file types are rejected before requesting an upload grant', async () => {
  const requests = [];
  installApiFetch({ providerViaFetch: true, requests });
  for (const file of [
    new File(['svg'], 'drawing.svg'),
    new File(['unsupported'], 'drawing.constructor'),
    new File(['unsupported'], 'drawing.__proto__'),
    new File(['svg'], 'drawing.png', { type: 'image/svg+xml' }),
  ]) {
    await assert.rejects(api.uploadImage(file, 'products'), (error) => error.code === 'INVALID_FILE_TYPE');
  }
  assert.deepEqual(requests, []);
});

test('provider transport errors remain retryable and defer ambiguous cleanup to expiry', async () => {
  const deleted = [];
  installApiFetch({ deleted });
  ProgressXhr.mode = 'error';

  await assert.rejects(
    api.uploadImage(
      new File(['reference'], 'reference.png', { type: 'image/png' }),
      'custom-inquiries',
      { onProgress: () => {} },
    ),
    (error) => error instanceof ApiError && error.code === 'UPLOAD_NETWORK_ERROR',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(deleted, []);
});

test('a verified provider response is cleaned up when server completion fails', async () => {
  const deleted = [];
  const completionRequests = [];
  installApiFetch({ deleted, completionStatus: 502, completionRequests });

  await assert.rejects(
    api.uploadImage(
      new File(['reference'], 'reference.png', { type: 'image/png' }),
      'custom-inquiries',
      { onProgress: () => {} },
    ),
    (error) => error instanceof ApiError && error.code === 'UPLOAD_VERIFICATION_FAILED',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(completionRequests, [publicId, publicId, publicId]);
  assert.deepEqual(deleted, [publicId]);
});

test('temporary verification failures retry the same asset without repeating the upload', async () => {
  const deleted = [];
  const completionRequests = [];
  const requests = [];
  installApiFetch({
    providerViaFetch: true,
    deleted,
    completionRequests,
    requests,
    completionStatuses: [502, 200],
  });

  const result = await api.uploadImage(new File(['product'], 'product.jpg', { type: 'image/jpeg' }), 'products');

  assert.equal(result.url, secureUrl);
  assert.deepEqual(completionRequests, [publicId, publicId]);
  assert.equal(requests.filter((path) => path === '/api/uploads/signature').length, 1);
  assert.equal(requests.filter((path) => path === signature.uploadUrl).length, 1);
  assert.deepEqual(deleted, []);
});

test('in-progress verification is retried but definitive policy failures are not', async () => {
  const completionRequests = [];
  installApiFetch({
    providerViaFetch: true,
    completionRequests,
    completionStatuses: [409, 200],
    completionErrorCode: 'UPLOAD_VERIFICATION_IN_PROGRESS',
  });
  await api.uploadImage(new File(['product'], 'product.png', { type: 'image/png' }), 'products');
  assert.equal(completionRequests.length, 2);

  const rejectedRequests = [];
  const deleted = [];
  installApiFetch({
    providerViaFetch: true,
    completionRequests: rejectedRequests,
    completionStatus: 422,
    completionErrorCode: 'UPLOAD_INVALID',
    deleted,
  });
  await assert.rejects(
    api.uploadImage(new File(['product'], 'product.png', { type: 'image/png' }), 'products'),
    (error) => error.code === 'UPLOAD_INVALID',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rejectedRequests, [publicId]);
  assert.deepEqual(deleted, [publicId]);
});
