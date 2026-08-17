import assert from 'node:assert/strict';
import { test } from 'node:test';
import { optimizeCloudinaryImage } from '../../src/utils/cloudinary-image.js';

test('Cloudinary admin thumbnails request a bounded automatic delivery format', () => {
  assert.equal(
    optimizeCloudinaryImage(
      'https://res.cloudinary.com/demo/image/upload/v123/products/clock.jpg',
      480,
    ),
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_480/v123/products/clock.jpg',
  );
  assert.equal(
    optimizeCloudinaryImage(
      'https://res.cloudinary.com/demo/image/upload/v123/products/clock.jpg',
      9000,
    ),
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_2400/v123/products/clock.jpg',
  );
});

test('non-Cloudinary, relative, and signed image URLs remain unchanged', () => {
  assert.equal(optimizeCloudinaryImage('/assets/products/clock.webp', 480), '/assets/products/clock.webp');
  assert.equal(
    optimizeCloudinaryImage('https://images.example.com/clock.jpg', 480),
    'https://images.example.com/clock.jpg',
  );
  assert.equal(
    optimizeCloudinaryImage('https://res.cloudinary.com/demo/image/upload/s--signature--/v1/clock.jpg', 480),
    'https://res.cloudinary.com/demo/image/upload/s--signature--/v1/clock.jpg',
  );
});
