import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInstagramProfile } from '../../shared/social-profiles.js';

test('Instagram profiles normalize handles and HTTPS profile URLs', () => {
  assert.deepEqual(normalizeInstagramProfile('@GiftNWrapStudio'), {
    handle: 'giftnwrapstudio',
    label: '@giftnwrapstudio',
    url: 'https://www.instagram.com/giftnwrapstudio/',
  });
  assert.deepEqual(normalizeInstagramProfile('HTTPS://instagram.com/GiftNWrapStudio/?igsh=share'), {
    handle: 'giftnwrapstudio',
    label: '@giftnwrapstudio',
    url: 'https://www.instagram.com/giftnwrapstudio/',
  });
  assert.deepEqual(normalizeInstagramProfile(''), { handle: '', label: '', url: '' });
});

test('Instagram post, reel, non-HTTPS and lookalike URLs are rejected', () => {
  assert.equal(normalizeInstagramProfile('https://www.instagram.com/p/example/'), null);
  assert.equal(normalizeInstagramProfile('https://www.instagram.com/reel/example/'), null);
  assert.equal(normalizeInstagramProfile('http://www.instagram.com/giftnwrapstudio/'), null);
  assert.equal(normalizeInstagramProfile('https://instagram.com.example.test/giftnwrapstudio/'), null);
});
