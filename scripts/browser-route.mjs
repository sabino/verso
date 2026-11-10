/** Read-only route planning for native-input browser checks. No game state changes. */
export function routeBeyondDistance(start, origin, blocked, distance = 5, radius = 12) {
  const first = { x: Math.round(start.x), y: Math.round(start.y), parent: -1 };
  const queue = [first];
  const key = (x, y) => `${x},${y}`;
  const seen = new Set([key(first.x, first.y)]);
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (Math.hypot(point.x - origin.x, point.y - origin.y) >= distance) {
      const route = [];
      for (let i = index; i >= 0; i = queue[i].parent) route.push({ x: queue[i].x, y: queue[i].y });
      return route.reverse();
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = point.x + dx,
        y = point.y + dy,
        id = key(x, y);
      if (Math.abs(x - first.x) > radius || Math.abs(y - first.y) > radius || seen.has(id))
        continue;
      seen.add(id);
      if (!blocked(x, y)) queue.push({ x, y, parent: index });
    }
  }
  return null;
}
