import test from 'node:test';
import assert from 'node:assert/strict';
import { Stichos } from '../src/stichos/session.ts';
import type { ProductionKind } from '../src/stichos/production.ts';

const idle = { x: 0, y: 0, run: false };

function supplied(generation: 1 | 2 | 3 | 4 = 3) {
  const game = new Stichos(3886, generation);
  game.player.coins = 1000;
  game.inventory = { wood: 24, ore: 18, cequin: 6 };
  game.progression.xp.crafting = 80;
  return game;
}

function build(game: Stichos, kind: ProductionKind) {
  for (let y = -40; y <= 40; y += 2)
    for (let x = -40; x <= 40; x += 2) {
      Object.assign(game.player, { x, y });
      if (!game.productionPreview(kind, { x, y }).ok) continue;
      assert.equal(game.buildProduction(kind, { x, y }).ok, true);
      return game.productionStructures.at(-1)!;
    }
  assert.fail('The world needs a valid work site.');
}

test('workers cannot claim sources already reserved by a powered platform', () => {
  const game = supplied();
  Object.assign(game.player, { x: 6, y: 9 });
  assert.equal(game.buildProduction('sawmill', game.player).ok, true);
  const machine = game.productionStructures[0];
  assert.equal(game.startProduction(machine.id, 'cut-timber', 3).ok, true);
  const reserved = new Set(game.productionStructures[0].job!.sources.map((source) => source.id));
  assert.ok(reserved.has('origin:timber:1') && reserved.has('origin:timber:2'));
  const preview = game.laborPreview('origin-botanist', 'forestry');
  assert.ok(preview.ok, preview.message);
  assert.ok(preview.order.allocations.every((allocation) => !reserved.has(allocation.propId)));
  assert.equal(game.hireLabor('origin-botanist', 'forestry').ok, true);
  assert.ok(
    game.laborOrders[0].allocations.every((allocation) => !reserved.has(allocation.propId)),
  );
  assert.equal(Stichos.restore(game.save()).laborOrders.length, 1);
});

test('batch completion carries fractional work into the next batch instead of losing frame time', () => {
  let game = supplied();
  const machine = build(game, 'garden');
  assert.equal(game.startProduction(machine.id, 'grow-cequin', 2).ok, true);
  const save = game.save();
  save.production!.structures[0].job!.elapsed = 79.99;
  game = Stichos.restore(save);
  Object.assign(game.player, { x: 0, y: 5 });
  game.update(0.02, idle);
  const state = game.productionStructures[0];
  assert.equal(state.job!.completed, 1);
  assert.equal(state.output.cequin, 3);
  assert.ok(Math.abs(state.job!.elapsed - 0.01) < 1e-8);
  assert.ok(Math.abs(state.totalProgress - (1 + 0.01 / 80) / 2) < 1e-8);
  assert.ok(Math.abs(state.remainingSeconds - 79.99) < 1e-8);
  assert.ok(
    Math.abs(Stichos.restore(game.save()).productionStructures[0].job!.elapsed - 0.01) < 1e-8,
  );
});

test('surface production advances during a real dungeon expedition, but cannot be collected across floors', () => {
  let game = supplied(4);
  const machine = build(game, 'garden');
  assert.equal(game.startProduction(machine.id, 'grow-cequin', 2).ok, true);
  const save = game.save();
  save.production!.structures[0].job!.elapsed = 79.5;
  game = Stichos.restore(save);
  Object.assign(game.player, { x: 0, y: 5 });
  game.enableLivingSystems('production-expedition-review');
  const entrance = game.livingSystemsFrame!.entrances[0];
  assert.ok(entrance);
  Object.assign(game.player, { x: entrance.x, y: entrance.y });
  const entered = game.fieldCommand({
    kind: 'underworld-enter',
    settlementId: entrance.settlementId,
  });
  assert.equal(entered.ok, true, entered.message);
  assert.match(game.spaceId, /^underground:/);
  for (let i = 0; i < 3; i++) game.update(0.25, idle);
  assert.equal(game.phase, 'playing');
  assert.equal(game.productionStructures[0].output.cequin, 3);
  assert.equal(game.productionStructures[0].job!.completed, 1);

  // Matching x/y is not proximity when the player occupies another floor.
  Object.assign(game.player, { x: machine.x, y: machine.y });
  const inventory = structuredClone(game.inventory);
  assert.equal(game.productionPreview('garden', game.player).ok, false);
  assert.equal(game.collectProduction(machine.id).ok, false);
  assert.equal(game.cancelProduction(machine.id).ok, false);
  assert.equal(game.hireLabor('origin-botanist', 'garden').ok, false);
  assert.deepEqual(game.inventory, inventory);
  assert.equal(game.productionStructures[0].output.cequin, 3);
});

test('dismantling an empty solo platform salvages once and frees the eight-platform limit without reusing IDs', () => {
  const game = supplied();
  game.inventory = { wood: 43, ore: 9 };
  const first = build(game, 'garden');
  for (let i = 1; i < 8; i++) build(game, 'garden');
  assert.equal(game.productionStructures.length, 8);
  assert.match(game.productionPreview('garden', game.player).message, /eight/);
  Object.assign(game.player, { x: first.x, y: first.y });
  const coins = game.player.coins;
  const xp = game.progression.xp.crafting;
  const inventory = structuredClone(game.inventory);
  const result = game.dismantleProduction(first.id);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.salvage, { wood: 2 });
  assert.equal(game.inventory.wood, inventory.wood! + 2);
  assert.equal(game.inventory.ore, inventory.ore);
  assert.equal(game.player.coins, coins);
  assert.equal(game.progression.xp.crafting, xp, 'Dismantling grants no practice.');
  assert.equal(game.productionStructures.length, 7);
  assert.equal(game.dismantleProduction(first.id).ok, false);
  assert.equal(game.inventory.wood, inventory.wood! + 2, 'Salvage cannot be collected twice.');
  assert.equal(game.buildProduction('garden', first).ok, true);
  assert.equal(game.productionStructures.at(-1)!.id, 'production:9');
  assert.equal(game.player.coins, coins - 35, 'Rebuilding still spends the full coin price.');
  assert.deepEqual(game.inventory, {}, 'Rebuilding consumes more material than salvage returns.');
  const restored = Stichos.restore(game.save());
  assert.equal(restored.productionStructures.length, 8);
  assert.ok(restored.productionStructures.every((s) => s.id !== first.id));
  assert.equal(restored.nextProductionId, 'production:10');
});

test('dismantling refuses working, stocked, distant, or capacity-blocked platforms atomically', () => {
  let game = supplied();
  const machine = build(game, 'garden');
  assert.equal(game.startProduction(machine.id, 'grow-cequin', 1).ok, true);
  assert.equal(game.dismantleProduction(machine.id).ok, false);
  const save = game.save();
  save.production!.structures[0].job = null;
  save.production!.structures[0].output = { cequin: 3 };
  game = Stichos.restore(save);
  assert.equal(game.dismantleProduction(machine.id).ok, false);
  assert.equal(game.collectProduction(machine.id).ok, true);
  Object.assign(game.player, { x: machine.x + 10, y: machine.y });
  assert.equal(game.dismantleProduction(machine.id).ok, false);
  Object.assign(game.player, { x: machine.x, y: machine.y });
  game.inventory = { wood: game.capacity };
  assert.equal(game.dismantleProduction(machine.id).ok, false);
  assert.equal(game.productionStructures.length, 1);
  assert.deepEqual(game.inventory, { wood: game.capacity });
});

test('shared platform registration remains protected after disconnect and save restoration', () => {
  let game = supplied();
  const machine = build(game, 'garden');
  game.setSharedWorld(true);
  assert.equal(game.dismantleProduction(machine.id).ok, false);
  game.setSharedWorld(false);
  assert.match(game.dismantleProductionPreview(machine.id).message, /Shared-world/);
  game = Stichos.restore(game.save());
  assert.equal(game.productionStructures[0].sharedRegistration, true);
  assert.equal(game.dismantleProduction(machine.id).ok, false);

  const legacy = game.save();
  delete legacy.production!.structures[0].sharedRegistration;
  legacy.sharedCombatLedger = {
    room: 'remembered-room',
    sequence: -1,
    receipts: [],
    floor: 0,
    acknowledged: 0,
    ineligible: [],
  };
  const migrated = Stichos.restore(legacy);
  assert.equal(migrated.dismantleProduction(machine.id).ok, false);
  const malformed = game.save();
  (malformed.production!.structures[0] as any).sharedRegistration = 'yes';
  assert.throws(() => Stichos.restore(malformed));
});
