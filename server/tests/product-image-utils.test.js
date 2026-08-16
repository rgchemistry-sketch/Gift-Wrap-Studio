import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  imageFromReusableUrl,
  moveProductImage,
  normalizeProductImageUrl,
  verifyProductImageUrl,
} from '../../src/components/admin/product-image-utils.js';

test('product image URLs allow site assets and Cloudinary HTTPS only', () => {
  assert.equal(normalizeProductImageUrl(' /assets/products/clock.webp '), '/assets/products/clock.webp');
  assert.equal(
    normalizeProductImageUrl('https://res.cloudinary.com/demo/image/upload/v1/products/clock.webp'),
    'https://res.cloudinary.com/demo/image/upload/v1/products/clock.webp',
  );
  assert.equal(normalizeProductImageUrl('//res.cloudinary.com/demo/image/upload/clock.webp'), '');
  assert.equal(normalizeProductImageUrl('http://res.cloudinary.com/demo/image/upload/clock.webp'), '');
  assert.equal(normalizeProductImageUrl('https://example.com/clock.webp'), '');
  assert.equal(normalizeProductImageUrl('not-a-url'), '');
});

test('re-adding an original image URL preserves its Cloudinary ownership metadata', () => {
  const original = {
    url: 'https://res.cloudinary.com/demo/image/upload/v1/products/clock.webp',
    publicId: 'gift-n-wrap/products/clock',
    alt: 'Emerald resin clock',
  };

  assert.deepEqual(
    imageFromReusableUrl({
      url: original.url,
      initialImages: [original],
      defaultAlt: 'Replacement text',
    }),
    original,
  );
  assert.deepEqual(
    imageFromReusableUrl({
      url: '/assets/products/new-clock.webp',
      initialImages: [original],
      defaultAlt: 'New clock',
    }),
    {
      url: '/assets/products/new-clock.webp',
      publicId: '',
      alt: 'New clock',
    },
  );
});

test('gallery moves are immutable and retain complete image records', () => {
  const cover = { url: '/cover.webp', publicId: 'products/cover', alt: 'Cover' };
  const detail = { url: '/detail.webp', publicId: 'products/detail', alt: 'Detail' };
  const gallery = [cover, detail];
  const reordered = moveProductImage(gallery, 1, 0);

  assert.deepEqual(reordered, [detail, cover]);
  assert.deepEqual(gallery, [cover, detail]);
  assert.equal(reordered[0], detail);
  assert.deepEqual(moveProductImage(gallery, 4, 0), gallery);
  assert.notEqual(moveProductImage(gallery, 4, 0), gallery);
});

test('image URL verification resolves dimensions only after a usable image loads', async () => {
  class LoadedImage {
    set src(value) {
      this.requestedUrl = value;
      this.naturalWidth = 1200;
      this.naturalHeight = 800;
      queueMicrotask(() => this.onload?.());
    }
  }

  const dimensions = await verifyProductImageUrl('/assets/products/clock.webp', {
    ImageConstructor: LoadedImage,
    timeoutMs: 100,
  });
  assert.deepEqual(dimensions, { width: 1200, height: 800 });
});

test('image URL verification rejects a URL that does not load', async () => {
  class FailedImage {
    set src(_value) {
      queueMicrotask(() => this.onerror?.());
    }
  }

  await assert.rejects(
    verifyProductImageUrl('/assets/products/missing.webp', {
      ImageConstructor: FailedImage,
      timeoutMs: 100,
    }),
    /could not be loaded/i,
  );
});
