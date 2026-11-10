import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HierarchicalNavigator,
  TravelController,
  NAVIGATION_RULES,
  type NavigationWorld,
} from '../src/stichos/navigation.ts';
import {
  ActorLedger,
  validActorLedgerSave,
  ACTOR_LEDGER_RULES,
} from '../src/stichos/actor-ledger.ts';
import type { Point } from '../src/stichos/types.ts';

const flat: NavigationWorld = { cell: () => ({ kind: 'open' }) };
test('actors entering fine simulation release coarse planner slots for other migrants', () => {
  const ledger = new ActorLedger<{ id: string; x: number; y: number }>();
  for (let i = 0; i < 12; i++) {
    const id = `actor-${String(i).padStart(2, '0')}`;
    ledger.register({ id, x: 0, y: i }, 'npc', 0);
    ledger.setDestination(id, { spaceId: 'surface', x: 90, y: i });
  }
  for (let t = 1; t <= 15; t++) ledger.advance(t, () => flat);
  const active = new Set(
    Array.from({ length: 8 }, (_, i) => `actor-${String(i).padStart(2, '0')}`),
  );
  for (let t = 16; t < 2000; t++) ledger.advance(t, () => flat, { active });
  for (let i = 8; i < 12; i++) assert.ok(ledger.get(`actor-${String(i).padStart(2, '0')}`)!.x > 0);
  assert.ok(ledger.diagnostics.navigators <= 8);
});
const finish = (navigation: HierarchicalNavigator) => {
  for (let ticks = 0; navigation.status === 'planning' && ticks < 10000; ticks++) {
    const work = navigation.diagnostics.work;
    navigation.step();
    assert.ok(navigation.diagnostics.work - work <= NAVIGATION_RULES.workPerTick);
  }
  return navigation.status;
};
const assertWalking = (origin: Point, route: readonly Point[], world: NavigationWorld) => {
  let previous = origin;
  for (const p of route) {
    assert.equal(Math.abs(p.x - previous.x) + Math.abs(p.y - previous.y), 1);
    assert.notEqual(world.cell(p.x, p.y).kind, 'blocked');
    previous = p;
  }
};

test('hierarchical travel crosses multiple chunks through one-tile gate, never skipping cells', () => {
  const world: NavigationWorld = {
    cell: (x, y) => ({ kind: x === 31 && y !== 27 ? 'blocked' : 'open' }),
  };
  const nav = new HierarchicalNavigator(world);
  nav.request({ x: 2, y: 2 }, { x: 90, y: 2 });
  assert.equal(finish(nav), 'ready');
  assertWalking({ x: 2, y: 2 }, nav.route, world);
  assert.ok(nav.route.some((p) => p.x === 31 && p.y === 27));
  assert.deepEqual(nav.route.at(-1), { x: 90, y: 2 });
  assert.ok(nav.portals.length >= 5);
  const replay = new HierarchicalNavigator(world);
  replay.request({ x: 2, y: 2 }, { x: 90, y: 2 });
  while (replay.status === 'planning') replay.step(7);
  assert.deepEqual(replay.route, nav.route, 'frame budgets do not change the chosen route');
});

test('component search detects actual sealed destination and bounded incomplete searches honestly', () => {
  const box: NavigationWorld = {
    cell: (x, y) => ({ kind: Math.abs(x) > 8 || Math.abs(y) > 8 || x === 4 ? 'blocked' : 'open' }),
  };
  const nav = new HierarchicalNavigator(box);
  nav.request({ x: 0, y: 0 }, { x: 7, y: 0 });
  assert.equal(finish(nav), 'unreachable');
  nav.request({ x: 0, y: 0 }, { x: NaN, y: 0 });
  assert.equal(nav.status, 'unreachable');
  const huge = new HierarchicalNavigator(flat);
  huge.request({ x: 0, y: 0 }, { x: 10000, y: 0 });
  assert.equal(finish(huge), 'budget-exceeded');
  assert.equal(huge.diagnostics.sectors, NAVIGATION_RULES.maxSectors);
});

test('permission-aware doors are route portals but require one real opening request', () => {
  let open = false;
  const world: NavigationWorld = {
    cell: (x, y) =>
      y !== 0
        ? { kind: 'blocked' }
        : x === 2
          ? { kind: 'door', id: 'home:door', allowed: true, open }
          : { kind: 'open' },
  };
  const travel = new TravelController(world);
  travel.travel({ x: 0, y: 0 }, { x: 4, y: 0 }, { label: 'Go home' });
  const position = { x: 0, y: 0 };
  let requests = 0;
  for (let i = 0; i < 1000 && travel.active; i++) {
    const input = travel.update({ position, dt: 0.05, manual: { x: 0, y: 0, run: false } });
    if (input.doorId) {
      requests++;
      open = true;
    }
    position.x += input.x * 0.1;
    position.y += input.y * 0.1;
  }
  assert.equal(requests, 1);
  assert.equal(travel.feedback.state, 'arrived');
  assert.ok(Math.abs(position.x - 4) < 0.2);
  const locked = new HierarchicalNavigator({
    cell: (x, y) =>
      y !== 0 || Math.abs(x) > 8
        ? { kind: 'blocked' }
        : x === 2
          ? { kind: 'door', id: 'private', allowed: false }
          : { kind: 'open' },
  });
  locked.request({ x: 0, y: 0 }, { x: 4, y: 0 });
  assert.equal(finish(locked), 'unreachable');
});

test('direction lock cancels immediately on manual action, danger, overlays, background and obstruction', () => {
  const travel = new TravelController(flat);
  const base = { position: { x: 0, y: 0 }, dt: 0.016, manual: { x: 0, y: 0, run: false } };
  assert.equal(travel.lock({ x: 0, y: 0 }), false);
  travel.lock({ x: 1, y: 1 }, true);
  const run = travel.update(base);
  assert.equal(run.run, true);
  assert.ok(Math.abs(Math.hypot(run.x, run.y) - 1) < 1e-9);
  assert.deepEqual(travel.update({ ...base, manual: { x: -1, y: 0, run: false } }), {
    x: -1,
    y: 0,
    run: false,
  });
  assert.equal(travel.active, false);
  for (const paused of ['menu', 'dialogue', 'death', 'background', 'interaction'] as const) {
    travel.lock({ x: 1, y: 0 });
    assert.deepEqual(travel.update({ ...base, paused }), { x: 0, y: 0, run: false });
    assert.equal(travel.feedback.reason, paused);
  }
  travel.lock({ x: 1, y: 0 });
  travel.update({ ...base, danger: true });
  assert.equal(travel.feedback.reason, 'danger');
  const wall = new TravelController({ cell: () => ({ kind: 'blocked' }) });
  wall.lock({ x: 1, y: 0 });
  assert.deepEqual(wall.update(base), { x: 0, y: 0, run: false });
  assert.equal(wall.feedback.reason, 'obstruction');
});

test('walking never crosses dynamically closed obstacles and replans with bounded work', () => {
  let blocked = false;
  const world: NavigationWorld = {
    cell: (x, y) => ({
      kind: Math.abs(y) > 3 || (blocked && x === 3 && y === 0) ? 'blocked' : 'open',
    }),
  };
  const travel = new TravelController(world),
    position = { x: 0, y: 0 };
  travel.travel(position, { x: 6, y: 0 });
  let detoured = false;
  for (let t = 0; t < 2000 && travel.active; t++) {
    if (position.x >= 1) blocked = true;
    const input = travel.update({ position, dt: 0.05, manual: { x: 0, y: 0, run: false } });
    position.x += input.x * 0.08;
    position.y += input.y * 0.08;
    assert.notEqual(world.cell(Math.round(position.x), Math.round(position.y)).kind, 'blocked');
    detoured ||= Math.abs(position.y) > 0.6;
  }
  assert.equal(travel.feedback.state, 'arrived');
  assert.ok(detoured);
});

interface Body extends Point {
  id: string;
  hp: number;
  name: string;
}
const validBody = (v: unknown): v is Body =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Body).id === 'string' &&
  typeof (v as Body).name === 'string' &&
  Number.isFinite((v as Body).hp);
const body = (id = 'migrant'): Body => ({ id, x: 0, y: 0, hp: 50, name: 'A remembered person' });

test('actor existence, destination, identity and consequences survive culling, migration and checkpoint', () => {
  const ledger = new ActorLedger<Body>();
  ledger.register(body(), 'worker', 0);
  ledger.setDestination('migrant', { spaceId: 'surface', x: 90, y: 0 });
  let previous = ledger.get('migrant')!;
  for (let t = 1; t < 4000; t++) {
    ledger.advance(t * 0.25, () => flat);
    const current = ledger.get('migrant')!;
    assert.ok(
      Math.hypot(current.x - previous.x, current.y - previous.y) <=
        ACTOR_LEDGER_RULES.maxCoarseDistance + 1e-8,
    );
    assert.equal(current.body.hp, 50);
    previous = current;
    if (current.state === 'arrived') break;
  }
  assert.equal(previous.state, 'arrived');
  assert.equal(ledger.query({ spaceId: 'surface', x: 0, y: 0 }, 18).length, 0);
  assert.equal(ledger.query({ spaceId: 'surface', x: 90, y: 0 }, 2)[0].id, 'migrant');
  const saved = ledger.snapshot();
  assert.equal(validActorLedgerSave(saved, validBody), true);
  const restored = new ActorLedger(saved, validBody);
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.get('migrant')?.destination?.x, 90);
  restored.register({ ...body(), x: 0, hp: 999 }, 'npc', 2000);
  assert.equal(
    restored.get('migrant')?.body.hp,
    50,
    'procedural rediscovery cannot regenerate an existing actor',
  );
});

test('actors change spaces only through an explicit transition and dead identities remain tombstoned', () => {
  const ledger = new ActorLedger<Body>();
  ledger.register(body(), 'enemy', 0);
  ledger.setDestination('migrant', { spaceId: 'underground:town:1', x: 0, y: 0 });
  ledger.advance(200000, () => flat);
  assert.equal(ledger.get('migrant')?.spaceId, 'surface');
  assert.equal(ledger.get('migrant')?.state, 'waiting');
  assert.equal(
    ledger.transition('migrant', { spaceId: 'underground:town:1', x: 0, y: 0 }, 200001),
    true,
  );
  assert.equal(ledger.query({ spaceId: 'surface', x: 0, y: 0 }, 5).length, 0);
  assert.equal(ledger.query({ spaceId: 'underground:town:1', x: 0, y: 0 }, 5).length, 1);
  ledger.markDead('migrant');
  assert.equal(ledger.query({ spaceId: 'underground:town:1', x: 0, y: 0 }, 5).length, 0);
  assert.equal(ledger.has('migrant'), true);
  assert.equal(ledger.setDestination('migrant', { spaceId: 'surface', x: 1, y: 1 }), false);
});

test('explicitly retrying an unreachable actor destination resumes without restarting synchronized journeys', () => {
  let sealed = true;
  const world: NavigationWorld = {
    cell: (x, y) => ({
      kind: Math.abs(y) > 3 || x < -3 || x > 6 || (sealed && x === 2) ? 'blocked' : 'open',
    }),
  };
  const ledger = new ActorLedger<Body>(),
    target = { spaceId: 'surface', x: 4, y: 0 };
  ledger.register(body(), 'npc', 0);
  ledger.setDestination('migrant', target);
  let time = 0;
  for (; time < 3000 && ledger.get('migrant')!.state !== 'unreachable'; time++)
    ledger.advance(time + 1, () => world);
  assert.equal(ledger.get('migrant')!.state, 'unreachable');

  sealed = false;
  const failed = ledger.get('migrant')!;
  for (let tick = 0; tick < 30; tick++) {
    ledger.setDestination('migrant', target);
    ledger.advance(++time, () => world);
  }
  assert.deepEqual(
    ledger.get('migrant'),
    failed,
    'Routine intention synchronization cannot poll or reset a failed route.',
  );
  assert.equal(ledger.setDestination('migrant', target, { retry: true }), true);
  assert.equal(ledger.get('migrant')!.state, 'planning');
  assert.equal(ledger.get('migrant')!.revision, failed.revision + 1);

  let reached = false;
  const observed = new Set<string>();
  for (let tick = 0; tick < 3000; tick++) {
    const before = ledger.get('migrant')!;
    observed.add(before.state);
    assert.equal(ledger.setDestination('migrant', target), true);
    assert.equal(ledger.setDestination('migrant', target, { retry: true }), true);
    assert.deepEqual(
      ledger.get('migrant'),
      before,
      'Identical active intentions preserve all progress.',
    );
    ledger.advance(++time, () => world);
    const after = ledger.get('migrant')!;
    assert.ok(
      Math.hypot(after.x - before.x, after.y - before.y) <= ACTOR_LEDGER_RULES.maxCoarseDistance,
    );
    assert.notEqual(world.cell(Math.round(after.x), Math.round(after.y)).kind, 'blocked');
    assert.ok(ledger.diagnostics.navigators <= ACTOR_LEDGER_RULES.maxNavigators);
    if (after.state === 'arrived') {
      reached = true;
      break;
    }
  }
  assert.ok(observed.has('planning'));
  assert.ok(observed.has('traveling'));
  assert.ok(reached, 'Retry must reach the same target through the now-open passage.');
  const arrived = ledger.get('migrant')!;
  ledger.setDestination('migrant', target, { retry: true });
  assert.deepEqual(ledger.get('migrant'), arrived, 'Completed intentions remain idempotent.');
});

test('ledger admission saturation never erases existing identity, and malformed saves are rejected', () => {
  const ledger = new ActorLedger<Body>();
  for (let i = 0; i < ACTOR_LEDGER_RULES.maxActors; i++)
    assert.equal(ledger.register(body(`actor:${i}`), 'npc', 0), true);
  assert.equal(ledger.register(body('extra'), 'npc', 0), false);
  assert.equal(ledger.has('actor:0'), true);
  assert.equal(ledger.size, ACTOR_LEDGER_RULES.maxActors);
  const saved = ledger.snapshot();
  assert.equal(
    validActorLedgerSave({ ...saved, actors: [saved.actors[0], saved.actors[0]] }, validBody),
    false,
  );
  assert.equal(
    validActorLedgerSave({ version: 1, actors: [{ ...saved.actors[0], x: Infinity }] }, validBody),
    false,
  );
  assert.throws(
    () =>
      new ActorLedger(
        { version: 1, actors: [{ ...saved.actors[0], state: 'teleport' as any }] },
        validBody,
      ),
  );
});

test('actor snapshots reject unknown or inherited wrapper and address fields', () => {
  const ledger = new ActorLedger<Body>();
  ledger.register(body(), 'npc', 0);
  ledger.setDestination('migrant', { spaceId: 'surface', x: 40, y: 0 });
  const saved = ledger.snapshot();
  const actor = saved.actors[0];
  const malformed = [
    { ...saved, microphone: 'synthetic sentinel' },
    { ...saved, actors: [{ ...actor, audio: 'synthetic sentinel' }] },
    { ...saved, actors: [{ ...actor, home: { ...actor.home, microphone: 'synthetic sentinel' } }] },
    { ...saved, actors: [{ ...actor, destination: { ...actor.destination, vfx: [] } }] },
    Object.assign(Object.create({ microphone: 'synthetic sentinel' }), saved),
    { ...saved, actors: [Object.assign(Object.create({ audio: 'synthetic sentinel' }), actor)] },
    { ...saved, actors: [{ ...actor, home: Object.assign([], actor.home) }] },
  ];
  for (const candidate of malformed) {
    assert.equal(validActorLedgerSave(candidate, validBody), false);
    assert.throws(() => new ActorLedger(candidate, validBody), /Invalid actor ledger checkpoint/);
  }
  assert.deepEqual(new ActorLedger(saved, validBody).snapshot(), saved);
});

test('runtime actor addresses retain coordinates without persisting richer caller metadata', () => {
  const ledger = new ActorLedger<Body>();
  const home = { spaceId: 'surface', x: 0, y: 0, audio: 'synthetic sentinel' };
  const destination = { spaceId: 'surface', x: 5, y: 0, vfx: ['synthetic sentinel'] };
  ledger.register(body(), 'npc', 0, { home });
  ledger.setDestination('migrant', destination);
  const saved = ledger.snapshot();
  assert.deepEqual(saved.actors[0].home, { spaceId: 'surface', x: 0, y: 0 });
  assert.deepEqual(saved.actors[0].destination, { spaceId: 'surface', x: 5, y: 0 });
  assert.equal(validActorLedgerSave(saved, validBody), true);
  assert.equal(ledger.query({ ...home, id: 'camera' } as typeof home, 3).length, 1);
});

test('same-tick repeated actor captures are read-only while actual body edits increment once', () => {
  const ledger = new ActorLedger<Body>();
  ledger.register(body(), 'npc', 10);
  const saved = ledger.snapshot();
  for (let n = 0; n < 20; n++) ledger.update(structuredClone(saved.actors[0].body), 10);
  assert.deepEqual(ledger.snapshot(), saved);
  ledger.update({ ...saved.actors[0].body, hp: 43 }, 10);
  assert.equal(ledger.get('migrant')!.revision, 1);
  assert.equal(ledger.get('migrant')!.body.hp, 43);
  ledger.update({ ...saved.actors[0].body, hp: 43 }, 10);
  assert.equal(ledger.get('migrant')!.revision, 1);
});

test('trusted checkpoint forks preserve records and detach body, destination, index and later mutations', () => {
  const ledger = new ActorLedger<Body>();
  ledger.register(body(), 'npc', 10);
  ledger.setDestination('migrant', { spaceId: 'surface', x: 20, y: 0 });
  const before = ledger.snapshot(),
    copy = ledger.fork();
  assert.deepEqual(copy.snapshot(), before);
  copy.update({ ...body(), x: 4, hp: 43 }, 11);
  copy.setDestination('migrant', { spaceId: 'surface', x: 40, y: 0 });
  copy.register(body('other'), 'npc', 11);
  assert.deepEqual(ledger.snapshot(), before);
  assert.equal(ledger.query({ spaceId: 'surface', x: 0, y: 0 }, 1).length, 1);
  assert.equal(copy.query({ spaceId: 'surface', x: 4, y: 0 }, 1).length, 1);
  ledger.markDead('migrant');
  assert.notEqual(copy.get('migrant')!.state, 'dead');
  assert.equal(ledger.has('other'), false);
});

test('legacy arrived-away checkpoints resume during simulation while hydration and snapshots stay observational', () => {
  const ledger = new ActorLedger<Body>();
  ledger.register(body(), 'worker', 10);
  ledger.setDestination('migrant', { spaceId: 'surface', x: 4, y: 0 });
  const old = ledger.snapshot();
  old.actors[0].state = 'arrived';
  assert.equal(validActorLedgerSave(old, validBody), true);
  const restored = new ActorLedger(old, validBody);
  assert.deepEqual(restored.snapshot(), old);
  restored.advance(11, () => flat);
  assert.equal(restored.get('migrant')!.state, 'planning');
  for (let t = 12; t < 100 && restored.get('migrant')!.state !== 'arrived'; t++)
    restored.advance(t, () => flat);
  assert.equal(restored.get('migrant')!.state, 'arrived');
  assert.equal(restored.get('migrant')!.x, 4);
});

test('displacing an arrived actor reopens its remembered journey without inventing floor transitions', () => {
  const ledger = new ActorLedger<Body>();
  const target = { spaceId: 'surface', x: 4, y: 0 };
  ledger.register(body(), 'worker', 0);
  ledger.setDestination('migrant', target);
  let time = 0;
  while (++time < 500 && ledger.get('migrant')!.state !== 'arrived')
    ledger.advance(time, () => flat);
  const arrived = ledger.get('migrant')!;
  assert.equal(arrived.state, 'arrived');
  ledger.update({ ...arrived.body, hp: 43 }, ++time);
  assert.equal(
    ledger.get('migrant')!.state,
    'arrived',
    'non-spatial updates do not reopen a journey',
  );
  ledger.update({ ...arrived.body, x: target.x - 0.2 }, ++time);
  assert.equal(
    ledger.get('migrant')!.state,
    'arrived',
    'small position corrections remain inside arrival tolerance',
  );
  ledger.update({ ...arrived.body, x: 0 }, ++time);
  assert.equal(ledger.get('migrant')!.state, 'planning');
  assert.deepEqual(ledger.get('migrant')!.destination, target);
  const displaced = ledger.snapshot();
  const restored = new ActorLedger(displaced, validBody);
  assert.deepEqual(restored.snapshot(), displaced);
  restored.setDestination('migrant', target);
  assert.deepEqual(
    restored.snapshot(),
    displaced,
    'same-goal synchronization preserves the resumed search',
  );
  while (++time < 1000 && restored.get('migrant')!.state !== 'arrived')
    restored.advance(time, () => flat);
  assert.equal(restored.get('migrant')!.state, 'arrived');
  assert.equal(
    restored.transition('migrant', { spaceId: 'underground:fixture', x: 4, y: 0 }, ++time),
    true,
  );
  assert.equal(restored.get('migrant')!.state, 'planning');
  restored.advance(++time, () => flat);
  assert.equal(restored.get('migrant')!.state, 'waiting');
  assert.equal(
    restored.get('migrant')!.spaceId,
    'underground:fixture',
    'navigation cannot manufacture a return to the destination floor',
  );
  restored.markDead('migrant');
  restored.update({ ...arrived.body, x: 0 }, ++time);
  assert.equal(restored.get('migrant')!.state, 'dead');
});
