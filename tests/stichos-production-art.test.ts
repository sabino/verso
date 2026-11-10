import test from 'node:test';
import assert from 'node:assert/strict';
import { drawProduction, type ProductionVisualState } from '../src/stichos/production-art.ts';
import type { ProductionKind } from '../src/stichos/production.ts';

function marks(kind: ProductionKind, time: number, state: ProductionVisualState) {
  const trace: unknown[][] = [];
  const context = new Proxy<Record<string, unknown>>(
    {},
    {
      get(target, key) {
        if (!(key in target))
          target[key as string] = (...args: unknown[]) => trace.push([key, ...args]);
        return target[key as string];
      },
      set(target, key, value) {
        // Ignore paint color: state should remain legible without color discrimination.
        target[key as string] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  drawProduction(context, kind, 50, 75, 1, 0.5, state.phase === 'working', time, state);
  return trace;
}

test('reduced motion freezes working mechanisms without removing their state or output', () => {
  for (const kind of ['garden', 'sawmill', 'ore-sorter'] as const) {
    const state = { phase: 'working', stored: 8, totalProgress: 0.7, reducedMotion: true };
    for (const time of [0, 0.3, 1, 19.1, 600])
      assert.deepEqual(marks(kind, time, state), marks(kind, 0, state));
    assert.notDeepEqual(
      marks(kind, 0, state),
      marks(kind, 0, { phase: 'idle', reducedMotion: true }),
    );
  }
  for (const kind of ['sawmill', 'ore-sorter'] as const)
    assert.notDeepEqual(
      marks(kind, 0, { phase: 'working' }),
      marks(kind, 0.1, { phase: 'working' }),
    );
});

test('all production states remain distinguishable by geometry when motion and color cues are absent', () => {
  for (const kind of ['garden', 'sawmill', 'ore-sorter'] as const) {
    const states = ['idle', 'working', 'ready', 'blocked', 'awaiting-claim'];
    const signatures = states.map((phase) =>
      JSON.stringify(marks(kind, 0, { phase, reducedMotion: true })),
    );
    assert.equal(
      new Set(signatures).size,
      states.length,
      `${kind}: state signs must differ in shape`,
    );
    // A remote placement with no production snapshot must not imply that it is idle.
    assert.notDeepEqual(marks(kind, 0, {}), marks(kind, 0, { phase: 'idle' }));
  }
});

test('stored output stays visible during production and cannot grow beyond a bounded stack', () => {
  for (const kind of ['garden', 'sawmill', 'ore-sorter'] as const) {
    const state = { phase: 'working', reducedMotion: true };
    assert.notDeepEqual(
      marks(kind, 0, { ...state, stored: 0 }),
      marks(kind, 0, { ...state, stored: 1 }),
    );
    assert.notDeepEqual(
      marks(kind, 0, { ...state, stored: 1 }),
      marks(kind, 0, { ...state, stored: 8 }),
    );
    assert.deepEqual(
      marks(kind, 0, { ...state, stored: 12 }),
      marks(kind, 0, { ...state, stored: 60 }),
    );
  }
});
