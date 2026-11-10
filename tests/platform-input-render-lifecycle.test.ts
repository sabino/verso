import test from 'node:test';
import assert from 'node:assert/strict';
import { GroundRaster, GROUND_WORKER_TIMEOUT_MS } from '../src/stichos/ground-raster.ts';
import { mountGalaxy } from '../src/stichos/galaxy.ts';
import type { Tile } from '../src/stichos/types.ts';

function globals(t: test.TestContext, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
}
const context = () =>
  new Proxy(
    { measureText: () => ({ width: 20 }) },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : () => {}),
      set: () => true,
    },
  );
class FakeWorker {
  static all: FakeWorker[] = [];
  terminated = false;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  message: any;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(value: any) {
    this.message = value;
  }
  terminate() {
    this.terminated = true;
  }
}
test('hung ground worker falls back, retries finitely and closes stale results after reset', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  FakeWorker.all = [];
  globals(t, {
    Worker: FakeWorker,
    OffscreenCanvas: class {},
    document: { createElement: () => ({ getContext: context }) },
  });
  const raster = new GroundRaster();
  (raster as any).art.ground = () => ({ image: {} });
  const tile = (x: number, y: number) =>
    ({ x, y, terrain: 'snow', temperature: 0, ecology: { moisture: 0.5 } }) as Tile;
  raster.request(0, 0, tile);
  raster.work(() => {});
  assert.equal(raster.diagnostics.state, 'waiting');
  const stale = FakeWorker.all[0];
  now = GROUND_WORKER_TIMEOUT_MS + 1;
  raster.work(() => {});
  assert.equal(stale.terminated, true);
  assert.equal(raster.diagnostics.timeouts, 1);
  for (let i = 0; i < 30; i++) raster.work(() => {});
  assert.equal(raster.diagnostics.cached, 1, 'Main thread completed exactly the admitted chunk');
  for (let attempt = 1; attempt < 3; attempt++) {
    now += 11000;
    raster.beginFrame();
    raster.request(attempt, 0, tile);
    raster.work(() => {});
    const live = FakeWorker.all.at(-1)!;
    stale.onerror?.();
    assert.equal(live.terminated, false, 'Old callback cannot kill a retry');
    now += GROUND_WORKER_TIMEOUT_MS + 1;
    raster.work(() => {});
    for (let i = 0; i < 30; i++) raster.work(() => {});
  }
  now += 100000;
  raster.beginFrame();
  raster.request(9, 0, tile);
  raster.work(() => {});
  assert.equal(FakeWorker.all.length, 3, 'Repeated failure stays on bounded fallback');
  raster.reset();
  let closed = 0;
  stale.onmessage?.({
    data: {
      id: stale.message.id,
      bitmap: {
        close() {
          closed++;
        },
      },
    },
  });
  assert.equal(closed, 1);
  assert.equal(raster.diagnostics.cached, 0);
  raster.request(0, 0, tile);
  raster.work(() => {});
  assert.equal(FakeWorker.all.length, 4, 'New world may retry worker support');
});

test('galaxy pointer ownership ignores second fingers, cancellation and disposed releases', (t) => {
  globals(t, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  const captured = new Set<number>();
  const canvas: any = {
    width: 600,
    height: 400,
    getBoundingClientRect: () => ({ width: 600, height: 400, left: 0, top: 0 }),
    getContext: context,
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  };
  const selected: number[] = [];
  const view = mountGalaxy(canvas, [], 3886, (p) => selected.push(p.seed));
  const e = (id: number, x = 300, y = 200) => ({
    pointerId: id,
    button: 0,
    clientX: x,
    clientY: y,
    preventDefault() {},
  });
  canvas.onpointerdown(e(1));
  canvas.onpointerdown(e(2));
  canvas.onpointerup(e(2));
  assert.equal(selected.length, 0);
  assert.deepEqual([...captured], [1]);
  canvas.onpointercancel(e(1));
  canvas.onpointerup(e(1));
  assert.equal(selected.length, 0);
  canvas.onpointerdown(e(3));
  canvas.onpointerup(e(3));
  assert.deepEqual(selected, [3886]);
  canvas.onpointerdown(e(4));
  canvas.onpointermove(e(4, 350));
  canvas.onpointerup(e(4, 350));
  assert.equal(selected.length, 1, 'Dragging never selects');
  canvas.onpointerdown(e(5));
  const lateRelease = canvas.onpointerup;
  view.dispose();
  lateRelease(e(5));
  view.focus(7);
  view.sector(1);
  assert.equal(selected.length, 1);
  assert.equal(captured.size, 0);
});
