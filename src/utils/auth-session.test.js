import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionSynchronizer, sameSessionUser } from './auth-session.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('focus, visibility and storage events share one current session request', async () => {
  const response = deferred();
  const results = [];
  let reads = 0;
  let settled = 0;
  const sync = createSessionSynchronizer({
    readSession: () => { reads += 1; return response.promise; },
    canCheck: () => true,
    onResult: (value) => results.push(value),
    onError: assert.fail,
    onSettled: () => { settled += 1; },
  });
  const focus = sync.check();
  const visibility = sync.check();
  const storage = sync.check();
  assert.equal(focus, visibility);
  assert.equal(focus, storage);
  response.resolve({ user: { id: 'buyer' } });
  await Promise.all([focus, visibility, storage]);
  assert.equal(reads, 1);
  assert.equal(results.length, 1);
  assert.equal(settled, 1);
});

test('a canceled sign-in queues one fresh check after the stale bootstrap request', async () => {
  const stale = deferred();
  const fresh = deferred();
  const results = [];
  let reads = 0;
  let blocked = false;
  let loading = true;
  const sync = createSessionSynchronizer({
    readSession: () => (++reads === 1 ? stale.promise : fresh.promise),
    canCheck: () => !blocked,
    onResult: (value) => results.push(value),
    onError: assert.fail,
    onSettled: () => { loading = false; },
  });
  const bootstrap = sync.check();
  await Promise.resolve();
  blocked = true;
  sync.invalidate();
  await sync.check();
  assert.equal(reads, 1);
  blocked = false;
  const afterClose = sync.check();
  const afterFocus = sync.check();
  assert.equal(afterClose, afterFocus);
  stale.resolve({ user: { id: 'previous-session' } });
  await bootstrap;
  assert.deepEqual(results, []);
  assert.equal(loading, true);
  fresh.resolve({ user: null });
  await afterClose;
  assert.equal(reads, 2);
  assert.deepEqual(results, [{ user: null }]);
  assert.equal(loading, false);
});

test('a response started before logout cannot restore the signed-out user', async () => {
  const response = deferred();
  let user = { id: 'buyer' };
  let blocked = false;
  let reads = 0;
  const sync = createSessionSynchronizer({
    readSession: () => { reads += 1; return response.promise; },
    canCheck: () => !blocked,
    onResult: (result) => { user = result.user; },
    onError: assert.fail,
    onSettled: () => {},
  });
  const beforeLogout = sync.check();
  await Promise.resolve();
  assert.equal(user.id, 'buyer');
  blocked = true;
  sync.invalidate();
  await sync.check();
  user = null;
  blocked = false;
  response.resolve({ user: { id: 'buyer' } });
  await beforeLogout;
  assert.equal(reads, 1);
  assert.equal(user, null);
});

test('a canceled login finishing after its close-time check gets a fresh cookie read', async () => {
  const closeTimeResponse = deferred();
  const closeTimeStarted = deferred();
  const results = [];
  let cookieUser = null;
  let reads = 0;
  const sync = createSessionSynchronizer({
    readSession: () => {
      reads += 1;
      if (reads === 1) {
        closeTimeStarted.resolve();
        return closeTimeResponse.promise;
      }
      return { user: cookieUser };
    },
    canCheck: () => true,
    onResult: (result) => results.push(result),
    onError: assert.fail,
    onSettled: () => {},
  });
  // Closing the dialog starts a read while the canceled login is still running.
  const afterClose = sync.check();
  await closeTimeStarted.promise;
  // The login response subsequently sets the cookie. Its finalizer invalidates
  // the close-time read before requesting reconciliation.
  cookieUser = { id: 'signed-in-after-close' };
  sync.invalidate();
  const afterLogin = sync.check();
  closeTimeResponse.resolve({ user: null });
  await Promise.all([afterClose, afterLogin]);
  assert.equal(reads, 2);
  assert.deepEqual(results, [{ user: cookieUser }]);
});

test('failed bootstrap settles loading and the next check can recover', async () => {
  let reads = 0;
  let settled = 0;
  const errors = [];
  const results = [];
  const sync = createSessionSynchronizer({
    readSession: async () => {
      reads += 1;
      if (reads === 1) throw new Error('offline');
      return { user: { id: 'buyer' } };
    },
    canCheck: () => true,
    onResult: (value) => results.push(value),
    onError: (error) => errors.push(error.message),
    onSettled: () => { settled += 1; },
  });
  await sync.check();
  await sync.check();
  assert.deepEqual(errors, ['offline']);
  assert.equal(results.length, 1);
  assert.equal(settled, 2);
});

test('repeated interrupted checks still fetch the latest session instead of losing the queued refresh', async () => {
  const responses = [deferred(), deferred(), deferred()];
  const starts = [deferred(), deferred(), deferred()];
  const results = [];
  let reads = 0;
  const sync = createSessionSynchronizer({
    readSession: () => {
      const index = reads++;
      starts[index].resolve();
      return responses[index].promise;
    },
    canCheck: () => true,
    onResult: (result) => results.push(result),
    onError: assert.fail,
    onSettled: () => {},
  });
  const first = sync.check();
  await starts[0].promise;
  sync.invalidate();
  const second = sync.check();
  responses[0].resolve('old session');
  await starts[1].promise;
  sync.invalidate();
  const latest = sync.check();
  responses[1].resolve('interrupted session');
  await starts[2].promise;
  responses[2].resolve('current session');
  await Promise.all([first, second, latest]);
  assert.equal(reads, 3);
  assert.deepEqual(results, ['current session']);
});

test('user equality preserves unchanged session identity while detecting profile and role changes', () => {
  const user = { id: 'buyer', role: 'buyer', name: 'Mira', address: { city: 'Pune' } };
  assert.equal(sameSessionUser(user, structuredClone(user)), true);
  assert.equal(sameSessionUser(user, { ...user, role: 'admin' }), false);
  assert.equal(sameSessionUser(user, { ...user, address: { city: 'Mumbai' } }), false);
  assert.equal(sameSessionUser(user, null), false);
  assert.equal(sameSessionUser(undefined, null), true);
});
