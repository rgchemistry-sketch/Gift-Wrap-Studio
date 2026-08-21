import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customInquiryPayload,
  customOrderStepErrors,
  isCorporateCustomOrder,
  selectCustomOrderProductType,
} from './custom-order-validation.js';

const validForm = {
  requestKind: 'personal',
  productType: 'Wall clock',
  description: 'A forest green clock for a wedding gift.',
  personalization: 'Names and the wedding date.',
  referenceUrl: '',
  name: 'Aarav Mehta',
  email: 'aarav@example.com',
  phone: '9876543210',
};

test('custom order validation returns errors beside every invalid field in a step', () => {
  assert.deepEqual(customOrderStepErrors({ ...validForm, productType: '', description: 'short' }, 0), {
    productType: 'Choose the kind of piece you have in mind.',
    description: 'Describe your idea in at least 10 characters.',
  });
  assert.deepEqual(customOrderStepErrors({ ...validForm, personalization: '', referenceUrl: 'ftp://example.com/file' }, 1), {
    personalization: 'Tell us which names, dates, photos, logo or details should be included.',
    referenceUrl: 'Enter a complete HTTP or HTTPS reference link.',
  });
});

test('corporate preset requires company and quantity', () => {
  const form = { ...validForm, requestKind: 'corporate', company: '', quantity: '2.5' };
  assert.equal(isCorporateCustomOrder(form), true);
  assert.deepEqual(customOrderStepErrors(form, 0), {
    company: 'Enter the company or organisation name.',
    quantity: 'Enter a whole-number quantity between 1 and 100,000.',
  });
});

test('choosing a non-corporate product exits corporate mode without erasing saved answers', () => {
  const corporateDraft = {
    ...validForm,
    requestKind: 'corporate',
    // A corporate URL intentionally preserves a saved product answer. The
    // selected radio can therefore already be non-corporate when it is clicked.
    productType: 'Wall clock',
    company: 'Northstar Labs',
    quantity: '75',
  };
  const personal = selectCustomOrderProductType(corporateDraft, 'Wall clock');
  assert.equal(personal.requestKind, 'personal');
  assert.equal(isCorporateCustomOrder(personal), false);
  assert.equal(personal.company, 'Northstar Labs');
  assert.equal(personal.quantity, '75');
  assert.equal(customOrderStepErrors(personal, 0).company, undefined);

  const corporateAgain = selectCustomOrderProductType(personal, 'Corporate gifts');
  assert.equal(corporateAgain.requestKind, 'corporate');
  assert.equal(corporateAgain.company, 'Northstar Labs');
});

test('needed-by remains optional but cannot be an already-past delivery target', () => {
  assert.equal(customOrderStepErrors({ ...validForm, neededBy: '' }, 0).neededBy, undefined);
  assert.equal(
    customOrderStepErrors({ ...validForm, neededBy: '1900-01-01' }, 0).neededBy,
    'Choose today or a future date for “Needed by”.',
  );
});

test('corporate context is safely folded into the supported inquiry description', () => {
  const payload = customInquiryPayload({
    ...validForm,
    requestKind: 'corporate',
    productType: 'Corporate gifts',
    company: 'Northstar Labs',
    quantity: '75',
    occasion: 'Corporate event',
    palette: '',
    budget: '',
    neededBy: '',
    contactPreference: 'Email',
  }, 'verified@example.com');

  assert.equal(payload.email, 'verified@example.com');
  assert.equal(payload.phone, '+919876543210');
  assert.match(payload.description, /Company \/ organisation: Northstar Labs/);
  assert.match(payload.description, /Estimated quantity: 75/);
  assert.equal('company' in payload, false);
  assert.equal('quantity' in payload, false);
  assert.equal('requestKind' in payload, false);
});

test('custom inquiry payload includes only verified owner-scoped reference URLs', () => {
  const ownerId = 'buyer-a';
  const publicId = `gift-n-wrap/custom-inquiries/${ownerId}/123e4567-e89b-12d3-a456-426614174000`;
  const url = `https://res.cloudinary.com/studio-cloud/image/upload/v9/${publicId}.webp`;
  const payload = customInquiryPayload({
    ...validForm,
    referenceImages: [{
      name: 'inspiration.webp',
      publicId,
      url,
      expiresAt: '2030-01-01T00:00:00.000Z',
    }],
  }, 'verified@example.com', ownerId);

  assert.deepEqual(payload.referenceImages, [url]);
});
