import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeTabLease, type LifeLockRequest } from '../src/stichos/life-lease.ts';

function controlled() {
  const callbacks: Array<(lock: unknown | null) => Promise<void>> = [];
  const request: LifeLockRequest = (_name, options, callback) => {
    assert.deepEqual(options, { ifAvailable: true });
    callbacks.push(callback);
    return Promise.resolve();
  };
  return { lease: new LifeTabLease(() => request), callbacks };
}

test('concurrent claims share one request and unavailable ownership can be retried', async () => {
  const { lease, callbacks } = controlled();
  const first = lease.claim();
  assert.equal(lease.claim(), first);
  assert.equal(callbacks.length, 1);
  await callbacks[0](null);
  assert.equal(await first, false);
  assert.equal(lease.snapshot.state, 'busy');
  const next = lease.claim();
  const lifetime = callbacks[1]({});
  assert.equal(await next, true);
  assert.equal(lease.snapshot.exclusive, true);
  lease.release();
  await lifetime;
  assert.equal(lease.snapshot.state, 'idle');
});

test('pagehide cancels a pending claim; its late lock cannot replace the restored page owner', async () => {
  const { lease, callbacks } = controlled();
  const first = lease.claim();
  lease.release();
  assert.equal(await first, false);
  const restored = lease.claim();
  const lifetime = callbacks[1]({});
  assert.equal(await restored, true);
  await callbacks[0]({});
  assert.equal(lease.snapshot.state, 'held');
  lease.release();
  await lifetime;
});

test('old release completion cannot clear a newly acquired page lease', async () => {
  const { lease, callbacks } = controlled();
  const first = lease.claim();
  const firstLifetime = callbacks[0]({});
  assert.equal(await first, true);
  lease.release();
  const restored = lease.claim();
  const nextLifetime = callbacks[1]({});
  await firstLifetime;
  assert.equal(await restored, true);
  assert.equal(lease.snapshot.canSave, true);
  lease.release();
  await nextLifetime;
});

test('provider and asynchronous lock failures settle with an explicit retryable state', async () => {
  for (const provider of [
    () => {
      throw Error('denied');
    },
    () => (() => Promise.reject(Error('denied'))) as LifeLockRequest,
    () =>
      (() => {
        throw Error('denied');
      }) as LifeLockRequest,
  ]) {
    const lease = new LifeTabLease(provider);
    assert.equal(await lease.claim(), false);
    assert.equal(lease.snapshot.state, 'failed');
    assert.equal(lease.snapshot.canSave, false);
  }
});

test('unsupported browsers explicitly report nonexclusive single-tab mode', async () => {
  const lease = new LifeTabLease(() => undefined);
  assert.equal(await lease.claim(), true);
  assert.equal(lease.snapshot.state, 'unsupported');
  assert.equal(lease.snapshot.exclusive, false);
  assert.match(lease.snapshot.message!, /one tab/);
  lease.release();
  assert.equal(lease.snapshot.canSave, false);
});

test('a lock provider that never answers has a deadline and cannot claim ownership late', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { lease, callbacks } = controlled();
  const pending = lease.claim();
  t.mock.timers.tick(5001);
  assert.equal(await pending, false);
  assert.equal(lease.snapshot.state, 'failed');
  await callbacks[0]({});
  assert.equal(lease.snapshot.canSave, false);
});
