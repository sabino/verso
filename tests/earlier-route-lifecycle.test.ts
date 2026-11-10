import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CrossingSaveSlot,
  screenTransition,
  type ScreenState,
} from '../src/procedural/lifecycle.ts';
import { Game, type ActionKind } from '../src/game.ts';

test('title and briefing require explicit continuation; journal restores its actual source screen', () => {
  let state: ScreenState = { screen: 'title', journalReturn: null };
  for (const event of ['back', 'journal', 'pause', 'deploy', 'recovered'] as const)
    assert.equal(screenTransition(state, event, 'playing'), state);
  state = screenTransition(state, 'prepare', 'playing');
  assert.equal(state.screen, 'briefing');
  assert.equal(screenTransition(state, 'back', 'playing'), state);
  state = screenTransition(state, 'deploy', 'playing');
  assert.equal(state.screen, 'world');
  state = screenTransition(state, 'back', 'playing');
  assert.equal(state.screen, 'pause');
  state = screenTransition(state, 'journal', 'playing');
  assert.equal(state.journalReturn, 'pause');
  state = screenTransition(state, 'back', 'playing');
  assert.equal(state.screen, 'pause');
  state = screenTransition(state, 'title', 'playing');
  assert.equal(
    screenTransition(state, 'back', 'playing'),
    state,
    'a previously started life does not let Escape dismiss title',
  );
  state = screenTransition(state, 'continue', 'dead');
  assert.equal(state.screen, 'dead');
  assert.equal(screenTransition(state, 'back', 'dead'), state);
  state = screenTransition(state, 'journal', 'dead');
  assert.equal(screenTransition(state, 'back', 'dead').screen, 'dead');
  state = screenTransition(state, 'back', 'dead');
  assert.equal(screenTransition(state, 'recovered', 'dead'), state);
  assert.equal(screenTransition(state, 'recovered', 'playing').screen, 'world');
});

test('save failure preserves the last durable snapshot, reports cause, and recovers on retry', () => {
  let stored = 'last confirmed life',
    failRead = false,
    failWrite = false;
  const slot = new CrossingSaveSlot(
    {
      getItem() {
        if (failRead) throw Error('unavailable');
        return stored;
      },
      setItem(_key, value) {
        if (failWrite) throw Error('quota');
        stored = value;
      },
    },
    'test',
  );
  assert.equal(slot.status.kind, 'saved');
  failWrite = true;
  assert.equal(slot.write('new unsaved life'), false);
  assert.equal(slot.value, 'last confirmed life');
  assert.equal(stored, slot.value);
  assert.equal(slot.status.kind, 'error');
  assert.match(slot.status.message, /not saved/);
  failWrite = false;
  assert.equal(slot.write('new saved life'), true);
  assert.equal(stored, 'new saved life');
  assert.equal(slot.status.kind, 'saved');
  slot.restoreFailed();
  assert.equal(slot.value, 'new saved life', 'invalid restoration never deletes saved evidence');
  assert.match(slot.status.message, /unchanged/);
  assert.equal(slot.read(), true);
  assert.equal(slot.status.kind, 'error', 'rereading invalid bytes cannot clear a restore failure');
  assert.match(slot.status.message, /could not be restored/);
  slot.restoreSucceeded();
  assert.equal(slot.status.kind, 'saved', 'only successful validation clears restore failure');
  failRead = true;
  assert.equal(slot.read(), false);
  assert.equal(slot.value, 'new saved life');
  failRead = false;
  assert.equal(slot.read(), true);
  assert.equal(slot.status.kind, 'saved');
});

test('study action previews match rejected commands without spending or turning the body', () => {
  const game = new Game('READINESS', 3886);
  const p = game.state.player;
  p.stamina = 0;
  for (const kind of ['blade', 'pulse', 'dash'] as ActionKind[]) {
    assert.equal(game.actionAvailability(kind).reason, 'energy');
    const facing = { ...p.facing };
    assert.equal(game.action(kind, { x: p.x + 10, y: p.y - 100 }), false);
    assert.deepEqual(p.facing, facing);
    assert.equal(p.cooldowns[kind], 0);
  }
  p.stamina = p.maxStamina;
  assert.equal(game.actionAvailability('blade').allowed, true);
  assert.equal(game.action('blade'), true);
  assert.equal(game.actionAvailability('blade').reason, 'cooldown');
  assert.equal(game.action('blade'), false);
  assert.equal(game.actionAvailability('mend').reason, 'whole');
  const shards = p.fragments;
  assert.equal(game.action('mend'), false);
  assert.equal(p.fragments, shards);
  game.state.integrity -= 3;
  assert.equal(
    game.actionAvailability('mend').allowed,
    true,
    'mend may repair world integrity at full body health',
  );
  assert.equal(game.action('mend'), true);
  assert.equal(p.fragments, shards - 1);
  game.state.phase = 'dead';
  for (const kind of ['blade', 'pulse', 'dash', 'scan', 'mend'] as ActionKind[])
    assert.equal(game.actionAvailability(kind).reason, 'phase');
});

test('study E availability follows contextual interaction rather than unrelated scan cooldown', () => {
  const game = new Game('CONTEXT', 3886);
  const p = game.state.player;
  const portal = game.state.entities.find((e) => e.kind === 'portal')!;
  Object.assign(p, { x: portal.x, y: portal.y });
  p.cooldowns.scan = 1;
  assert.equal(game.controlAvailability('scan').reason, 'mission-incomplete');
  assert.equal(game.interact(), false);
  game.state.entities.push({
    id: 'test-drop',
    kind: 'drop',
    x: p.x,
    y: p.y,
    radius: 10,
    fragments: 2,
  });
  const shards = p.fragments;
  assert.equal(game.controlAvailability('scan').allowed, true);
  assert.equal(game.interact(), true);
  assert.equal(p.fragments, shards + 2);
  assert.equal(
    game.state.entities.some((e) => e.id === 'test-drop'),
    false,
  );
  assert.equal(game.controlAvailability('scan').reason, 'mission-incomplete');
});
