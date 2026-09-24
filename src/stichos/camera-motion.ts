import type { Point } from './types.ts';

/** Preserve subpixel follow state. Quantization belongs to projection, not feedback. */
export function cameraFrame(
  current: Point,
  target: Point,
  dt: number,
  unit: number,
  immediate = false,
) {
  const follow = immediate ? 1 : 1 - Math.exp(-Math.max(0.016, Math.min(0.05, dt)) * 12);
  const position = {
    x: current.x + (target.x - current.x) * follow,
    y: current.y + (target.y - current.y) * follow,
  };
  return {
    position,
    pixel: {
      x: Math.round(position.x * unit) / unit,
      y: Math.round(position.y * unit) / unit,
    },
  };
}
