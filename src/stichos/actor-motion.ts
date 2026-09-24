import type { Effect, Point } from './types.ts';

export type HumanoidActionKind = 'gather' | 'craft' | 'ward' | 'heal' | 'hurt';
export interface HumanoidAction {
  kind: HumanoidActionKind;
  progress: number;
  reduced?: boolean;
  tool?: { kind: 'axe' | 'pickaxe' | 'sickle'; seed: number };
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const ease = (t: number) => t * t * (3 - 2 * t);

/** Continuous weight envelope; only the final drawing is snapped to pixel clusters. */
export function actionMotion(action: HumanoidAction | null | undefined) {
  if (!action || !Number.isFinite(action.progress))
    return { kind: null, step: 0, strength: 0, settle: 0, crouch: 0, lean: 0 };
  const t = clamp(action.progress, 0, 1);
  const step = Math.round(t * 6);
  if (!action.reduced && (t === 0 || t === 1))
    return { kind: null, step: 0, strength: 0, settle: 0, crouch: 0, lean: 0 };
  // Prepare the tool, strike near the middle of the stroke, then allow a longer recovery.
  const strength = action.reduced
    ? 0.32
    : t < 0.28
      ? 0.38 * ease(t / 0.28)
      : t < 0.52
        ? 0.38 + 0.62 * ease((t - 0.28) / 0.24)
        : 1 - ease((t - 0.52) / 0.48);
  const settle = action.reduced ? 0.5 : t;
  const crouch =
    strength *
    (action.kind === 'gather' ? 6 : action.kind === 'craft' ? 1.5 : action.kind === 'hurt' ? 2 : 0);
  const lean = strength * (action.kind === 'gather' ? 2.5 : action.kind === 'hurt' ? -3 : 0);
  return { kind: action.kind, step: action.reduced ? 3 : step, strength, settle, crouch, lean };
}

export interface MotionActor extends Point {
  id: string;
  /** Stable physical identity when the renderer uses a separate local player key. */
  bodyId?: string;
  player: boolean;
}
/** Explicit physical identity wins; legacy gathering defaults to the player and impacts use proximity. */
export function effectActor(
  effect: Effect,
  actors: readonly MotionActor[],
): { id: string; kind: HumanoidActionKind } | null {
  if (effect.actorId !== undefined) {
    const actor = actors.find((a) => a.id === effect.actorId || a.bodyId === effect.actorId);
    if (!actor) return null;
    if (effect.kind === 'harvest')
      return {
        id: actor.id,
        kind:
          !effect.tool && Math.hypot(effect.x - actor.x, effect.y - actor.y) < 0.3
            ? 'craft'
            : 'gather',
      };
    return ['hurt', 'heal', 'ward'].includes(effect.kind)
      ? { id: actor.id, kind: effect.kind as 'hurt' | 'heal' | 'ward' }
      : null;
  }
  if (effect.kind === 'harvest') {
    const player = actors.find((actor) => actor.player);
    return player
      ? {
          id: player.id,
          kind:
            !effect.tool && Math.hypot(effect.x - player.x, effect.y - player.y) < 0.3
              ? 'craft'
              : 'gather',
        }
      : null;
  }
  if (!['hurt', 'heal', 'ward'].includes(effect.kind)) return null;
  let closest: MotionActor | null = null,
    distance = 1.6;
  for (const actor of actors) {
    const d = Math.hypot(effect.x - actor.x, effect.y - actor.y);
    if (d < distance) {
      closest = actor;
      distance = d;
    }
  }
  return closest ? { id: closest.id, kind: effect.kind as 'hurt' | 'heal' | 'ward' } : null;
}
