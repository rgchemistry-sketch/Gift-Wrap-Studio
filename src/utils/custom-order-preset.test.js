import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCorporateBriefPreset } from './custom-order-preset.js';

test('corporate brief context overrides a personal draft without erasing real answers', () => {
  assert.deepEqual(applyCorporateBriefPreset({
    requestKind: 'personal',
    occasion: 'Birthday',
    productType: 'Wall clock',
    contactPreference: 'WhatsApp',
    description: 'Branded anniversary awards for our long-serving team.',
  }), {
    requestKind: 'corporate',
    occasion: 'Corporate event',
    productType: 'Wall clock',
    contactPreference: 'WhatsApp',
    description: 'Branded anniversary awards for our long-serving team.',
  });
});

test('a fresh corporate brief receives useful corporate defaults', () => {
  const result = applyCorporateBriefPreset({
    requestKind: 'personal',
    occasion: '',
    productType: '',
    contactPreference: 'WhatsApp',
  }, { preserveAnswers: false });

  assert.equal(result.requestKind, 'corporate');
  assert.equal(result.occasion, 'Corporate event');
  assert.equal(result.productType, 'Corporate gifts');
  assert.equal(result.contactPreference, 'Email');
});

test('reapplying corporate context is idempotent and preserves in-progress answers', () => {
  const first = applyCorporateBriefPreset({
    productType: 'Serving piece',
    contactPreference: 'Phone call',
    company: 'Northstar Labs',
  });

  assert.deepEqual(applyCorporateBriefPreset(first), first);
});
