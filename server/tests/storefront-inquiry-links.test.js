import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmailHref,
  createProductInquiryText,
  createWhatsAppHref,
} from '../../src/utils/inquiry-links.js';

test('WhatsApp inquiry links use the configured Indian mobile and encode the message', () => {
  assert.equal(
    createWhatsAppHref('098765 43210', 'Hello & नमस्ते'),
    `https://wa.me/919876543210?text=${encodeURIComponent('Hello & नमस्ते')}`,
  );
  assert.equal(createWhatsAppHref('', 'Hello'), '');
  assert.equal(createWhatsAppHref('12345', 'Hello'), '');
});

test('email inquiry links encode the configured recipient, subject, and body', () => {
  assert.equal(
    createEmailHref('studio@example.test', {
      subject: 'Inquiry: A & R plaque',
      body: 'Could you help?\nhttps://example.test/product/a-r',
    }),
    `mailto:studio@example.test?subject=${encodeURIComponent('Inquiry: A & R plaque')}&body=${encodeURIComponent('Could you help?\nhttps://example.test/product/a-r')}`,
  );
  assert.equal(createEmailHref('', { subject: 'Inquiry' }), '');
});

test('product inquiry text always carries the exact product identity and URL', () => {
  assert.equal(
    createProductInquiryText({
      message: '  Can this be made in forest green?  ',
      productTitle: 'Pressed Flower Name Plaque',
      productUrl: 'https://www.giftnwrapstudio.com/product/pressed-flower-name-plaque',
    }),
    'Can this be made in forest green?\n\nProduct: Pressed Flower Name Plaque\n\nLink: https://www.giftnwrapstudio.com/product/pressed-flower-name-plaque',
  );
});
