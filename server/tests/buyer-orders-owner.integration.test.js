import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_AUTH = 'true';
process.env.JWT_SECRET = 'buyer-orders-test-session-secret-long-enough';
delete process.env.MONGODB_URI;

const [{ default: app }, { memoryStore, resetMemoryStore }] = await Promise.all([
  import('../app.js'),
  import('../lib/memory-store.js'),
]);

beforeEach(() => resetMemoryStore());

test('buyer order reads enforce the expected account and remain compatible without the optional header', async () => {
  const buyer = request.agent(app);
  const signIn = await buyer.post('/api/auth/demo').send({ role: 'buyer' }).expect(200);
  const ownerId = signIn.body.data.user.id;
  for (const [buyerId, orderNumber] of [[ownerId, 'MY-ORDER'], ['another-buyer', 'OTHER-PRIVATE-ORDER']]) {
    memoryStore.create('orders', {
      buyerId,
      orderNumber,
      buyerName: 'Test buyer',
      buyerEmail: 'buyer@example.test',
      status: 'placed',
      items: [],
      total: 1000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const matching = await buyer.get('/api/orders/my').set('X-Expected-User-Id', ownerId).expect(200);
  assert.deepEqual(matching.body.data.map((order) => order.orderNumber), ['MY-ORDER']);
  const stale = await buyer.get('/api/orders/my').set('X-Expected-User-Id', 'another-buyer').expect(409);
  assert.equal(stale.body.error.code, 'SESSION_IDENTITY_CHANGED');
  assert.equal(stale.body.data, undefined);
  const unscoped = await buyer.get('/api/orders/my').expect(200);
  assert.deepEqual(unscoped.body.data.map((order) => order.orderNumber), ['MY-ORDER']);
});
