import type { ProductionKind } from './production';
export interface ProductionVisualState {
  phase?: string;
  stored?: number;
  totalProgress?: number;
  reducedMotion?: boolean;
}
/** Work platforms use the same world-pixel scale, depth and material palette as tools. */
export function drawProduction(
  ctx: CanvasRenderingContext2D,
  kind: ProductionKind,
  x: number,
  y: number,
  scale: number,
  progress: number,
  working: boolean,
  time: number,
  state: ProductionVisualState = {},
) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  const r = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  // Machines still communicate their state when motion is disabled or time is paused.
  const motionTime = state.reducedMotion ? 0 : time;
  const growth = Math.max(0, Math.min(1, state.phase === 'ready' ? 1 : progress));
  r('#15303c44', -24, -3, 50, 14);
  r('#4e4740', -25, -9, 50, 15);
  r('#b59e78', -24, -10, 48, 3);
  r('#786c55', -24, -4, 48, 5);
  for (let i = 0; i < 7; i++) r('#534b42', -22 + i * 7, -7, 1, 10);
  r('#d5e0df', -27, -11, 12, 2);
  r('#cad8dc', 13, -11, 13, 2);
  if (kind === 'garden') {
    for (let i = 0; i < 3; i++) {
      r('#383f36', -20 + i * 15, -9, 12, 11);
      r('#a79a73', -21 + i * 15, -10, 1, 14);
      for (let j = 0; j < 2; j++) {
        const bx = -16 + i * 15 + j * 4,
          by = -4 + j * 3;
        const h = 4 + Math.floor(growth * 8);
        r('#728b64', bx, by - h, 1, h);
        r('#9fbc8e', bx - 3, by - h + 1, 3, 2);
        r('#abc699', bx + 1, by - h + 3, 3, 2);
      }
    }
    r('#7d8270', -23, -26, 2, 20);
    r('#7d8270', 23, -26, 2, 20);
    r('#a6c9ca88', -22, -27, 45, 2);
    r('#badcde33', -20, -25, 41, 8);
  } else if (kind === 'sawmill') {
    r('#454f51', -20, -18, 40, 12);
    r('#a3a99b', -19, -20, 38, 3);
    r('#655f51', -17, -5, 4, 11);
    r('#655f51', 13, -5, 4, 11);
    r('#67503d', -26, -25, 31, 6);
    r('#ba9666', -26, -26, 31, 2);
    r('#d0b28a', -26, -25, 3, 6);
    const a = working ? motionTime * 5 : 0;
    ctx.save();
    ctx.translate(8, -23);
    ctx.rotate(a);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      r('#9cafa9', -2, -10, 4, 4);
    }
    ctx.fillStyle = '#829a98';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    r('#344b54', -2, -2, 4, 4);
    ctx.restore();
    r('#b79d70', 10, -15, 11, 2);
    r('#8c7553', 15, -13, 12, 3);
  } else {
    r('#596a6b', -19, -26, 38, 19);
    r('#adbaaf', -20, -28, 40, 3);
    r('#435558', -18, -23, 36, 14);
    for (let i = 0; i < 7; i++) r('#86918a', -16 + i * 5, -21, 2, 10);
    const shake = working ? Math.round(Math.sin(motionTime * 16)) : 0;
    r('#b2bdb6', -11 + shake, -29, 7, 4);
    r('#8caaa7', -1 + shake, -30, 8, 5);
    r('#99b0aa', 9 + shake, -28, 6, 3);
    r('#6b6654', -18, -7, 4, 14);
    r('#6b6654', 14, -7, 4, 14);
    r('#bfbca2', -8, -4, 7, 4);
    r('#9fada4', 1, -3, 7, 4);
  }
  // Stored batches are tangible: a compact stack remains even while the next job runs.
  const stored = Math.max(0, state.stored ?? 0);
  if (stored > 0) {
    const stacks = Math.min(3, Math.ceil(stored / 4));
    for (let i = 0; i < stacks; i++) {
      const bx = 16 - i * 6,
        by = 4 - i * 2;
      r('#263c3d', bx - 1, by - 1, 11, 8);
      r('#9a8059', bx, by, 9, 6);
      r('#d6bd87', bx, by, 9, 2);
      r('#d6bd87', bx + 3, by + 2, 2, 4);
      if (kind === 'garden') {
        r('#90b97d', bx + 2, by - 3, 3, 3);
        r('#b0ce91', bx + 5, by - 2, 3, 2);
      } else if (kind === 'ore-sorter') {
        r('#bad0cd', bx + 2, by - 2, 5, 3);
      }
    }
  }
  if (working || state.phase === 'blocked' || state.phase === 'awaiting-claim') {
    const completed = Math.max(0, Math.min(1, state.totalProgress ?? progress));
    r('#182e33', -20, 14, 40, 3);
    r(state.phase === 'blocked' ? '#e5b275' : '#9ec69c', -20, 14, Math.round(40 * completed), 2);
    if (working && (state.reducedMotion || Math.sin(motionTime * 4) > 0))
      r('#e0c68a', 22, -13, 2, 2);
  }
  // Small, stationary signs use distinct silhouettes as well as colors. No job state is
  // invented for remote machines: their current network record only describes placement.
  if (['idle', 'working', 'ready', 'blocked', 'awaiting-claim'].includes(state.phase ?? '')) {
    const ink =
      state.phase === 'ready'
        ? '#c8e6a4'
        : state.phase === 'blocked'
          ? '#ffd3a0'
          : state.phase === 'awaiting-claim'
            ? '#b8d5ec'
            : '#ddd4ae';
    r('#243c42', 24, -30, 2, 15);
    r('#132b33', 17, -44, 17, 15);
    r(ink, 18, -43, 15, 1);
    if (state.phase === 'blocked') {
      r(ink, 24, -40, 3, 6);
      r(ink, 24, -32, 3, 2);
    } else if (state.phase === 'ready') {
      r(ink, 20, -37, 3, 3);
      r(ink, 22, -35, 3, 3);
      r(ink, 24, -37, 3, 3);
      r(ink, 26, -39, 3, 3);
      r(ink, 28, -41, 3, 3);
    } else if (state.phase === 'working') {
      r(ink, 21, -40, 3, 9);
      r(ink, 24, -38, 3, 5);
      r(ink, 27, -36, 3, 1);
    } else if (state.phase === 'awaiting-claim') {
      r(ink, 21, -40, 9, 2);
      r(ink, 23, -38, 5, 2);
      r(ink, 25, -36, 1, 2);
      r(ink, 23, -34, 5, 2);
      r(ink, 21, -32, 9, 2);
    } else {
      r(ink, 21, -39, 9, 1);
      r(ink, 21, -33, 9, 1);
      r(ink, 21, -38, 1, 5);
      r(ink, 29, -38, 1, 5);
    }
  }
  ctx.restore();
}
