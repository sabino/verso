import { findWalkingPath } from './pathfinding.ts';
import type { Point } from './types.ts';

interface Route {
  goal: Point;
  points: Point[];
  retryAt: number;
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

  begin(dt: number, active: Iterable<string>) {
    this.elapsed += Math.max(0, Math.min(dt, 0.25));
    this.budget = 4;
    const retained = new Set(active);
    for (const id of this.routes.keys()) if (!retained.has(id)) this.routes.delete(id);
  }

  clear() {
    this.routes.clear();
  }

  waypoint(
    id: string,
    origin: Point,
    target: Point,
    clear: (point: Point) => boolean,
  ): Point | null {
    const d = distance(origin, target);
    if (!Number.isFinite(d)) return null;
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
      return destination;
    }
    const goal = { x: Math.round(destination.x), y: Math.round(destination.y) };
    let route = this.routes.get(id);
    if (route) {
      while (route.points.length && distance(origin, route.points[0]) < 0.12) route.points.shift();
      if (route.points.length && !segmentClear(route.points[0])) route.points = [];
    }
    if (
      this.budget > 0 &&
      (!route ||
        (this.elapsed >= route.retryAt &&
          (!route.points.length || distance(route.goal, goal) >= 1)))
    ) {
      this.budget--;
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
    return next && segmentClear(next) ? next : null;
  }
}
