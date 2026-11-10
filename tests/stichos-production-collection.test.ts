import test from 'node:test';
import assert from 'node:assert/strict';
import { Stichos } from '../src/stichos/session.ts';

function garden() {
  const game = new Stichos(3886);
  game.player.coins = 100;
  game.inventory = { wood: 15, ore: 1, cequin: 10 };
  Object.assign(game.player, { x: 6, y: 9 });
  assert.equal(game.buildProduction('garden', game.player).ok, true);
  return game;
}

test('stored production can be collected in capacity-limited trips without losing output or farming practice', () => {
  let game = garden();
  const id = game.productionStructures[0].id;
  const save = game.save();
  // A previously produced mixed store; collection must also recover older full platforms.
  save.production!.structures[0].output = { emberroot: 18, cequin: 21, heartleaf: 21 };
  game = Stichos.restore(save);
  game.inventory = { wood: game.capacity - 4 };
  const practice = game.progression.xp.crafting;
  const first = game.collectProduction(id);
  assert.equal(first.ok, true, first.message);
  assert.deepEqual(first.output, { cequin: 4 });
  assert.equal(game.carried, game.capacity);
  assert.deepEqual(game.productionStructures[0].output, {
    emberroot: 18,
    cequin: 17,
    heartleaf: 21,
  });
  assert.equal(game.progression.xp.crafting, practice, 'A partial trip grants no extra practice.');
  assert.match(first.message, /56.*remain/i);
  const fullPack = game.save();
  assert.equal(game.collectProduction(id).ok, false);
  assert.deepEqual(game.save(), fullPack, 'A full satchel leaves all stored goods intact.');

  game = Stichos.restore(game.save());
  game.inventory = {};
  const second = game.collectProduction(id);
  assert.equal(second.ok, true, second.message);
  assert.deepEqual(second.output, { cequin: 17, emberroot: 18, heartleaf: 21 });
  assert.equal(game.carried, 56);
  assert.deepEqual(game.productionStructures[0].output, {});
  assert.equal(game.progression.xp.crafting, practice + 2);
  assert.equal(game.collectProduction(id).ok, false);
  assert.deepEqual(Stichos.restore(game.save()).inventory, game.inventory);
});

test('job preview retains total requirements on insufficient inputs, distance, and full storage without spending', () => {
  let game = garden();
  const id = game.productionStructures[0].id;
  game.inventory = { wood: 1, cequin: 1 };
  const before = game.save();
  const preview = game.productionJobPreview(id, 'grow-cequin', 5);
  assert.equal(preview.ok, false);
  assert.deepEqual(preview.inputs, { cequin: 5, wood: 5 });
  assert.deepEqual(preview.output, { cequin: 15 });
  assert.equal(preview.seconds, 400);
  assert.equal(preview.availableSources, null);
  assert.deepEqual(game.save(), before);

  Object.assign(game.player, { x: 0, y: 5 });
  const distant = game.productionJobPreview(id, 'grow-cequin', 3);
  assert.equal(distant.ok, false);
  assert.deepEqual(distant.inputs, { cequin: 3, wood: 3 });
  assert.deepEqual(distant.output, { cequin: 9 });
  assert.equal(distant.seconds, 240);

  Object.assign(game.player, { x: 6, y: 9 });
  const saved = game.save();
  saved.production!.structures[0].output = { cequin: 60 };
  game = Stichos.restore(saved);
  game.inventory = { cequin: 5, wood: 5 };
  const full = game.productionJobPreview(id, 'grow-cequin', 5);
  assert.equal(full.ok, false);
  assert.match(full.message, /stored output/);
  assert.deepEqual(full.output, { cequin: 15 });
  assert.equal(full.seconds, 400);
  const snapshot = game.save();
  assert.equal(game.startProduction(id, 'grow-cequin', 5).ok, false);
  assert.deepEqual(game.save(), snapshot);
});

test('a carried invention does not force scrapping equipment to retrieve a full platform', () => {
  let game = garden();
  const id = game.productionStructures[0].id;
  game.progression.xp.crafting = 80;
  game.player.coins = 1000;
  Object.assign(game.player, { x: 4, y: 5 });
  const design = game.nextArtifactDesign;
  game.inventory = { ...game.artifactPreview(design).genome!.cost.items };
  const created = game.createArtifact(design);
  assert.equal(created.ok, true, created.message);
  assert.equal(game.artifacts.length, 1);
  assert.equal(game.carried, 1);
  Object.assign(game.player, { x: 6, y: 9 });
  const save = game.save();
  save.production!.structures[0].output = { cequin: 60 };
  game = Stichos.restore(save);
  const collected = game.collectProduction(id);
  assert.equal(collected.ok, true, collected.message);
  assert.deepEqual(collected.output, { cequin: 59 });
  assert.deepEqual(game.productionStructures[0].output, { cequin: 1 });
  assert.equal(game.artifacts[0].design, design);
  const restored = Stichos.restore(game.save());
  assert.equal(restored.carried, 60);
  assert.equal(restored.artifacts[0].design, design);
  assert.deepEqual(restored.productionStructures[0].output, { cequin: 1 });
});

test('nearby resource preview counts finite unreserved sources even when the selected inputs are missing', () => {
  const game = new Stichos(3886);
  game.progression.xp.crafting = 80;
  game.player.coins = 1000;
  game.inventory = { wood: 6, ore: 4 };
  Object.assign(game.player, { x: 6, y: 9 });
  assert.equal(game.buildProduction('sawmill', game.player).ok, true);
  const id = game.productionStructures[0].id;
  const empty = game.productionJobPreview(id, 'cut-timber', 3);
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.inputs, { ore: 3 });
  assert.deepEqual(empty.output, { wood: 12 });
  assert.equal(empty.seconds, 165);
  assert.ok(empty.availableSources! >= 3);

  game.inventory = { ore: 3 };
  const ready = game.productionJobPreview(id, 'cut-timber', 3);
  assert.equal(ready.ok, true, ready.message);
  assert.equal(ready.availableSources, empty.availableSources);
  game.removed.add(ready.sources[0].id);
  const depleted = game.productionJobPreview(id, 'cut-timber', 3);
  assert.equal(depleted.availableSources, empty.availableSources! - 1);
  assert.ok(depleted.sources.every((source) => source.id !== ready.sources[0].id));

  assert.equal(game.hireLabor('origin-botanist', 'forestry').ok, true);
  const reserved = new Set(game.laborOrders[0].allocations.map((source) => source.propId));
  const expected = game.world
    .propsAround(6, 9, 16)
    .filter(
      (prop) =>
        prop.kind === 'pine' &&
        !game.removed.has(prop.id) &&
        !reserved.has(prop.id) &&
        Math.hypot(prop.x - 6, prop.y - 9) <= 16,
    );
  const before = game.save();
  const afterWorker = game.productionJobPreview(id, 'cut-timber', 1);
  assert.equal(afterWorker.availableSources, new Set(expected.map((source) => source.id)).size);
  assert.ok(afterWorker.sources.every((source) => !reserved.has(source.id)));
  assert.deepEqual(
    game.save(),
    before,
    'Inspecting reservations never spends or claims resources.',
  );
});

test('cancellation returns all prepaid inputs exactly once after sufficient pack space is available', () => {
  const game = garden();
  const id = game.productionStructures[0].id;
  assert.equal(game.startProduction(id, 'grow-cequin', 5).ok, true);
  game.inventory = { ore: game.capacity - 9 };
  const before = game.save();
  assert.equal(game.cancelProduction(id).ok, false);
  assert.deepEqual(game.save(), before, 'A failed refund leaves job and inputs unchanged.');
  game.inventory.ore!--;
  assert.equal(game.cancelProduction(id).ok, true);
  assert.deepEqual(game.inventory, { ore: 50, cequin: 5, wood: 5 });
  assert.equal(game.productionStructures[0].job, null);
  assert.equal(game.cancelProduction(id).ok, false);
  assert.deepEqual(Stichos.restore(game.save()).inventory, game.inventory);
});
