import { findWalkingPath } from './pathfinding.ts';
import type { Point } from './types.ts';

interface Route {
  goal: Point;
  points: Point[];
  retryAt: number;
}
type RouteDecision =
  | 'direct'
  | 'following'
  | 'unreachable'
  | 'waiting-budget'
  | 'waiting-retry'
  | 'invalid';
interface RouteObservation {
  state: RouteDecision;
  goal: Point | null;
  remainingPoints: number;
  retryAt: number | null;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Local, disposable steering shared by solo and room authorities. Searches never
 * open doors, reveal targets, or enter saves. A crowd has a fixed planning budget;
 * failed routes wait before retrying instead of flooding the world every frame.
 */
export class EnemyNavigation {
  private routes = new Map<string, Route>();
  private elapsed = 0;
  private budget = 0;
  private observations = new Map<string, RouteObservation>();

  begin(dt: number, active: Iterable<string>) {
    this.elapsed += Math.max(0, Math.min(dt, 0.25));
    this.budget = 4;
    const retained = new Set(active);
    for (const id of this.routes.keys()) if (!retained.has(id)) this.routes.delete(id);
    for (const id of this.observations.keys()) if (!retained.has(id)) this.observations.delete(id);
  }

  clear() {
    this.routes.clear();
    this.observations.clear();
  }

  get diagnostics() {
    return {
      schemaVersion: 1 as const,
      elapsed: this.elapsed,
      budgetRemaining: this.budget,
      actors: [...this.observations]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, observation]) => ({
          id,
          state: observation.state,
          goal: observation.goal && { ...observation.goal },
          remainingPoints: observation.remainingPoints,
          retryAfterSeconds:
            observation.retryAt === null ? null : Math.max(0, observation.retryAt - this.elapsed),
        })),
    };
  }

  private observe(id: string, state: RouteDecision, goal: Point | null, route?: Route) {
    this.observations.set(id, {
      state,
      goal: goal && { ...goal },
      remainingPoints: route?.points.length ?? 0,
      retryAt:
        state === 'waiting-retry' || state === 'unreachable' ? (route?.retryAt ?? null) : null,
    });
    // This is disposable presentation history, never a movement/reward authority.
    while (this.observations.size > 128)
      this.observations.delete(this.observations.keys().next().value!);
  }

  waypoint(
    id: string,
    origin: Point,
    target: Point,
    clear: (point: Point) => boolean,
  ): Point | null {
    const d = distance(origin, target);
    if (!Number.isFinite(d)) {
      this.observe(id, 'invalid', null);
      return null;
    }
    // Returning home may span more than the local planning window.
    const destination =
      d > 8
        ? {
            x: origin.x + ((target.x - origin.x) / d) * 8,
            y: origin.y + ((target.y - origin.y) / d) * 8,
          }
        : target;
    const segmentClear = (to: Point) => {
      const steps = Math.max(1, Math.ceil(distance(origin, to) / 0.25));
      for (let i = 1; i <= steps; i++)
        if (
          !clear({
            x: origin.x + ((to.x - origin.x) * i) / steps,
            y: origin.y + ((to.y - origin.y) * i) / steps,
          })
        )
          return false;
      return true;
    };
    if (segmentClear(destination)) {
      this.routes.delete(id);
      this.observe(id, 'direct', destination);
      return destination;
    }
    const goal = { x: Math.round(destination.x), y: Math.round(destination.y) };
    let route = this.routes.get(id);
    if (route) {
      while (route.points.length && distance(origin, route.points[0]) < 0.12) route.points.shift();
      if (route.points.length && !segmentClear(route.points[0])) route.points = [];
    }
    let searched = false;
    if (
      this.budget > 0 &&
      (!route ||
        (this.elapsed >= route.retryAt &&
          (!route.points.length || distance(route.goal, goal) >= 1)))
    ) {
      this.budget--;
      searched = true;
      const start = { x: Math.round(origin.x), y: Math.round(origin.y) };
      const points = findWalkingPath(origin, [goal], (x, y) => !clear({ x, y }), {
        radius: 10,
        maxVisited: 192,
      });
      // Reach the center before taking the first orthogonal edge: a fractional
      // starting position must not cut a blocked corner on its way to that edge.
      if (points.length && distance(origin, start) >= 0.12) points.unshift(start);
      route = { goal, points, retryAt: this.elapsed + 0.65 };
      this.routes.set(id, route);
    }
    const next = route?.points[0];
    if (next && segmentClear(next)) {
      this.observe(id, 'following', goal, route);
      return next;
    }
    this.observe(
      id,
      searched
        ? 'unreachable'
        : route && this.elapsed < route.retryAt
          ? 'waiting-retry'
          : 'waiting-budget',
      goal,
      route,
    );
    return null;
  }
}
