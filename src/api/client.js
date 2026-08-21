import { normalizeProduct } from '../data/catalog.js';
import { requestAdminOrderWithFallback } from '../utils/admin-api-compat.js';

const API_BASE = (import.meta.env?.VITE_API_URL || '/api').replace(/\/$/, '');
const DEFAULT_TIMEOUT = 12000;
// The storefront filters and sorts the catalogue in the browser, so it needs the whole
// active catalogue rather than the server's first page.
const CATALOG_PAGE_SIZE = 100;
const CATALOG_MAX_PAGES = 20;
const inFlightGetRequests = new Map();

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function performRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT);
  const headers = new Headers(options.headers || {});

  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers,
      body:
        options.body && !(options.body instanceof FormData) && typeof options.body !== 'string'
          ? JSON.stringify(options.body)
          : options.body,
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');

    if (!response.ok) {
      throw new ApiError(
        payload?.error?.message || payload?.message || (typeof payload?.error === 'string' ? payload.error : '') || 'We could not complete that request.',
        {
          status: response.status,
          code: payload?.error?.code || payload?.code || 'REQUEST_FAILED',
          details: payload?.error?.details || payload?.details || null,
        },
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('The studio is taking longer than expected to respond. Please try again.', {
        code: 'TIMEOUT',
      });
    }
    throw new ApiError('We could not reach the studio. Check your connection and try again.', {
      code: 'NETWORK_ERROR',
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return performRequest(path, options).then((payload) => {
      // A successful write can make an overlapping read stale. Removing the
      // entries lets the next revalidation start a fresh request.
      inFlightGetRequests.clear();
      return payload;
    });
  }

  const key = `${API_BASE}${path}`;
  const activeRequest = inFlightGetRequests.get(key);
  if (activeRequest) return activeRequest;

  const requestPromise = performRequest(path, options).finally(() => {
    if (inFlightGetRequests.get(key) === requestPromise) inFlightGetRequests.delete(key);
  });
  inFlightGetRequests.set(key, requestPromise);
  return requestPromise;
}

const reportUploadProgress = (callback, value) => {
  if (typeof callback !== 'function') return;
  try {
    callback(Math.min(100, Math.max(0, Math.round(Number(value) || 0))));
  } catch {
    // A rendering callback must never interrupt a provider upload.
  }
};

const uploadProviderForm = async (uploadUrl, formData, onProgress, signal) => {
  if (typeof onProgress !== 'function' || typeof XMLHttpRequest === 'undefined') {
    reportUploadProgress(onProgress, 0);
    const response = await fetch(uploadUrl, { method: 'POST', body: formData, signal });
    const contentType = response.headers.get('content-type') || '';
    const result = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    reportUploadProgress(onProgress, 92);
    return { ok: response.ok, status: response.status, result };
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.responseType = 'json';
    xhr.timeout = 60_000;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        // Leave the final few percent for the server-side provider verification.
        reportUploadProgress(onProgress, Math.min(92, (event.loaded / event.total) * 92));
      }
    });
    xhr.addEventListener('load', () => {
      let result = xhr.response;
      const responseText = (() => {
        try {
          return xhr.responseText || '';
        } catch {
          return '';
        }
      })();
      if (!result && responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          result = responseText;
        }
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, result });
    });
    xhr.addEventListener('timeout', () => {
      reject(new ApiError(
        'The image upload timed out after 60 seconds. Check your connection and try again.',
        { code: 'UPLOAD_TIMEOUT' },
      ));
    });
    xhr.addEventListener('error', () => {
      reject(new ApiError(
        'The image provider could not be reached. Check your connection and try the upload again.',
        { code: 'UPLOAD_NETWORK_ERROR' },
      ));
    });
    signal?.addEventListener('abort', () => {
      xhr.abort();
      reject(new DOMException('The image upload timed out.', 'AbortError'));
    }, { once: true });
    reportUploadProgress(onProgress, 0);
    xhr.send(formData);
  });
};

async function uploadImage(file, purpose = 'products', { onProgress } = {}) {
  if (!(file instanceof File)) {
    throw new ApiError('Choose an image file to upload.', { code: 'INVALID_FILE' });
  }
  if (!file.size) {
    throw new ApiError('That image is empty. Choose another file.', { code: 'INVALID_FILE' });
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new ApiError('Images must be 8 MB or smaller.', { code: 'FILE_TOO_LARGE' });
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new ApiError('Use a JPG, PNG or WebP image.', { code: 'INVALID_FILE_TYPE' });
  }

  const signatureResult = await request('/uploads/signature', {
    method: 'POST',
    body: { purpose },
  });
  const signature = signatureResult.data || signatureResult;
  const reservedPublicId = String(signature.fullPublicId || signature.reservedPublicId || '');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signature.apiKey);
  formData.append('timestamp', signature.timestamp);
  formData.append('signature', signature.signature);
  formData.append('folder', signature.folder);
  formData.append('upload_preset', signature.upload_preset);
  formData.append('allowed_formats', signature.allowed_formats);
  formData.append('public_id', signature.public_id);
  formData.append('overwrite', String(signature.overwrite));

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  let providerAccepted = false;
  try {
    const providerResponse = await uploadProviderForm(
      signature.uploadUrl || `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`,
      formData,
      onProgress,
      controller.signal,
    );
    const result = providerResponse.result;
    const providerMessage = result?.error?.message
      || result?.message
      || (typeof result === 'string' ? result.trim() : '');
    const expectedPublicId = String(
      signature.fullPublicId
      || signature.reservedPublicId
      || [signature.folder, signature.public_id].filter(Boolean).join('/'),
    );
    const returnedPublicId = String(result?.public_id || '');
    let returnedUrlIsCloudinary = false;
    try {
      const returnedUrl = new URL(result?.secure_url || '');
      returnedUrlIsCloudinary = returnedUrl.protocol === 'https:'
        && returnedUrl.hostname.toLowerCase() === 'res.cloudinary.com';
    } catch {
      returnedUrlIsCloudinary = false;
    }

    if (
      !providerResponse.ok
      || !result?.secure_url
      || !returnedUrlIsCloudinary
      || !returnedPublicId
      || (expectedPublicId && returnedPublicId !== expectedPublicId)
    ) {
      throw new ApiError(
        providerMessage || (providerResponse.ok
          ? 'The image provider did not return the reserved secure image.'
          : `The image provider rejected the upload (${providerResponse.status}).`),
        {
          status: providerResponse.status,
          code: 'UPLOAD_FAILED',
        },
      );
    }
    providerAccepted = true;
    reportUploadProgress(onProgress, 95);
    const completionResult = await request('/uploads/complete', {
      method: 'POST',
      body: { publicId: returnedPublicId },
      timeout: 30_000,
    });
    const completed = completionResult.data || completionResult;
    reportUploadProgress(onProgress, 100);
    return {
      url: completed.url,
      publicId: completed.publicId,
      alt: '',
      ...(signature.expiresAt ? { expiresAt: signature.expiresAt } : {}),
    };
  } catch (error) {
    // A transport failure before a valid provider response is ambiguous: the
    // direct upload may still land after this request fails. Retain that grant
    // for the authoritative expiry sweep instead of risking an orphaned asset.
    if (reservedPublicId && providerAccepted) {
      void deleteUploadedAsset(reservedPublicId).catch(() => {});
    }
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('The image upload timed out after 60 seconds. Check your connection and try again.', {
        code: 'UPLOAD_TIMEOUT',
      });
    }
    throw new ApiError('The image provider could not be reached. Check your connection and try the upload again.', {
      code: 'UPLOAD_NETWORK_ERROR',
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function deleteUploadedAsset(publicId) {
  const normalizedPublicId = String(publicId || '').trim();
  if (!normalizedPublicId) {
    throw new ApiError('The uploaded image identifier is missing.', { code: 'INVALID_UPLOAD_ID' });
  }
  return request('/uploads/asset', {
    method: 'DELETE',
    body: { publicId: normalizedPublicId },
    timeout: 60_000,
  });
}

const searchQuery = (params = {}) =>
  new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
  ).toString();

const analyticsParams = (params = {}) => ({
  range: ['day', 'week', 'month', 'year'].includes(params.range) ? params.range : 'month',
  ...(params.from && params.to ? { from: params.from, to: params.to } : {}),
});

async function downloadAuthenticatedFile(path, fallbackFilename) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiError(
        payload?.error?.message || payload?.message || 'The export could not be prepared.',
        {
          status: response.status,
          code: payload?.error?.code || payload?.code || 'EXPORT_FAILED',
          details: payload?.error?.details || payload?.details || null,
        },
      );
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('spreadsheetml') && !contentType.includes('application/octet-stream')) {
      throw new ApiError('The server returned an unexpected export file.', { code: 'INVALID_EXPORT' });
    }
    const disposition = response.headers.get('content-disposition') || '';
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const quotedFilename = disposition.match(/filename="([^"]+)"/i)?.[1];
    const filename = String(
      (encodedFilename ? decodeURIComponent(encodedFilename) : quotedFilename) || fallbackFilename,
    ).replace(/[^a-z0-9._ -]/gi, '-');
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    return { filename };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('The Excel export took too long. Please try again.', { code: 'EXPORT_TIMEOUT' });
    }
    throw new ApiError('The Excel export could not be downloaded. Check your connection and try again.', { code: 'EXPORT_NETWORK_ERROR' });
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  async getProducts(params = {}) {
    const query = searchQuery(params);
    const result = await request(`/products${query ? `?${query}` : ''}`);
    const meta = result.meta || {};
    return {
      products: (result.products || result.data || []).map(normalizeProduct),
      page: Number(meta.page || 1),
      totalPages: Number(meta.totalPages || 1),
      total: Number(meta.total ?? (result.data || []).length),
    };
  },

  // Walks every page so client-side filtering and sorting see the whole active catalogue
  // instead of silently operating on the server's first page.
  async getAllProducts(params = {}) {
    const products = [];
    let page = 1;
    let totalPages;
    let total;

    do {
      const result = await api.getProducts({ ...params, page, limit: CATALOG_PAGE_SIZE });
      products.push(...result.products);
      totalPages = result.totalPages;
      total = result.total;
      page += 1;
    } while (page <= totalPages && page <= CATALOG_MAX_PAGES);

    return { products, total, truncated: totalPages > CATALOG_MAX_PAGES };
  },

  async getProduct(slug) {
    const result = await request(`/products/${encodeURIComponent(slug)}`);
    return { product: normalizeProduct(result.product || result.data || result) };
  },

  getCurrentUser: () => request('/auth/me'),
  getAuthStatus: () => request('/auth/status'),
  authenticateGoogle: (credential, intent) => request('/auth/google', { method: 'POST', body: { credential, intent } }),
  startEmailAuthentication: ({ email, name, intent }) => request('/auth/email/start', {
    method: 'POST',
    body: { email, ...(name ? { name } : {}), intent },
  }),
  verifyEmailAuthentication: ({ challengeId, code }) => request('/auth/email/verify', {
    method: 'POST',
    body: { challengeId, code },
  }),
  authenticateDemo: (role) => request('/auth/demo', { method: 'POST', body: { role } }),
  signOut: () => request('/auth/logout', { method: 'POST' }),
  submitOrderRequest: (payload, idempotencyKey, expectedUserId) => request('/orders', {
    method: 'POST',
    body: payload,
    timeout: 45_000,
    headers: {
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(expectedUserId ? { 'X-Expected-User-Id': expectedUserId } : {}),
    },
  }),
  createRazorpayPaymentSession: (orderId, idempotencyKey, expectedUserId, policyConsent) => request(
    `/payments/razorpay/orders/${encodeURIComponent(orderId)}/session`,
    {
      method: 'POST',
      body: { policyConsent },
      headers: {
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...(expectedUserId ? { 'X-Expected-User-Id': expectedUserId } : {}),
      },
    },
  ),
  confirmRazorpayPayment: (payload, expectedUserId) => request('/payments/razorpay/confirm', {
    method: 'POST',
    body: payload,
    timeout: 30_000,
    headers: expectedUserId ? { 'X-Expected-User-Id': expectedUserId } : {},
  }),
  getOrderPayment: (orderId) => request(`/payments/orders/${encodeURIComponent(orderId)}`),
  submitCustomRequest: (payload, expectedUserId) => request('/custom-inquiries', {
    method: 'POST',
    body: payload,
    headers: expectedUserId ? { 'X-Expected-User-Id': expectedUserId } : {},
  }),
  submitContact: (payload, expectedUserId) => request('/contact', {
    method: 'POST',
    body: payload,
    headers: expectedUserId ? { 'X-Expected-User-Id': expectedUserId } : {},
  }),
  getBuyerOrders: (params = {}) => {
    const query = searchQuery(params);
    return request(`/orders/my${query ? `?${query}` : ''}`);
  },

  // The account page has no pager, so fetch every request rather than stopping at the
  // server's default page and silently hiding older orders.
  async getAllBuyerOrders() {
    const orders = [];
    let page = 1;
    let totalPages;

    do {
      const result = await api.getBuyerOrders({ page, limit: 50 });
      orders.push(...(result.data || result.orders || []));
      totalPages = Number(result.meta?.totalPages || 1);
      page += 1;
    } while (page <= totalPages && page <= 20);

    return orders;
  },

  getAdminSummary: () => request('/admin/dashboard'),
  getAdminSalesAnalytics: (params = {}) => {
    const query = searchQuery(analyticsParams(params));
    return request(`/admin/analytics?${query}`);
  },
  downloadAdminSalesAnalyticsExcel: (params = {}) => {
    const query = searchQuery(analyticsParams(params));
    return downloadAuthenticatedFile(`/admin/analytics/export.xlsx?${query}`, 'gift-n-wrap-sales.xlsx');
  },
  getAdminProducts: (params = {}) => {
    const query = searchQuery(params);
    return request(`/admin/products${query ? `?${query}` : ''}`);
  },
  getAdminProduct: (productId) => request(`/admin/products/${encodeURIComponent(productId)}`),
  createAdminProduct: (payload) => request('/admin/products', { method: 'POST', body: payload }),
  updateAdminProduct: (productId, payload) =>
    request(`/admin/products/${encodeURIComponent(productId)}`, { method: 'PATCH', body: payload }),
  archiveAdminProduct: (productId) =>
    request(`/admin/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
  getAdminSettings: () => request('/admin/settings'),
  updateAdminSettings: (payload) => request('/admin/settings', { method: 'PUT', body: payload }),
  getAdminUsers: (params = {}) => {
    const query = searchQuery(params);
    return request(`/admin/users${query ? `?${query}` : ''}`);
  },
  getAdminUser: (userId) => request(`/admin/users/${encodeURIComponent(userId)}`),
  getAdminOrders: (params = {}) => {
    const query = searchQuery(params);
    return request(`/admin/orders${query ? `?${query}` : ''}`);
  },
  getAdminOrder: (orderId) => requestAdminOrderWithFallback(request, orderId),
  getAdminInquiries: (params = {}) => {
    const query = searchQuery(params);
    return request(`/admin/custom-inquiries${query ? `?${query}` : ''}`);
  },
  getAdminContacts: (params = {}) => {
    const query = searchQuery(params);
    return request(`/admin/contacts${query ? `?${query}` : ''}`);
  },
  updateOrderStatus: (orderId, update) =>
    request(`/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: typeof update === 'string' ? { status: update } : update,
    }),
  publishAdminPaymentQuote: (orderId, payload) =>
    request(`/admin/orders/${encodeURIComponent(orderId)}/payment-quote`, {
      method: 'POST',
      body: payload,
    }),
  refundAdminOrderPayment: (orderId, payload, idempotencyKey) =>
    request(`/admin/orders/${encodeURIComponent(orderId)}/refunds`, {
      method: 'POST',
      body: payload,
      timeout: 30_000,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    }),
  updateInquiryStatus: (inquiryId, update) =>
    request(`/admin/custom-inquiries/${encodeURIComponent(inquiryId)}`, {
      method: 'PATCH',
      body: typeof update === 'string' ? { status: update } : update,
    }),
  updateContactStatus: (contactId, update) =>
    request(`/admin/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      body: typeof update === 'string' ? { status: update } : update,
    }),
  getWelcomeOffer: () => request('/offers/welcome'),
  getPublicSettings: () => request('/settings'),
  getReviews: () => request('/reviews'),
  getMyReviews: () => request('/reviews/mine'),
  getEligibleReviews: () => request('/reviews/eligible'),
  createReview: (payload, expectedUserId) => request('/reviews', {
    method: 'POST',
    body: payload,
    headers: expectedUserId ? { 'X-Expected-User-Id': expectedUserId } : {},
  }),
  updateReview: (reviewId, payload, expectedUserId) =>
    request(`/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'PATCH',
      body: payload,
      headers: expectedUserId ? { 'X-Expected-User-Id': expectedUserId } : {},
    }),
  requestUploadSignature: (payload) =>
    request('/uploads/signature', { method: 'POST', body: payload }),
  uploadImage,
  deleteUploadedAsset,
};
