import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { measureStableClickTarget } from '../scripts/browser-harness.mjs';

function pageFixture(yAtFrame: (frame: number) => number, covered = false) {
  let frames = 0;
  const hits: Array<{ x: number; y: number }> = [];
  const element = {
    disabled: false,
    parentElement: null,
    getBoundingClientRect: () => {
      const y = yAtFrame(frames);
      return { x: 30, y, width: 240, height: 44, top: y, bottom: y + 44 };
    },
    contains: (target: unknown) => target === element,
  };
  const context = {
    setTimeout,
    clearTimeout,
    cancelAnimationFrame: () => {},
    performance: { now: () => frames * 16 },
    requestAnimationFrame: (callback: () => void) =>
      queueMicrotask(() => {
        frames++;
        callback();
      }),
    document: {
      querySelector: (selector: string) => (selector === '#choose-life' ? element : null),
      elementFromPoint: (x: number, y: number) => {
        hits.push({ x, y });
        return covered ? {} : element;
      },
    },
    innerWidth: 320,
    innerHeight: 568,
  };
  return {
    run: () => runInNewContext(`(${measureStableClickTarget.toString()})('#choose-life')`, context),
    frames: () => frames,
    hits,
  };
}

test('focus-induced title relayout is measured across frames before the final hit test', async () => {
  const page = pageFixture((frame) => (frame === 1 ? 428 : 374));
  const point = await page.run();
  assert.equal(page.frames(), 3);
  assert.deepEqual({ ...point }, { x: 150, y: 396 });
  assert.deepEqual(page.hits, [{ x: 150, y: 396 }]);
});

test('covered controls still require scrolling or fail instead of receiving a synthetic click', async () => {
  const page = pageFixture(() => 374, true);
  const point = await page.run();
  assert.equal(page.frames(), 2);
  assert.equal(point.x, undefined);
  assert.equal(point.y, undefined);
  assert.deepEqual({ ...point.scroll }, { x: 160, y: 284 });
});

test('continuously moving targets fail the frame deadline without a hit test', async () => {
  const page = pageFixture((frame) => 200 + frame);
  await assert.rejects(page.run(), /layout did not settle/);
  assert.ok(page.frames() >= 187 && page.frames() <= 188);
  assert.deepEqual(page.hits, []);
});

test('a page that never presents a frame fails its deadline and cancels the pending frame', async () => {
  let cancelled;
  await assert.rejects(
    runInNewContext(`(${measureStableClickTarget.toString()})('#choose-life')`, {
      performance: { now: () => 0 },
      requestAnimationFrame: () => 17,
      cancelAnimationFrame: (id: number) => {
        cancelled = id;
      },
      setTimeout: (callback: () => void) => queueMicrotask(callback),
      clearTimeout: () => {},
    }),
    /layout did not settle/,
  );
  assert.equal(cancelled, 17);
});
