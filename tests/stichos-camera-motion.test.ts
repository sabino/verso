import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFrame } from '../src/stichos/camera-motion.ts';

test('camera follow accumulates subpixel travel before projecting onto crisp pixels', () => {
  let position = { x: 0, y: 0 };
  let previousPixel = 0;
  let pixelSteps = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const view = cameraFrame(position, { x: frame * 0.002, y: 0 }, 1 / 60, 36);
    position = view.position;
    if (view.pixel.x !== previousPixel) pixelSteps++;
    previousPixel = view.pixel.x;
  }
  assert.ok(pixelSteps >= 6, 'slow motion still moves the image regularly');
  assert.ok(Math.abs(position.x - 0.24) < 0.02, 'follow remains close to the player');
  assert.equal(cameraFrame(position, { x: 2, y: 3 }, 1 / 60, 36, true).position.x, 2);
});
