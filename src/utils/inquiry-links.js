import { normalizeIndianMobile } from '../../shared/indian-phone.js';

const encodedPair = (key, value) => `${key}=${encodeURIComponent(String(value))}`;

export function createWhatsAppHref(phone, message = '') {
  const normalizedPhone = normalizeIndianMobile(phone);
  if (!normalizedPhone) return '';
  const recipient = normalizedPhone.replace(/\D/g, '');
  const cleanMessage = String(message || '').trim();
  return `https://wa.me/${recipient}${cleanMessage ? `?text=${encodeURIComponent(cleanMessage)}` : ''}`;
}

export function createEmailHref(email, { subject = '', body = '' } = {}) {
  const address = String(email || '').trim();
  if (!address) return '';
  const query = [
    subject ? encodedPair('subject', subject) : '',
    body ? encodedPair('body', body) : '',
  ].filter(Boolean).join('&');
  return `mailto:${address}${query ? `?${query}` : ''}`;
}

export function createProductInquiryText({ message, productTitle, productUrl }) {
  return [
    String(message || '').trim(),
    `Product: ${String(productTitle || '').trim()}`,
    `Link: ${String(productUrl || '').trim()}`,
  ].filter(Boolean).join('\n\n');
}
