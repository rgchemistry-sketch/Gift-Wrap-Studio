import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { api, ApiError } from './client.js';

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
} = {}) => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target === '/api/uploads/signature') return jsonResponse({ data: signature });
    if (target === signature.uploadUrl && providerViaFetch) return jsonResponse(providerResult);
    if (target === '/api/uploads/complete') {
      if (completionStatus !== 200) {
        return jsonResponse({
          error: {
            code: 'UPLOAD_VERIFICATION_FAILED',
            message: 'The provider upload could not be verified.',
          },
        }, completionStatus);
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
  installApiFetch({ deleted, completionStatus: 502 });

  await assert.rejects(
    api.uploadImage(
      new File(['reference'], 'reference.png', { type: 'image/png' }),
      'custom-inquiries',
      { onProgress: () => {} },
    ),
    (error) => error instanceof ApiError && error.code === 'UPLOAD_VERIFICATION_FAILED',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(deleted, [publicId]);
});
