import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInboxStatusUpdate,
  canRetryInquiryStatusWithoutSnapshot,
  orderContactSnapshot,
  parseOrderCustomization,
} from './admin-order-details.js';

test('admin order details retain every customer-facing personalization field and safe media', () => {
  const parsed = parseOrderCustomization(JSON.stringify({
    name: 'Aarya & Kabir',
    date: '2026-12-04',
    colour: 'Forest & gold',
    finish: 'Gold foil',
    message: 'Preserve the invitation flowers.',
    extraOptions: ['Pearl edge', 'Gift wrap'],
    media: {
      name: 'wedding-reference.png',
      url: 'https://res.cloudinary.com/studio/image/upload/reference.png',
      publicId: 'private-provider-id',
      expiresAt: '2026-08-22T00:00:00.000Z',
    },
  }));

  assert.deepEqual(parsed.fields.map(({ label }) => label), [
    'Name or initials',
    'Special date',
    'Colour story',
    'Metallic finish',
    'Artist notes',
    'Extra Options',
    'Reference file',
  ]);
  assert.equal(parsed.media.length, 1);
  assert.equal(parsed.media[0].name, 'wedding-reference.png');
  assert.doesNotMatch(JSON.stringify(parsed), /private-provider-id|expiresAt/);
  assert.equal(parseOrderCustomization(JSON.stringify({ media: { url: 'https://example.test/untrusted.jpg' } })).media.length, 0);
});

test('admin order details support legacy text personalization and legacy checkout notes', () => {
  assert.deepEqual(parseOrderCustomization('Hand-letter “Mira” in gold').fields, [
    { label: 'Personalization', value: 'Hand-letter “Mira” in gold' },
  ]);
  assert.deepEqual(orderContactSnapshot({
    note: 'Needed by: 2026-11-12\nPreferred contact: WhatsApp\nPlease call before delivery.',
  }), {
    neededBy: '2026-11-12',
    contactPreference: 'WhatsApp',
    customerNote: 'Please call before delivery.',
  });
});

test('status metadata compatibility retry is limited to rejected forward snapshots', () => {
  const error = {
    status: 422,
    code: 'VALIDATION_ERROR',
    details: [{ field: '', message: 'Unrecognized keys: "expectedStatus"' }],
  };
  assert.equal(canRetryInquiryStatusWithoutSnapshot({ error, expectedStatus: 'new', undo: false }), true);
  assert.equal(canRetryInquiryStatusWithoutSnapshot({ error, expectedStatus: 'accepted', undo: true }), false);
  assert.equal(canRetryInquiryStatusWithoutSnapshot({ error: { ...error, status: 409 }, expectedStatus: 'new', undo: false }), false);
});

test('blank optional inbox notes preserve an earlier reply during status changes', () => {
  assert.deepEqual(buildInboxStatusUpdate({
    status: 'closed',
    adminNote: '   ',
    expectedStatus: 'accepted',
  }), {
    status: 'closed',
    expectedStatus: 'accepted',
  });
  assert.deepEqual(buildInboxStatusUpdate({
    status: 'quoted',
    adminNote: '  Revised quote: ₹4,250  ',
    expectedStatus: 'contacted',
  }), {
    status: 'quoted',
    adminNote: 'Revised quote: ₹4,250',
    expectedStatus: 'contacted',
  });
});
