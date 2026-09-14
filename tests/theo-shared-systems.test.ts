import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Stichos } from '../src/stichos/session.ts';
import { InfiniteWorld } from '../src/stichos/world.ts';
import { notebookHtml, type NotebookView } from '../src/stichos/notebook.ts';
import { CoopRooms } from '../src/stichos/room-authority.mjs';
import { STICHOS_SEED } from '../src/stichos/universe.ts';
import type { Point } from '../src/stichos/types.ts';

const view: NotebookView = { section: 'years', entry: 0, plant: 0, plain: true, open: true };
const owner = 'shared-story-review';
function created(generation: 3 | 4) {
  const game = new Stichos(STICHOS_SEED, generation);
  const accepted = game.acceptLife(0, { name: 'Mira Vale' });
  assert.ok(accepted.ok, accepted.message);
  return game;
}
/** A prepared interaction position, not evidence of traversing the intervening world. */
function standBeside(game: Stichos, target: Point) {
  for (const [dx, dy] of [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const point = { x: target.x + dx, y: target.y + dy };
    if (!game.clear(point)) continue;
    Object.assign(game.player, point);
    game.update(0, { x: 0, y: 0, run: false });
    return;
  }
  throw Error('The generated interaction target must have a clear approach.');
}

test('Theo remains a content scenario in the same simulation, with full living systems and legacy saves', () => {
  for (const generation of [1, 2, 3] as const) {
    const game = new Stichos(STICHOS_SEED, generation);
    assert.equal(game.storyScenario, 'theo');
    assert.equal(game.universeLife, false);
    assert.equal(game.player.name, 'Theo Bishop');
    assert.equal(game.hasNotebook, true);
    assert.equal(game.freeLife.unlocked, false);
    game.enableLivingSystems(owner);
    const frame = game.livingSystemsFrame!;
    assert.ok(game.usesLivingSystems);
    for (const key of ['economy', 'factions', 'property', 'entrances', 'actors', 'recall'])
      assert.ok(key in frame, key);
    assert.ok(frame.factions.length > 0);
    assert.ok(game.estate.residence);
    const restored = Stichos.restore(game.save());
    restored.enableLivingSystems(owner);
    assert.equal(restored.storyScenario, 'theo');
    assert.deepEqual(restored.player, game.player);
    assert.deepEqual(restored.campaign, game.campaign);
    assert.deepEqual(restored.livingSystemsFrame!.economy, frame.economy);
    assert.match(notebookHtml(restored, view), /Twenty stíchoi of silence/);
  }
  const unassigned = new Stichos(STICHOS_SEED, 4);
  assert.equal(unassigned.lifeOrigin, null);
  assert.equal(
    unassigned.storyScenario,
    'personal',
    'Existing generation-four saves stay personal before origin selection.',
  );
  assert.equal(Stichos.restore(unassigned.save()).storyScenario, 'personal');
});

test('accepted generation-three and generation-four residents share personal life, dialogue and notebook systems', () => {
  for (const generation of [3, 4] as const) {
    const game = created(generation);
    const world = new InfiniteWorld(STICHOS_SEED, generation);
    assert.equal(game.storyScenario, 'personal');
    assert.equal(game.universeLife, true);
    assert.equal(game.freeLife.unlocked, true);
    assert.ok(game.personalStory);
    assert.equal(game.campaignObjective, null);
    assert.deepEqual(game.world.clans, world.clans);
    assert.equal(!!game.world.civilization, generation === 4);
    assert.deepEqual(
      game.world.tile(game.player.x, game.player.y),
      world.tile(game.player.x, game.player.y),
    );
    assert.equal(game.lifeCulture.name, 'Stíchos');
    const signal = game.personalStory.signal;
    standBeside(game, signal);
    game.interact(signal.id);
    assert.ok(game.dialogue?.choices.some((c) => c.id === 'personal:align'));
    assert.ok(!game.dialogue?.choices.some((c) => c.id.startsWith('campaign:')));
    game.dialogue = null;
    const relation = game.personalStory.relationships[0];
    standBeside(game, relation.target);
    game.interact(relation.npcId);
    assert.ok(game.dialogue?.choices.some((c) => c.id === 'personal:past'));
    game.choose('personal:past');
    assert.match(game.dialogue!.text, /Mira Vale/);
    const notebook = notebookHtml(game, view);
    assert.match(notebook, /Mira Vale/);
    assert.ok(!notebook.includes('Theo Bishop · private notebook'));
    game.enableLivingSystems(owner);
    const restored = Stichos.restore(game.save());
    restored.enableLivingSystems(owner);
    assert.equal(restored.storyScenario, 'personal');
    assert.deepEqual(restored.personalStory, game.personalStory);
    assert.deepEqual(restored.player, game.player);
    assert.equal(restored.usesLivingSystems, true);
    if (generation === 3) {
      const oldRecord = game.save();
      delete oldRecord.personalStories;
      const migrated = Stichos.restore(oldRecord);
      assert.equal(migrated.storyScenario, 'personal');
      assert.equal(migrated.personalStory!.id, game.personalStory!.id);
      assert.equal(migrated.freeLife.unlocked, true);
    }
  }
});

test('personal scenario survives actual retirement transfer without enabling Theo campaign or bypassing shrine requirements', () => {
  for (const generation of [3, 4] as const) {
    const game = created(generation),
      before = game.bodyId;
    assert.equal(game.transferReady, false);
    game.reincarnate();
    assert.equal(game.bodyId, before, 'An unfinished personal story cannot use shrine transfer.');
    const result = game.retireLife(1, { name: 'Second witness' });
    assert.ok(result.ok, result.message);
    assert.notEqual(game.bodyId, before);
    assert.equal(game.storyScenario, 'personal');
    assert.ok(game.journal.some((e) => e.title === 'Another person’s breath'));
    assert.equal(game.campaignObjective, null);
    const restored = Stichos.restore(game.save());
    assert.equal(restored.storyScenario, 'personal');
    assert.equal(restored.bodyId, game.bodyId);
    assert.equal(restored.player.name, 'Second witness');
    assert.ok(restored.personalStory);
  }
});

class RoomSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages: any[] = [];
  send(raw: string) {
    this.messages.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  ping() {}
}
test('the same room authority and systems frames preserve Theo versus created-life scenarios', () => {
  for (const game of [new Stichos(STICHOS_SEED, 3), created(3), created(4)]) {
    const expected = game.storyScenario,
      origin = game.lifeOrigin;
    const hub = new CoopRooms({ now: () => 10000, durable: true });
    const socket = new RoomSocket(),
      connection = hub.attach(socket);
    hub.handle(connection, {
      type: 'join',
      protocol: 3,
      seed: game.world.seed,
      generation: game.world.generation,
      name: game.player.bodyName,
      appearance: game.player.appearance,
      position: { x: game.player.x, y: game.player.y },
      bodyId: game.bodyId,
      livingSystems: 1,
    });
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    assert.ok(welcome, JSON.stringify(socket.messages));
    game.setSharedWorld(true);
    game.setSharedCombat(true, welcome.room);
    game.applySystemsFrame(welcome.systems, welcome.peerId, welcome.room);
    assert.equal(game.usesSharedLivingSystems, true);
    assert.equal(game.storyScenario, expected);
    assert.deepEqual(game.lifeOrigin, origin);
    assert.ok(game.livingSystemsFrame!.factions.length > 0);
    assert.equal(Stichos.restore(game.save()).storyScenario, expected);
    socket.close();
  }
});
