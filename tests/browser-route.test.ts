import test from 'node:test';
import assert from 'node:assert/strict';
import { routeBeyondDistance } from '../scripts/browser-route.mjs';

test('remote-collection QA chooses a reachable exit instead of a clear disconnected eastern tile', () => {
  const blocked = (x: number) => x === 1;
  assert.equal(blocked(6), false, 'the old fixed eastern target looks clear');
  const route = routeBeyondDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, blocked);
  assert.ok(route);
  assert.equal(route.length, 6, 'uses a shortest cardinal route');
  assert.ok(Math.hypot(route.at(-1)!.x, route.at(-1)!.y) >= 5);
  for (let i = 0; i < route.length; i++) {
    assert.ok(route[i].x < 1, 'never leaves the connected component');
    assert.equal(blocked(route[i].x), false);
    if (i)
      assert.equal(
        Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y),
        1,
      );
  }
});

test('an enclosed player or exhausted search window fails explicitly rather than skipping collection QA', () => {
  assert.equal(
    routeBeyondDistance(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      (x: number, y: number) => Math.abs(x) === 2 || Math.abs(y) === 2,
    ),
    null,
  );
  const probes: [number, number][] = [];
  assert.equal(
    routeBeyondDistance(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      (x: number, y: number) => {
        probes.push([x, y]);
        return false;
      },
      10,
      2,
    ),
    null,
  );
  assert.equal(probes.length, 24);
  assert.ok(probes.every(([x, y]) => Math.abs(x) <= 2 && Math.abs(y) <= 2));
});
