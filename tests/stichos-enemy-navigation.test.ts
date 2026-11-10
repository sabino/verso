import test from 'node:test';
import assert from 'node:assert/strict';
import { EnemyNavigation } from '../src/stichos/enemy-navigation.ts';
import { Stichos } from '../src/stichos/session.ts';
import { SharedCombat, type SharedCombatPeer } from '../src/stichos/shared-combat.ts';
import { appearance } from '../src/stichos/world.ts';
import type { Npc, Point } from '../src/stichos/types.ts';

const wall = (x: number, y: number) => Math.round(x) === 2 && Math.abs(Math.round(y)) <= 1;
const bodyClear = (p: Point, blocked = wall) =>
  [-0.21, 0.21].every((x) => [-0.21, 0.21].every((y) => !blocked(p.x + x, p.y + y)));
const npc = (id = 'navigation-raider'): Npc => ({
  id,
  name: 'Raider',
  seed: 27,
  role: 'raider',
  clan: 3,
  appearance: { ...appearance(27, 'raider', 3), weapon: 'none' },
  x: 0,
  y: 0,
  home: { x: 0, y: 0 },
  hp: 50,
  maxHp: 50,
  speed: 1.5,
  heading: 0,
  phase: 0,
  hostile: true,
  cooldown: 0,
});
const peer = (x = 5, y = 0): SharedCombatPeer => ({
  id: 'traveler',
  x,
  y,
  heading: Math.PI,
  combatActive: true,
  appearance: appearance(5, 'pilgrim', 1),
});

test('bounded routes go around cover deterministically without cutting body-sized corners', () => {
  const run = () => {
    const navigation = new EnemyNavigation(),
      actor = { x: 0.19, y: -0.18 },
      target = { x: 5, y: 0 };
    const trace: Point[] = [];
    for (let frame = 0; frame < 160; frame++) {
      navigation.begin(0.05, ['foe']);
      const next = navigation.waypoint('foe', actor, target, bodyClear);
      if (next) {
        const d = Math.hypot(next.x - actor.x, next.y - actor.y),
          step = Math.min(d, 0.075);
        if (d > 0) {
          actor.x += ((next.x - actor.x) / d) * step;
          actor.y += ((next.y - actor.y) / d) * step;
        }
      }
      assert.ok(bodyClear(actor), 'The entire body must remain outside cover.');
      trace.push({ ...actor });
    }
    assert.ok(Math.hypot(actor.x - target.x, actor.y - target.y) < 0.1);
    assert.ok(
      trace.some((p) => Math.abs(p.y) > 1.7),
      'A real detour is required.',
    );
    return trace;
  };
  assert.deepEqual(run(), run());
});

test('crowd planning is bounded and deferred enemies receive a route on later ticks', () => {
  const navigation = new EnemyNavigation(),
    ids = Array.from({ length: 20 }, (_, i) => `foe:${i}`);
  const planned = new Set<string>();
  for (let frame = 0; frame < 5; frame++) {
    navigation.begin(0.02, ids);
    for (const id of ids) {
      if (navigation.waypoint(id, { x: 0, y: 0 }, { x: 5, y: 0 }, bodyClear)) planned.add(id);
    }
    assert.equal(planned.size, (frame + 1) * 4);
  }
  navigation.begin(0.02, []);
  navigation.begin(0.02, ids);
  assert.equal(
    ids.filter((id) => navigation.waypoint(id, { x: 0, y: 0 }, { x: 5, y: 0 }, bodyClear)).length,
    4,
    'Inactive routes are discarded rather than retained for streamed actors.',
  );
});

test('unreachable routes back off, and newly opened cover is immediately traversable', () => {
  const navigation = new EnemyNavigation();
  let closed = true,
    probes = 0;
  const clear = (p: Point) => {
    probes++;
    return bodyClear(p, (x, _y) => closed && Math.round(x) === 2);
  };
  navigation.begin(0.05, ['foe']);
  assert.equal(navigation.waypoint('foe', { x: 0, y: 0 }, { x: 5, y: 0 }, clear), null);
  const first = probes;
  for (let frame = 0; frame < 10; frame++) {
    probes = 0;
    navigation.begin(0.05, ['foe']);
    assert.equal(navigation.waypoint('foe', { x: 0, y: 0 }, { x: 5, y: 0 }, clear), null);
    assert.ok(probes < first / 4, 'No full flood fill on every blocked frame.');
  }
  closed = false;
  assert.deepEqual(navigation.waypoint('foe', { x: 0, y: 0 }, { x: 5, y: 0 }, clear), {
    x: 5,
    y: 0,
  });
});

test('solo hostiles detour toward the last seen position, then wind up before damage', () => {
  const game = new Stichos(3886, 2),
    enemy = npc();
  Object.assign(game.player, { x: 5, y: 0 });
  game.world.blocked = () => false;
  game.npcs = [enemy];
  // Drive the existing NPC subsystem without world streaming replacing the fixture.
  const simulation = game as unknown as {
    updateNpcs(dt: number): void;
    actors: { register(n: Npc, kind: string, time: number): void };
  };
  simulation.actors.register(enemy, 'enemy', 0);
  simulation.updateNpcs(0.01); // Acquire a genuine visible target before cover intervenes.
  game.world.blocked = wall;
  let detour = false,
    prepared = false;
  for (let frame = 0; frame < 240 && game.player.hp === game.player.maxHp; frame++) {
    simulation.updateNpcs(0.05);
    assert.ok(bodyClear(enemy));
    detour ||= Math.abs(enemy.y) > 1.7;
    prepared ||= game.actionCues.some((cue) => cue.kind === 'telegraph');
  }
  assert.ok(detour);
  assert.ok(prepared, 'Routing must not bypass attack preparation.');
  assert.ok(
    game.player.hp < game.player.maxHp,
    'Cover should delay pursuit, not permanently disable a foe.',
  );
});

test('room authority routes ordinary and expedition foes around cover without moving a windup', () => {
  for (const id of ['navigation-raider', 'expedition:test:breaker:1']) {
    const enemy = npc(id),
      traveler = peer();
    const combat = new SharedCombat(
      {
        generation: 3,
        blocked: wall,
        propsAround: () => [],
        npcsAround: () => [structuredClone(enemy)],
      },
      new Set(),
    );
    let detour = false,
      prepared: Point | undefined,
      hit = false;
    for (let frame = 0; frame < 240 && !hit; frame++) {
      const result = combat.tick(0.05, [traveler]);
      const current = result.snapshot.enemies[0];
      assert.ok(bodyClear(current));
      detour ||= Math.abs(current.y) > 1.7;
      if (current.intent) {
        if (prepared) assert.deepEqual({ x: current.x, y: current.y }, prepared);
        prepared = { x: current.x, y: current.y };
      }
      hit ||= result.hits.some((event) => event.target === 'peer');
    }
    assert.ok(detour, id);
    assert.ok(prepared, id);
    assert.ok(hit, id);
  }
});

test('a room enemy waits at a sealed barrier and uses the actual opened door', () => {
  const enemy = npc(),
    traveler = peer();
  const blocked = (x: number, y: number, removed: Set<string> = new Set()) =>
    Math.round(x) === 2 && (Math.round(y) !== 0 || !removed.has('door:gate'));
  const combat = new SharedCombat(
    {
      generation: 3,
      blocked,
      propsAround: () => [],
      npcsAround: () => [structuredClone(enemy)],
    },
    new Set(),
  );
  for (let frame = 0; frame < 40; frame++) {
    const result = combat.tick(0.05, [traveler]);
    assert.ok(result.snapshot.enemies[0].x < 1.3);
    assert.equal(result.hits.length, 0);
  }
  let hit = false;
  for (let frame = 0; frame < 120 && !hit; frame++) {
    const result = combat.tick(0.05, [traveler], new Set(['door:gate']));
    const current = result.snapshot.enemies[0];
    assert.ok(bodyClear(current, (x, y) => blocked(x, y, new Set(['door:gate']))));
    hit ||= result.hits.some((event) => event.target === 'peer');
  }
  assert.ok(hit, 'Opening the door must release a waiting route without restoring the enemy.');
});

test('visible encounter retreat and hold rules survive obstacle navigation', () => {
  for (const archetype of ['slinger', 'warden']) {
    const enemy = npc(`expedition:test:${archetype}:1`);
    enemy.cooldown = 1;
    enemy.hp = 20;
    const combat = new SharedCombat(
      {
        generation: 3,
        blocked: () => false,
        propsAround: () => [],
        npcsAround: () => [structuredClone(enemy)],
      },
      new Set(),
    );
    const current = combat.tick(0.05, [peer(2, 0)]).snapshot.enemies[0];
    if (archetype === 'slinger') assert.ok(current.x < 0, 'A reloading slinger still retreats.');
    else
      assert.deepEqual(
        { x: current.x, y: current.y },
        { x: 0, y: 0 },
        'A wounded warden holds its ring.',
      );
  }
});
