import test from 'node:test';
import assert from 'node:assert/strict';
import { Stichos } from '../src/stichos/session.ts';
import { appearance } from '../src/stichos/world.ts';
import { SharedCombat, type SharedCombatPeer } from '../src/stichos/shared-combat.ts';
import type { Npc } from '../src/stichos/types.ts';

const idle = { x: 0, y: 0, run: false };
function hostile(x: number, y: number, weapon: Npc['appearance']['weapon'] = 'sword'): Npc {
  return {
    id: 'playability-raider',
    name: 'Raider',
    seed: 27,
    role: 'raider',
    clan: 3,
    appearance: { ...appearance(27, 'raider', 3), weapon },
    x,
    y,
    home: { x, y },
    hp: 49,
    maxHp: 50,
    speed: 0.001,
    heading: 0,
    phase: 0,
    hostile: true,
    cooldown: 0,
  };
}
function traveler(id: string, x: number, y: number): SharedCombatPeer {
  return { id, x, y, heading: 0, combatActive: true, appearance: appearance(27, 'pilgrim', 1) };
}

test('solo unarmed hostiles have the same short striking reach as room hostiles', () => {
  const game = new Stichos(3886, 2);
  Object.assign(game.player, { x: 4000, y: 4000 });
  game.npcs = [hostile(4000, 3998.9, 'none')];
  for (let i = 0; i < 20; i++) game.update(0.02, idle);
  assert.equal(
    game.player.hp,
    game.player.maxHp,
    'An empty hand cannot acquire a generated staff reach.',
  );
  assert.equal(
    game.actionCues.some((c) => c.kind === 'telegraph'),
    false,
  );
});

test('a solo arrow stops at its advertised range even when the last frame is longer', () => {
  const game = new Stichos(3886, 2);
  Object.assign(game.player, { x: 4000, y: 4000 });
  game.weapons.add('bow');
  game.equip('bow');
  const range = game.weaponProfile('bow').range;
  const target = hostile(4000 + range + 0.45, 4000);
  target.cooldown = 20;
  game.npcs = [target];
  game.attack({ x: 4020, y: 4000 });
  for (let i = 0; i < 4; i++) game.update(0.25, idle);
  assert.equal(game.npcs.find((n) => n.id === target.id)?.hp, 49);
  assert.equal(
    game.effects.some((e) => e.kind === 'arrow'),
    false,
  );
});

test('a visible co-op traveler remains targetable when a closer traveler is behind cover', () => {
  const npc = hostile(0, 0, 'bow');
  const combat = new SharedCombat(
    {
      generation: 3,
      blocked: (x, y) => Math.round(x) === 1 && Math.round(y) === 0,
      propsAround: () => [],
      npcsAround: () => [structuredClone(npc)],
    },
    new Set(),
  );
  const result = combat.tick(0.01, [traveler('hidden', 2, 0), traveler('visible', 0, 3)]);
  assert.equal(result.snapshot.enemies[0].intent?.targetId, 'visible');
});

test('a rejected shared shot does not spend the next attack cooldown', () => {
  let now = 0;
  const combat = new SharedCombat(
    {
      generation: 3,
      blocked: () => false,
      propsAround: () => [],
      npcsAround: () => [],
    },
    new Set(),
    { now: () => now },
  );
  const archer = traveler('archer', 0, 0);
  archer.appearance.weapon = 'bow';
  for (let i = 0; i < 128; i++) {
    assert.equal(combat.attack(archer, 0).ok, true);
    now += 1000;
  }
  const before = combat.checkpoint();
  assert.equal(combat.attack(archer, 0).ok, false);
  assert.deepEqual(combat.checkpoint().cooldowns, before.cooldowns);
  assert.equal(combat.checkpoint().serial, before.serial);
});

test('preparing a solo technique blocks a simultaneous ward, matching room combat', () => {
  const game = new Stichos(3886, 2);
  assert.equal(game.technique('pulse').ok, true);
  const stamina = game.player.stamina;
  game.ward();
  assert.equal(game.player.stamina, stamina, 'The preparing action cannot also spend a ward.');
  assert.equal(game.player.wardCooldown, 0);
  assert.equal(game.preparingTechnique?.id, 'pulse');
  assert.equal(
    game.effects.some((effect) => effect.kind === 'ward'),
    false,
  );
});

test('entering another resident cancels the previous body’s step and combat cues', () => {
  const game = new Stichos(8, 4);
  assert.equal(game.acceptLife(3).ok, true);
  assert.equal(game.dodge(0), true);
  assert.ok(game.actionCues.some((cue) => cue.kind === 'dash'));
  assert.equal(game.retireLife(4).ok, true);
  const arrival = { x: game.player.x, y: game.player.y };
  assert.equal(
    game.actionCues.some((cue) => cue.kind === 'dash'),
    false,
  );
  game.update(0.1, idle);
  assert.deepEqual({ x: game.player.x, y: game.player.y }, arrival);
});
