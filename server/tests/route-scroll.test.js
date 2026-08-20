import test from 'node:test';
import assert from 'node:assert/strict';
import { routeScrollIntent } from '../../src/utils/route-scroll.js';

test('preserves scroll when only query navigation changes', () => {
  assert.deepEqual(routeScrollIntent({
    previous: { pathname: '/shop', hash: '' },
    pathname: '/shop',
    hash: '',
    navigationType: 'REPLACE',
  }), { type: 'preserve' });

  assert.deepEqual(routeScrollIntent({
    previous: { pathname: '/account', hash: '' },
    pathname: '/account',
    hash: '',
    navigationType: 'REPLACE',
  }), { type: 'preserve' });
});

test('scrolls new pushed pages to the top and leaves POP restoration alone', () => {
  assert.deepEqual(routeScrollIntent({
    previous: { pathname: '/shop', hash: '' },
    pathname: '/cart',
    hash: '',
    navigationType: 'PUSH',
  }), { type: 'top' });

  assert.deepEqual(routeScrollIntent({
    previous: { pathname: '/cart', hash: '' },
    pathname: '/shop',
    hash: '',
    navigationType: 'POP',
  }), { type: 'preserve' });
});

test('scrolls direct and changed hash navigation to its target', () => {
  assert.deepEqual(routeScrollIntent({
    previous: null,
    pathname: '/contact',
    hash: '#faq',
    navigationType: 'POP',
  }), { type: 'hash', hash: 'faq' });

  assert.deepEqual(routeScrollIntent({
    previous: { pathname: '/contact', hash: '' },
    pathname: '/contact',
    hash: '#faq',
    navigationType: 'PUSH',
  }), { type: 'hash', hash: 'faq' });
});

test('scrolls to the top when a hash is removed without changing pages', () => {
  assert.deepEqual(routeScrollIntent({
    previous: { pathname: '/contact', hash: '#faq' },
    pathname: '/contact',
    hash: '',
    navigationType: 'PUSH',
  }), { type: 'top' });

  assert.deepEqual(routeScrollIntent({
    previous: { pathname: '/contact', hash: '#faq' },
    pathname: '/contact',
    hash: '',
    navigationType: 'POP',
  }), { type: 'preserve' });
});
