import assert from 'node:assert/strict';
import test from 'node:test';
import { adminSectionHref, resolveAdminSection } from './admin-navigation.js';

const adminSections = new Set(['dashboard', 'sales', 'orders']);

test('admin sales navigation has a stable query-aware URL', () => {
  assert.equal(adminSectionHref('dashboard'), '/admin');
  assert.equal(adminSectionHref('sales'), '/admin?section=sales');
  assert.equal(resolveAdminSection('sales', adminSections), 'sales');
});

test('unknown admin sections safely return to overview', () => {
  assert.equal(resolveAdminSection('not-a-section', adminSections), 'dashboard');
  assert.equal(resolveAdminSection(null, adminSections), 'dashboard');
});
