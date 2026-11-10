import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { drawHumanoid, line } from '../src/stichos/art.ts';
import { appearance } from '../src/stichos/world.ts';
import { technologyWeaponSeed, weaponGenome, weaponPixels } from '../src/stichos/equipment.ts';
import type { Appearance } from '../src/stichos/types.ts';
import type { ToolKind } from '../src/stichos/labor.ts';

test('every manufactured grip is attached to the actual raster, including flexible bows and launchers', () => {
  for (const kind of ['staff', 'sword', 'bow'] as const)
    for (const tier of [null, 0, 1, 2, 3] as const)
      for (let seed = 0; seed < 80; seed++) {
        const address = tier === null ? seed : technologyWeaponSeed(seed, tier);
        const raster = weaponPixels(weaponGenome(address, kind));
        assert.ok(Number.isInteger(raster.grip.x) && Number.isInteger(raster.grip.y));
        assert.ok(raster.grip.x > 0 && raster.grip.x < raster.width - 1);
        assert.ok(raster.grip.y > 0 && raster.grip.y < raster.height - 1);
        assert.ok(
          raster.pixels[raster.grip.y * raster.width + raster.grip.x],
          `${tier}/${kind}/${seed}: a hand must not grip transparent air`,
        );
      }
});

test('working draws the selected tool regardless of the carried weapon or invented artifact', () => {
  const previousDocument = globalThis.document;
  type CanvasTrace = { width: number; height: number; trace: unknown[]; getContext: () => unknown };
  const makeCanvas = (): CanvasTrace => {
    const trace: unknown[] = [];
    const context = new Proxy<Record<string, unknown>>(
      {},
      {
        get(target, key) {
          if (!(key in target))
            target[key as string] = (...args: unknown[]) => trace.push([key, ...args]);
          return target[key as string];
        },
        set(target, key, value) {
          trace.push([key, value]);
          target[key as string] = value;
          return true;
        },
      },
    );
    return { width: 0, height: 0, trace, getContext: () => context };
  };
  globalThis.document = { createElement: () => makeCanvas() } as unknown as Document;
  const render = (look: Appearance, tool: ToolKind, direction: number, progress: number) => {
    let signature = '';
    const target = {
      drawImage(canvas: CanvasTrace) {
        signature = createHash('sha256').update(JSON.stringify(canvas.trace)).digest('hex');
      },
    } as unknown as CanvasRenderingContext2D;
    drawHumanoid(target, look, 48, 68, 1, direction, 0, false, 0, true, direction === 0, {
      kind: 'gather',
      progress,
      tool: { kind: tool, seed: 734 },
    });
    return signature;
  };
  try {
    for (const tool of ['axe', 'pickaxe', 'sickle'] as const)
      for (const direction of [0, 1, 2, 3])
        for (const progress of [0.25, 0.5, 0.75]) {
          const look = { ...appearance(703), weapon: 'sword' as const };
          const reference = render(look, tool, direction, progress);
          for (const weapon of ['staff', 'sword', 'bow'] as const)
            assert.equal(
              render(
                { ...look, weapon, artifactDesign: 'copper moth beneath ice' },
                tool,
                direction,
                progress,
              ),
              reference,
              `the ${tool} work stroke must not turn into the carried ${weapon}/artifact`,
            );
        }
  } finally {
    if (previousDocument === undefined) delete (globalThis as { document?: Document }).document;
    else globalThis.document = previousDocument;
  }
});

// Proportional limbs use fractional joints even though their final marks are integer pixels.
test('pixel limbs reach both fractional joints without an open endpoint or a gap', () => {
  for (const [x0, y0, x1, y1] of [
    [0, 0, 2.7, 0],
    [0.2, 0.2, -2.6, 4.8],
    [5.6, -2.4, 0.7, -4.8],
    [1.1, 1.4, 1.1, 1.4],
  ]) {
    const pixels: [number, number][] = [];
    line(
      {
        fillRect: (x: number, y: number) => pixels.push([x, y]),
      } as unknown as CanvasRenderingContext2D,
      x0,
      y0,
      x1,
      y1,
      '#ffffff',
    );
    assert.deepEqual(pixels[0], [Math.round(x0), Math.round(y0)]);
    assert.deepEqual(pixels.at(-1), [Math.round(x1), Math.round(y1)]);
    for (let index = 1; index < pixels.length; index++)
      assert.ok(
        Math.max(
          Math.abs(pixels[index][0] - pixels[index - 1][0]),
          Math.abs(pixels[index][1] - pixels[index - 1][1]),
        ) <= 1,
      );
  }
});
