import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncOwner } from '../src/stichos/async-owner.ts';
import { NarrativeTransfer } from '../src/stichos/narrative-transfer.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('replacing a request settles its caller before transport finishes and old cleanup cannot unlock the replacement', async () => {
  const owner = new AsyncOwner<'lookup'>();
  const transport = deferred<string>();
  const first = owner.start('lookup');
  const waiting = first.run(() => transport.promise);
  await Promise.resolve();
  const next = owner.start('lookup');
  assert.deepEqual(await waiting, { status: 'replaced' });
  assert.equal(first.current, false);
  assert.equal(await first.settled, 'replaced');
  transport.resolve('old room');
  await Promise.resolve();
  first.settle('succeeded');
  assert.equal(owner.pending, true);
  assert.equal(next.current, true);
  assert.deepEqual(await next.run(async () => 'new room'), {
    status: 'succeeded',
    value: 'new room',
  });
  assert.equal(owner.pending, false);
});

test('closing a panel prevents queued work and consumes late transport rejection', async () => {
  const owner = new AsyncOwner<'companion'>();
  const queued = owner.start('companion');
  let started = false;
  const pending = queued.run(async () => {
    started = true;
    return true;
  });
  owner.cancel();
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(started, false);
  const transport = deferred<boolean>();
  const active = owner.start('companion');
  const result = active.run(() => transport.promise);
  await Promise.resolve();
  owner.cancel();
  assert.deepEqual(await result, { status: 'cancelled' });
  transport.reject(Error('late network failure'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(owner.diagnostic?.status, 'cancelled');
});

test('screen cancellation does not discard an independent authoritative receipt', async () => {
  const panel = new AsyncOwner<'lookup'>();
  const actions = new AsyncOwner<'world' | 'combat'>();
  const view = panel.start('lookup');
  const action = actions.start('world');
  const server = deferred<{ receipt: string }>();
  let inventory = 0;
  let detachedWrites = 0;
  const result = action.run(async () => {
    const receipt = await server.promise;
    if (action.current) inventory++;
    if (view.current) detachedWrites++;
    return receipt;
  });
  await Promise.resolve();
  panel.cancel();
  assert.equal(actions.pending, true);
  server.resolve({ receipt: 'once-only' });
  assert.equal((await result).status, 'succeeded');
  assert.equal(inventory, 1);
  assert.equal(detachedWrites, 0);
});

test('failed requests reach a terminal state and permit immediate retry', async () => {
  const owner = new AsyncOwner<'send'>();
  const first = owner.start('send');
  const error = Error('delivery failed');
  assert.deepEqual(
    await first.run(async () => {
      throw error;
    }),
    { status: 'failed', error },
  );
  assert.equal(await first.settled, 'failed');
  assert.equal(owner.pending, false);
  const retry = owner.start('send');
  assert.equal(first.current, false);
  await retry.run(async () => true);
  owner.cancel();
  assert.equal(retry.current, false, 'A completed callback also loses its screen on close');
});

test('transfer completion consumes its callback before reentry and replacing a world drops the old callback', () => {
  const flow = new NarrativeTransfer<object>();
  const world = {},
    nextWorld = {};
  let completed = 0;
  flow.start('clinic', world, 0, () => {
    completed++;
    assert.equal(flow.finish(world), null);
  });
  flow.finish(world)?.after?.();
  flow.finish(world)?.after?.();
  assert.equal(completed, 1);
  flow.start('return', world, 10, () => completed++);
  assert.equal(flow.finish(nextWorld), null);
  assert.equal(completed, 1);
  flow.start('opening', world, 20, undefined, true);
  flow.start('arrival', nextWorld, 30);
  assert.equal(flow.finish(world), null);
  assert.equal(flow.active?.kind, 'arrival', 'A stale completion cannot cancel its replacement');
  assert.equal(flow.active?.replay, false);
  assert.equal(flow.active?.page, 0);
  assert.equal(flow.active?.scope, nextWorld);
  flow.cancel();
  assert.equal(flow.active, null);
});
