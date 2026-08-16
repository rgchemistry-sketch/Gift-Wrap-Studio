import { demoProducts, findDemoProduct, normalizeProduct } from '../data/catalog';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const DEFAULT_TIMEOUT = 12000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
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

async function uploadImage(file, purpose = 'products') {
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
  formData.append('transformation', signature.transformation);
  formData.append('public_id', signature.public_id);
  formData.append('overwrite', String(signature.overwrite));

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(
      signature.uploadUrl || `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`,
      { method: 'POST', body: formData, signal: controller.signal },
    );
    const contentType = response.headers.get('content-type') || '';
    const result = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
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
      !response.ok
      || !result?.secure_url
      || !returnedUrlIsCloudinary
      || !returnedPublicId
      || (expectedPublicId && returnedPublicId !== expectedPublicId)
    ) {
      throw new ApiError(
        providerMessage || (response.ok
          ? 'The image provider did not return the reserved secure image.'
          : `The image provider rejected the upload (${response.status}).`),
        {
          status: response.status,
          code: 'UPLOAD_FAILED',
        },
      );
    }
    return {
      url: result.secure_url,
      publicId: returnedPublicId,
      alt: '',
      ...(purpose === 'orders' && signature.expiresAt ? { expiresAt: signature.expiresAt } : {}),
    };
  } catch (error) {
    if (reservedPublicId) {
      const ambiguousProviderResult = error?.name === 'AbortError' || !(error instanceof ApiError);
      const removeReservation = () => {
        void deleteUploadedAsset(reservedPublicId).catch(() => {});
      };
      if (ambiguousProviderResult) window.setTimeout(removeReservation, 10_000);
      else removeReservation();
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

export const api = {
  async getProducts(params = {}) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    ).toString();
    try {
      const result = await request(`/products${query ? `?${query}` : ''}`);
      return { products: (result.products || result.data || []).map(normalizeProduct), source: 'api' };
    } catch (error) {
      if (error.status && error.status !== 404) throw error;
      return { products: demoProducts, source: 'studio-preview' };
    }
  },

  async getProduct(slug) {
    try {
      const result = await request(`/products/${encodeURIComponent(slug)}`);
      return { product: normalizeProduct(result.product || result.data || result), source: 'api' };
    } catch (error) {
      const demo = findDemoProduct(slug);
      if (demo && (!error.status || error.status === 404 || error.status >= 500)) {
        return { product: demo, source: 'studio-preview' };
      }
      throw error;
    }
  },

  getCurrentUser: () => request('/auth/me'),
  getAuthStatus: () => request('/auth/status'),
  authenticateGoogle: (credential, intent) => request('/auth/google', { method: 'POST', body: { credential, intent } }),
  authenticateFacebook: (accessToken, intent) => request('/auth/facebook', {
    method: 'POST',
    body: { accessToken, intent },
  }),
  requestAppleNonce: () => request('/auth/apple/nonce', { method: 'POST' }),
  authenticateApple: ({ idToken, nonceId, name, intent }) => request('/auth/apple', {
    method: 'POST',
    body: { idToken, nonceId, intent, ...(name ? { name } : {}) },
  }),
  startEmailAuthentication: ({ email, name, intent }) => request('/auth/email/start', {
    method: 'POST',
    body: { email, ...(name ? { name } : {}), intent },
  }),
  verifyEmailAuthentication: ({ challengeId, code }) => request('/auth/email/verify', {
    method: 'POST',
    body: { challengeId, code },
  }),
  getPhoneAuthStatus: () => request('/auth/phone/status'),
  startPhoneAuthentication: ({ credential, email, phone, intent }) =>
    request('/auth/phone/start', {
      method: 'POST',
      body: { credential, email, phone, intent },
    }),
  verifyPhoneAuthentication: ({ challengeId, code }) =>
    request('/auth/phone/verify', {
      method: 'POST',
      body: { challengeId, code },
    }),
  authenticateDemo: (role) => request('/auth/demo', { method: 'POST', body: { role } }),
  signOut: () => request('/auth/logout', { method: 'POST' }),
  submitOrderRequest: (payload, idempotencyKey) => request('/orders', {
    method: 'POST',
    body: payload,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  }),
  submitCustomRequest: (payload) => request('/custom-inquiries', { method: 'POST', body: payload }),
  submitContact: (payload) => request('/contact', { method: 'POST', body: payload }),
  getBuyerOrders: () => request('/orders/my'),
  getAdminSummary: () => request('/admin/dashboard'),
  getAdminProducts: () => request('/admin/products'),
  createAdminProduct: (payload) => request('/admin/products', { method: 'POST', body: payload }),
  updateAdminProduct: (productId, payload) =>
    request(`/admin/products/${encodeURIComponent(productId)}`, { method: 'PATCH', body: payload }),
  archiveAdminProduct: (productId) =>
    request(`/admin/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
  getAdminSettings: () => request('/admin/settings'),
  updateAdminSettings: (payload) => request('/admin/settings', { method: 'PUT', body: payload }),
  getAdminUsers: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    ).toString();
    return request(`/admin/users${query ? `?${query}` : ''}`);
  },
  getAdminUser: (userId) => request(`/admin/users/${encodeURIComponent(userId)}`),
  getAdminOrders: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    ).toString();
    return request(`/admin/orders${query ? `?${query}` : ''}`);
  },
  getAdminInquiries: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    ).toString();
    return request(`/admin/custom-inquiries${query ? `?${query}` : ''}`);
  },
  getAdminContacts: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    ).toString();
    return request(`/admin/contacts${query ? `?${query}` : ''}`);
  },
  updateOrderStatus: (orderId, status) =>
    request(`/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: { status },
    }),
  updateInquiryStatus: (inquiryId, status) =>
    request(`/admin/custom-inquiries/${encodeURIComponent(inquiryId)}`, {
      method: 'PATCH',
      body: { status },
    }),
  updateContactStatus: (contactId, status) =>
    request(`/admin/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      body: { status },
    }),
  getWelcomeOffer: () => request('/offers/welcome'),
  getPublicSettings: () => request('/settings'),
  requestUploadSignature: (payload) =>
    request('/uploads/signature', { method: 'POST', body: payload }),
  uploadImage,
  deleteUploadedAsset,
};
