import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCartLine,
  createDeferredAttachmentCleanup,
  removeCartLine,
  requiresAuthenticatedCartAddition,
} from './cart-actions.js';

const product = {
  id: 'keepsake',
  slug: 'pressed-flower-keepsake',
  title: 'Pressed Flower Keepsake',
  price: 1_600,
};

test('guest cart accepts text personalization while secure media still requires authentication', () => {
  const textOnly = { name: 'Mira', message: 'Happy birthday' };
  assert.equal(requiresAuthenticatedCartAddition(textOnly), false);

  const result = addCartLine([], product, { quantity: 2, customization: textOnly });
  assert.equal(result.cart.length, 1);
  assert.equal(result.cart[0].quantity, 2);
  assert.deepEqual(result.cart[0].customization, textOnly);

  assert.equal(requiresAuthenticatedCartAddition({
    ...textOnly,
    media: { name: 'reference.jpg', pending: true },
  }), true);
});

test('removed cart lines can be restored without changing their customization', () => {
  const original = addCartLine([], product, {
    quantity: 2,
    customization: { name: 'Mira', colour: 'Forest & gold' },
  }).cart;
  const removed = removeCartLine(original, original[0].lineId);
  assert.deepEqual(removed.cart, []);
  assert.deepEqual(removed.item, original[0]);

  const restored = addCartLine(removed.cart, removed.item.product, {
    quantity: removed.item.quantity,
    customization: removed.item.customization,
  }).cart;
  assert.deepEqual(restored, original);
});

test('attachment cleanup waits for the undo window and cancellation prevents deletion', () => {
  let scheduled;
  let cleared = false;
  const deleted = [];
  const item = {
    customization: { media: { publicId: 'gift-n-wrap/orders/reference-1' } },
  };
  const controller = createDeferredAttachmentCleanup(item, {
    delay: 8_000,
    schedule(callback, delay) {
      scheduled = { callback, delay };
      return 42;
    },
    cancelSchedule(timer) {
      assert.equal(timer, 42);
      cleared = true;
    },
    onCleanup(_line, publicId) {
      deleted.push(publicId);
    },
  });

  assert.equal(scheduled.delay, 8_000);
  assert.equal(controller.state, 'pending');
  assert.equal(controller.cancel(), true);
  assert.equal(cleared, true);
  scheduled.callback();
  assert.deepEqual(deleted, []);
  assert.equal(controller.state, 'cancelled');
});

test('attachment cleanup runs once when the undo window expires', () => {
  let expire;
  const deleted = [];
  const controller = createDeferredAttachmentCleanup({
    customization: { media: { publicId: 'gift-n-wrap/orders/reference-2' } },
  }, {
    schedule(callback) {
      expire = callback;
      return 7;
    },
    cancelSchedule() {},
    onCleanup(_line, publicId) {
      deleted.push(publicId);
    },
  });

  expire();
  expire();
  assert.deepEqual(deleted, ['gift-n-wrap/orders/reference-2']);
  assert.equal(controller.state, 'committed');
  assert.equal(controller.cancel(), false);
});
