import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectAtlasFrame,
  effectAtlasCell,
  drawGeneratedEffect,
} from '../src/stichos/effect-atlas.ts';
import type { CombatCue } from '../src/stichos/combat-feedback.ts';

const cue = (kind: CombatCue['kind'], age = 0): CombatCue => ({
  id: 'test',
  kind,
  x: 0,
  y: 0,
  age,
  duration: 1,
});
test('non-divisible atlas dimensions form exact integer cells without gaps or overlap', () => {
  for (const width of [1024, 1254]) {
    for (let row = 0; row < 4; row++) {
      let edge = 0;
      for (let column = 0; column < 4; column++) {
        const cell = effectAtlasCell(width, width, row, column);
        assert.equal(cell.x, edge);
        assert.ok(Object.values(cell).every(Number.isInteger));
        edge = cell.x + cell.width;
      }
      assert.equal(edge, width);
    }
    const last = effectAtlasCell(width, width, 3, 3);
    assert.equal(last.y + last.height, width);
  }
});
test('effect atlas frame selection never bleeds into neighboring rows at boundaries', () => {
  for (const [kind, row] of [
    ['impact', 0],
    ['guard', 1],
    ['dash', 2],
    ['loot', 3],
  ] as const) {
    for (const [age, column] of [
      [-1, 0],
      [0, 0],
      [0.25, 1],
      [0.5, 2],
      [0.75, 3],
      [1, 3],
      [100, 3],
    ]) {
      assert.deepEqual(effectAtlasFrame(cue(kind, age)), {
        row,
        column,
        progress: Math.max(0, Math.min(1, age)),
      });
    }
  }
  for (const kind of ['telegraph', 'anticipation', 'projectile'] as const)
    assert.equal(effectAtlasFrame(cue(kind)), null, 'essential geometry is never replaced');
  assert.equal(effectAtlasFrame(cue('impact', NaN)), null);
  assert.equal(effectAtlasFrame({ ...cue('impact'), duration: 0 }), null);
});
test('reduced effects and a missing browser use the procedural renderer without canvas work', () => {
  const ctx = new Proxy(
    {},
    {
      get() {
        throw Error('unexpected canvas access');
      },
    },
  ) as CanvasRenderingContext2D;
  assert.equal(
    drawGeneratedEffect(ctx, cue('impact'), 32, { intensity: 1, reducedMotion: true }),
    false,
  );
  assert.equal(
    drawGeneratedEffect(ctx, cue('impact'), 32, { intensity: 0, reducedMotion: false }),
    false,
  );
  assert.equal(
    drawGeneratedEffect(ctx, cue('impact'), 32, { intensity: 1, reducedMotion: false }),
    false,
  );
});
