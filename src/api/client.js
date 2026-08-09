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
  authenticateGoogle: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),
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
  getAdminOrders: () => request('/admin/orders'),
  getAdminInquiries: () => request('/admin/custom-inquiries'),
  getAdminContacts: () => request('/admin/contacts'),
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
  requestUploadSignature: (payload) =>
    request('/uploads/signature', { method: 'POST', body: payload }),
};
