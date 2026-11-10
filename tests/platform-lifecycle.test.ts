import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAppLoad } from '../src/boot-state.ts';
import { OfflineMonitor } from '../src/offline.ts';
import { EffectAtlasLoader } from '../src/stichos/effect-atlas.ts';
import { WalletRequestQueue } from '../src/stichos/store-lifecycle.ts';
const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('slow import stays single-owner, recovers on completion, and disposed loads cannot redraw', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states: string[] = [],
    load = deferred<void>();
  const dispose = observeAppLoad(load.promise, (state) => states.push(state));
  t.mock.timers.tick(15001);
  assert.deepEqual(states, ['loading', 'slow']);
  load.resolve();
  await turn();
  assert.deepEqual(states, ['loading', 'slow', 'ready']);
  dispose();
  const second = deferred<void>();
  const stop = observeAppLoad(second.promise, (s) => states.push(s));
  stop();
  second.reject(Error('late'));
  await turn();
  assert.equal(states.at(-1), 'loading');
});

class WorkerState extends EventTarget {
  state: ServiceWorkerState = 'installing';
}
class Registration extends EventTarget {
  installing: WorkerState | null = null;
  waiting: WorkerState | null = null;
  active: WorkerState | null = null;
}
const registered = (monitor: OfflineMonitor, reg: Registration, events: EventTarget) =>
  monitor.register(async () => reg as unknown as ServiceWorkerRegistration, events);
test('offline registration distinguishes preparing, activation and waiting updates without forcing activation', async () => {
  const monitor = new OfflineMonitor(),
    reg = new Registration(),
    events = new EventTarget(),
    worker = new WorkerState();
  reg.installing = worker;
  await registered(monitor, reg, events);
  assert.equal(monitor.status.phase, 'registered');
  worker.state = 'activated';
  reg.active = worker;
  reg.installing = null;
  worker.dispatchEvent(new Event('statechange'));
  assert.equal(monitor.status.phase, 'ready');
  reg.waiting = new WorkerState();
  reg.waiting.state = 'installed';
  reg.dispatchEvent(new Event('updatefound'));
  assert.equal(monitor.status.phase, 'update-ready');
  assert.match(monitor.status.message, /Finish playing/);
  monitor.dispose();
});
test('offline failed install, hung registration and retry have terminal observable outcomes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const monitor = new OfflineMonitor(),
    reg = new Registration(),
    events = new EventTarget(),
    worker = new WorkerState();
  reg.installing = worker;
  await registered(monitor, reg, events);
  worker.state = 'redundant';
  reg.installing = null;
  worker.dispatchEvent(new Event('statechange'));
  assert.equal(monitor.status.phase, 'failed');
  const hanging = monitor.register(() => new Promise(() => {}), events);
  t.mock.timers.tick(15001);
  await hanging;
  assert.equal(monitor.status.phase, 'failed');
  const ready = new WorkerState();
  ready.state = 'activated';
  reg.active = ready;
  await registered(monitor, reg, events);
  assert.equal(monitor.status.phase, 'ready');
  const late = deferred<ServiceWorkerRegistration>();
  const cancelled = monitor.register(() => late.promise, events);
  monitor.dispose();
  await cancelled;
  late.resolve(reg as unknown as ServiceWorkerRegistration);
  await turn();
  assert.equal(
    monitor.status.phase,
    'registering',
    'Disposed owner cannot publish a later ready result',
  );
});
test('atlas errors/timeouts retry with bounded backoff and ignore superseded image callbacks', () => {
  let now = 0;
  const images: HTMLImageElement[] = [];
  const loader = new EffectAtlasLoader(
    () => {
      const i = { complete: false, naturalWidth: 0 } as HTMLImageElement;
      images.push(i);
      return i;
    },
    () => now,
  );
  assert.equal(loader.get(), null);
  const stale = images[0];
  stale.onerror!(new Event('error'));
  loader.get();
  assert.equal(images.length, 1);
  now = 2001;
  loader.get();
  assert.equal(images.length, 2);
  stale.onerror!(new Event('error'));
  assert.equal(loader.status.phase, 'loading');
  now = 12002;
  loader.get();
  assert.equal(loader.status.phase, 'failed');
  now = 16003;
  loader.get();
  assert.equal(images.length, 3);
  images[2].onerror!(new Event('error'));
  now = 999999;
  loader.get();
  assert.equal(images.length, 3);
  loader.retry();
  loader.get();
  Object.assign(images[3], { complete: true, naturalWidth: 256 });
  assert.equal(loader.get(), images[3]);
  assert.equal(loader.status.phase, 'ready');
});
test('wallet recovery serializes following reads, skips replaced owners and survives rejection', async () => {
  const queue = new WalletRequestQueue(),
    write = deferred<string>(),
    log: string[] = [];
  const first = queue.run(async () => {
    log.push('write');
    return write.promise;
  });
  let current = true;
  const stale = queue.run(
    async () => {
      log.push('stale');
      return 'stale';
    },
    () => current,
  );
  const staleResult = assert.rejects(stale, { name: 'AbortError' });
  const read = queue.run(async () => {
    log.push('read');
    return 'new-wallet';
  });
  await turn();
  assert.deepEqual(log, ['write']);
  current = false;
  write.resolve('done');
  await first;
  await staleResult;
  assert.equal(await read, 'new-wallet');
  assert.deepEqual(log, ['write', 'read']);
});
