import test from 'node:test';
import assert from 'node:assert/strict';
import { Stichos } from '../src/stichos/session.ts';

test('a surface resident cannot be selected as a new body while the current body is underground', () => {
  const game = new Stichos(1, 4);
  assert.equal(game.acceptLife(3).ok, true);
  const owner = 'retirement-floor-review';
  game.enableLivingSystems(owner);
  const entrance = game.livingSystemsFrame!.entrances[0];
  Object.assign(game.player, { x: entrance.x, y: entrance.y });
  const entered = game.fieldCommand({
    kind: 'underworld-enter',
    settlementId: entrance.settlementId,
  });
  assert.equal(entered.ok, true, entered.message);
  assert.match(game.spaceId, /^underground:/);

  // This resident's surface coordinates also happen to be clear dungeon tiles.
  // Collision alone cannot prove that the resident occupies the current floor.
  const candidate = game.lifeCandidate(6);
  assert.notEqual(candidate.id, game.bodyId);
  assert.equal(game.navigationBlocked(candidate.start.x, candidate.start.y), false);
  const before = game.save();
  const floor = game.spaceId;
  const result = game.retireLife(6);
  assert.equal(result.ok, false);
  assert.match(result.message, /surface/i);
  assert.deepEqual(game.save(), before, 'Rejected retirement changes no body or belongings.');

  const restored = Stichos.restore(game.save());
  restored.enableLivingSystems(owner);
  assert.equal(restored.spaceId, floor);
  assert.equal(restored.bodyId, game.bodyId);
  assert.equal(restored.retireLife(6).ok, false);
});

test('dismantling the final platform retains structure and job serials through a save reload', () => {
  let game = new Stichos(3886, 3);
  game.player.coins = 200;
  game.inventory = { wood: 20, ore: 6, cequin: 3 };
  Object.assign(game.player, { x: 6, y: 9 });
  assert.equal(game.buildProduction('garden', game.player).ok, true);
  const first = game.productionStructures[0];
  assert.equal(game.startProduction(first.id, 'grow-cequin').ok, true);
  assert.equal(game.productionStructures[0].job!.id, 1);
  assert.equal(game.cancelProduction(first.id).ok, true);
  assert.equal(game.dismantleProduction(first.id).ok, true);
  assert.equal(game.productionStructures.length, 0);
  assert.equal(game.nextProductionId, 'production:2');

  game = Stichos.restore(game.save());
  assert.equal(game.nextProductionId, 'production:2');
  assert.equal(game.buildProduction('garden', first).ok, true);
  const second = game.productionStructures[0];
  assert.equal(second.id, 'production:2');
  assert.equal(game.startProduction(second.id, 'grow-cequin').ok, true);
  assert.equal(game.productionStructures[0].job!.id, 2);
});
