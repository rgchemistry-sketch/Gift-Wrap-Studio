import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeFacebookProfile,
  normalizeInstagramProfile,
} from '../../shared/social-profiles.js';

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

test('Facebook handles, vanity pages and numeric profile URLs normalize safely', () => {
  assert.deepEqual(normalizeFacebookProfile('@GiftNWrapStudio'), {
    handle: 'giftnwrapstudio',
    label: '@giftnwrapstudio',
    url: 'https://www.facebook.com/giftnwrapstudio/',
  });
  assert.deepEqual(normalizeFacebookProfile('https://m.facebook.com/GiftNWrapStudio/?ref=share'), {
    handle: 'giftnwrapstudio',
    label: '@giftnwrapstudio',
    url: 'https://www.facebook.com/giftnwrapstudio/',
  });
  assert.deepEqual(normalizeFacebookProfile('https://facebook.com/profile.php?id=123456789'), {
    handle: '',
    label: 'Facebook profile',
    url: 'https://www.facebook.com/profile.php?id=123456789',
  });
});

test('Facebook share, group, non-HTTPS and lookalike URLs are rejected', () => {
  assert.equal(normalizeFacebookProfile('https://www.facebook.com/share/example/'), null);
  assert.equal(normalizeFacebookProfile('https://www.facebook.com/groups/example/'), null);
  assert.equal(normalizeFacebookProfile('http://www.facebook.com/giftnwrapstudio/'), null);
  assert.equal(normalizeFacebookProfile('https://facebook.com.example.test/giftnwrapstudio/'), null);
});
