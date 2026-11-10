import test from 'node:test';
import assert from 'node:assert/strict';
import { EnemyNavigation } from '../src/stichos/enemy-navigation.ts';

test('route observations distinguish exhausted planning budget, blocked route and timed retry', () => {
  const navigation = new EnemyNavigation();
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const barrier = (p: { x: number; y: number }) => Math.round(p.x) !== 2;
  navigation.begin(0.05, ids);
  for (const id of ids)
    assert.equal(navigation.waypoint(id, { x: 0, y: 0 }, { x: 5, y: 0 }, barrier), null);
  const first = navigation.diagnostics;
  assert.equal(first.budgetRemaining, 0);
  assert.equal(first.actors[0].state, 'unreachable');
  assert.equal(first.actors[4].state, 'waiting-budget');
  navigation.begin(0.05, ids);
  navigation.waypoint('a', { x: 0, y: 0 }, { x: 5, y: 0 }, barrier);
  assert.equal(navigation.diagnostics.actors[0].state, 'waiting-retry');
  assert.ok(navigation.diagnostics.actors[0].retryAfterSeconds! > 0);
  const before = navigation.diagnostics.budgetRemaining;
  navigation.waypoint('a', { x: 0, y: 0 }, { x: 5, y: 0 }, () => true);
  assert.equal(navigation.diagnostics.actors[0].state, 'direct');
  assert.equal(navigation.diagnostics.budgetRemaining, before);
});

test('route diagnostics are detached, invalid input is explicit and inactive observations are discarded', () => {
  const navigation = new EnemyNavigation();
  navigation.begin(0.05, ['a', 'b']);
  navigation.waypoint('a', { x: 0, y: 0 }, { x: 1, y: 0 }, () => true);
  const observation = navigation.diagnostics;
  observation.actors[0].goal!.x = 500;
  assert.equal(navigation.diagnostics.actors[0].goal!.x, 1);
  navigation.waypoint('b', { x: 0, y: 0 }, { x: NaN, y: 0 }, () => true);
  assert.equal(navigation.diagnostics.actors[1].state, 'invalid');
  navigation.begin(0.05, ['a']);
  assert.equal(navigation.diagnostics.actors.length, 1);
  navigation.clear();
  assert.equal(navigation.diagnostics.actors.length, 0);
});
