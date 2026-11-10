import test from 'node:test';
import assert from 'node:assert/strict';
import { Stichos } from '../src/stichos/session.ts';
import { generatePersonalStory } from '../src/stichos/personal-story.ts';

const idle = { x: 0, y: 0, run: false };

test('a cancelled household assignment can retry its obstructed return without consuming resources or paying twice', () => {
  let game = new Stichos(3886);
  assert.equal(game.hireLabor('origin-botanist', 'garden').ok, true);
  const order = game.laborOrders[0],
    home = order.journey!.returnPoint,
    coins = game.player.coins,
    inventory = structuredClone(game.inventory);
  for (let tick = 0; tick < 600; tick++) {
    game.update(0.1, idle);
    const worker = game.staff.find((n) => n.id === order.workerId)!;
    if (Math.hypot(worker.x - home.x, worker.y - home.y) > 0.8) break;
  }
  const away = game.staff.find((n) => n.id === order.workerId)!;
  assert.ok(Math.hypot(away.x - home.x, away.y - home.y) > 0.8);
  assert.equal(game.cancelLabor(order.id).ok, true);
  const blocked = game.world.blocked.bind(game.world);
  game.world.blocked = (x, y, ...rest) =>
    Math.hypot(x - home.x, y - home.y) < 0.75 || blocked(x, y, ...rest);
  game.update(0.1, idle);
  assert.equal(game.laborOrders[0].journey?.phase, 'blocked');
  assert.equal(game.hireLabor(order.workerId, 'garden').ok, false);
  assert.equal(game.collectLabor(order.id).ok, false);

  // Reload after the obstruction is removed; another gatherer has taken a plot.
  // A cancelled worker owes a return, not another harvest of that plot.
  game = Stichos.restore(game.save());
  game.removed.add(order.allocations[0].propId);
  assert.equal(game.retryLabor(order.id).ok, true);
  assert.equal(game.laborOrders[0].status, 'cancelled');
  assert.equal(game.laborOrders[0].journey?.phase, 'returning');
  assert.equal(game.retryLabor(order.id).ok, false);
  for (let tick = 0; tick < 200 && game.laborOrders[0].journey?.phase !== 'ready'; tick++)
    game.update(0.1, idle);
  assert.equal(game.laborOrders[0].journey?.phase, 'ready');
  assert.equal(game.collectLabor(order.id).ok, false);
  assert.equal(game.cancelLabor(order.id).ok, false);
  assert.equal(game.player.coins, coins);
  assert.deepEqual(game.inventory, inventory);
  assert.equal(order.allocations.filter((a) => game.removed.has(a.propId)).length, 1);
  assert.equal(Stichos.restore(game.save()).laborOrders[0].status, 'cancelled');
});

test('supply withdrawal stays available after plot or recipient loss, preserves the pack and never counts as paid service', () => {
  let game = new Stichos(3886);
  const botanist = game.npcs.find((n) => n.id === 'origin-botanist')!;
  Object.assign(game.player, { x: botanist.x, y: botanist.y + 1 });
  game.interact(botanist.id);
  game.choose('supply:accept');
  const job = game.activeSupplyJobs[0];
  assert.ok(job);
  const source = game.world
    .propsAround(job.target.x, job.target.y, 0.25)
    .find((p) => p.kind === job.item)!;
  game.removed.add(source.id);
  assert.equal(game.activeSupplyJobs[0].sourceAvailable, false);
  game.removed.add(botanist.id);
  const absent = game.activeSupplyJobs[0];
  assert.equal(absent.recipientAvailable, false);
  assert.match(absent.reason, /recipient is unavailable/i);
  const pack = structuredClone(game.inventory),
    coins = game.player.coins,
    xp = game.player.xp;
  assert.equal(game.cancelSupply(botanist.id).ok, true);
  assert.equal(game.cancelSupply(botanist.id).ok, false);
  assert.deepEqual(game.inventory, pack);
  assert.equal(game.player.coins, coins);
  assert.equal(game.player.xp, xp);
  assert.equal(game.freeLife.milestones.find((m) => m.id === 'life:service')!.progress, 0);
  assert.equal(game.activeSupplyJobs.length, 0);
  const retired = game.save().supplyJobs[0];
  assert.equal(retired.number, job.number);
  assert.equal(retired.active, false);
  game = Stichos.restore(game.save());
  assert.equal(game.cancelSupply(botanist.id).ok, false);
  assert.equal(game.quests.find((q) => q.id === job.questId)!.target, undefined);
  assert.equal(game.quests.find((q) => q.id === job.questId)!.outcome, 'withdrawn');
  assert.equal(game.freeLife.milestones.find((m) => m.id === 'life:service')!.progress, 0);
  const invalid = game.save();
  (invalid.quests.find((q) => q.id === job.questId)! as { outcome: string }).outcome = 'paid';
  assert.throws(() => Stichos.restore(invalid), /save/i);
  const legacy = new Stichos(3886).save();
  assert.ok(legacy.quests.every((q) => q.outcome === undefined));
  assert.doesNotThrow(() => Stichos.restore(legacy));
});

test('the bounded personal history ledger refuses new identities without evicting a paid life, and admits a revisit', () => {
  let game = new Stichos(8, 4);
  assert.equal(game.acceptLife(3).ok, true);
  const plan = generatePersonalStory(game.world, game.lifeOrigin!);
  const saved = game.save();
  saved.freeLife.serial = saved.freeLife.completed = plan.commissionGoal;
  Object.assign(saved.personalStories!.records[0], {
    repaid: true,
    trusted: plan.debt.recipient.npcId,
    aligned: true,
  });
  // Old v1 saves already support 128 records. Fill the other retained identities
  // directly so this boundary test does not perform 126 unrelated retirements.
  for (let index = 0; index < 126; index++)
    saved.personalStories!.records.push({
      bodyId: `remembered:${index}`,
      baselineCommissions: 0,
      repaid: false,
      trusted: null,
      aligned: false,
    });
  game = Stichos.restore(saved);
  let entered = -1;
  for (let index = 0; index < 32; index++)
    if (index !== 3 && game.retireLife(index).ok) {
      entered = index;
      break;
    }
  assert.notEqual(entered, -1);
  assert.equal(game.personalHistoryCapacity.retained, 128);
  const before = game.save();
  let rejected = false;
  for (let index = 32; index < 64; index++) {
    const result = game.retireLife(index);
    if (result.message.includes('128 personal histories')) {
      rejected = true;
      break;
    }
  }
  assert.equal(rejected, true);
  assert.deepEqual(game.save(), before, 'Rejected retirement changes no body, rewards or history.');
  assert.equal(game.retireLife(3).ok, true);
  assert.equal(game.personalStory!.complete, true);
  assert.equal(game.personalHistoryCapacity.retained, 128);
  const current = game.save();
  assert.deepEqual(current.personalStories!.records[0], saved.personalStories!.records[0]);
  assert.equal(Stichos.restore(current).personalStory!.complete, true);
});

test('story diagnostics and save snapshots are detached observations, with progression owned by simulation', () => {
  const personal = new Stichos(8, 4);
  personal.acceptLife(3);
  const story = personal.personalStory!;
  const target = personal.personalStory!.obligations[0].target.x;
  story.obligations[0].target.x += 900;
  story.relationships[0].target.x += 900;
  assert.equal(personal.personalStory!.obligations[0].target.x, target);
  const runtime = personal as any;
  const snapshot = () =>
    structuredClone({
      stories: runtime.personalStories,
      memory: [...runtime.npcMemory],
      actors: runtime.actors.snapshot(),
      player: personal.player,
      quests: personal.quests,
      journal: personal.journal,
      freeLife: runtime.freeLifeState,
    });
  personal.npcs[0].hp--;
  const before = snapshot();
  const first = personal.save();
  assert.deepEqual(
    snapshot(),
    before,
    'Capturing an NPC consequence never edits live actor state.',
  );
  assert.deepEqual(personal.save(), first);
  assert.deepEqual(snapshot(), before);
  first.player.coins += 99;
  assert.equal(personal.player.coins, before.player.coins);
  runtime.personalStories.records = [];
  assert.equal(personal.personalStory, null);
  assert.equal(
    runtime.personalStories.records.length,
    0,
    'Missing history is not created by a read.',
  );

  const legacy = new Stichos(3886),
    internal = legacy as any;
  internal.campaignState.ending = 'publish';
  internal.freeLifeState.gardenProduce = 24;
  const coins = legacy.player.coins;
  legacy.save();
  assert.equal(
    legacy.player.coins,
    coins,
    'Save does not grant an earned but unreconciled reward.',
  );
  assert.equal(internal.freeLifeState.rewarded.includes('life:garden'), false);
  legacy.update(0.1, idle);
  assert.equal(internal.freeLifeState.rewarded.includes('life:garden'), true);
  assert.equal(legacy.player.coins, coins + 35);
});
