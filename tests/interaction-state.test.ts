import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interactionState,
  strikeDestination,
  type InteractionContext,
} from '../src/stichos/interaction-state.ts';
import { Stichos } from '../src/stichos/session.ts';

const playing: InteractionContext = {
  started: true,
  phase: 'playing',
  paused: false,
  modal: '',
  transfer: false,
  dialogue: false,
  satchel: false,
  hidden: false,
  portraitRequired: false,
  focus: 'world',
  pending: 'idle',
  placement: 'none',
};

test('typing interrupts travel and combat without freezing the living world', () => {
  for (const focus of ['text', 'select'] as const) {
    const state = interactionState({ ...playing, focus });
    assert.equal(state.capabilities.move.allowed, false);
    assert.equal(
      state.capabilities.combat.reason,
      focus === 'text' ? 'text-entry' : 'select-entry',
    );
    assert.equal(
      state.capabilities.voice.allowed,
      true,
      'Deliberate push-to-talk remains available',
    );
    assert.equal(state.travelInterruption, 'interaction');
    assert.equal(state.capabilities.simulate.allowed, true);
    assert.equal(
      state.capabilities.worldPointer.allowed,
      true,
      'A deliberate ground click leaves text entry',
    );
  }
  assert.equal(
    interactionState(playing).capabilities.move.allowed,
    true,
    'Blur restores admission',
  );
});

test('acknowledgements preserve door routes and allow movement during combat without duplicate attacks', () => {
  const door = interactionState({ ...playing, pending: 'world' });
  assert.equal(door.travelInterruption, null);
  assert.equal(door.capabilities.move.reason, 'action-pending');
  assert.equal(door.capabilities.simulate.allowed, false);
  const combat = interactionState({ ...playing, pending: 'combat' });
  assert.equal(combat.capabilities.simulate.allowed, true);
  assert.equal(combat.capabilities.move.allowed, true);
  assert.equal(combat.capabilities.combat.allowed, false);
  assert.equal(combat.capabilities.worldPointer.allowed, false);
  assert.equal(
    interactionState({ ...playing, pending: 'world', focus: 'text' }).travelInterruption,
    'interaction',
  );
});

test('construction admits deliberate placement and manual approach, not accidental fighting or travel', () => {
  for (const placement of ['estate', 'production'] as const) {
    const state = interactionState({ ...playing, placement });
    assert.equal(state.capabilities.worldPointer.allowed, true);
    assert.equal(state.capabilities.move.allowed, true);
    assert.equal(state.capabilities.combat.reason, 'placement');
    assert.equal(state.capabilities.travel.reason, 'placement');
    assert.equal(state.travelInterruption, 'interaction');
  }
});

test('overlapping surfaces have deterministic precedence without leaking world input', () => {
  const contexts: Partial<InteractionContext>[] = [
    { started: false },
    { transfer: true, modal: 'map', dialogue: true, satchel: true },
    { modal: 'map', dialogue: true, satchel: true },
    { dialogue: true, satchel: true },
    { satchel: true },
    { paused: true },
    { hidden: true },
    { portraitRequired: true },
    { phase: 'lost' },
  ];
  for (const extra of contexts) {
    const state = interactionState({ ...playing, ...extra });
    for (const action of [
      'move',
      'travel',
      'combat',
      'interact',
      'worldPointer',
      'voice',
    ] as const) {
      assert.equal(state.capabilities[action].allowed, false, JSON.stringify({ extra, action }));
      assert.ok(state.capabilities[action].message);
    }
    assert.ok(state.travelInterruption);
  }
  assert.deepEqual(interactionState({ ...playing, transfer: true, modal: 'map' }).surface, {
    kind: 'transfer',
  });
  assert.deepEqual(interactionState({ ...playing, modal: 'map', dialogue: true }).surface, {
    kind: 'modal',
    name: 'map',
  });
});

test('capability implications hold across all orthogonal input states', () => {
  for (let flags = 0; flags < 256; flags++)
    for (const focus of ['world', 'text', 'select'] as const)
      for (const pending of ['idle', 'world', 'combat'] as const)
        for (const placement of ['none', 'estate', 'production'] as const) {
          const context: InteractionContext = {
            ...playing,
            started: !!(flags & 1),
            paused: !!(flags & 2),
            modal: flags & 4 ? 'pause' : '',
            transfer: !!(flags & 8),
            dialogue: !!(flags & 16),
            satchel: !!(flags & 32),
            hidden: !!(flags & 64),
            portraitRequired: !!(flags & 128),
            focus,
            pending,
            placement,
          };
          const state = interactionState(context);
          const c = state.capabilities;
          if (c.combat.allowed) {
            assert.equal(c.move.allowed, true);
            assert.equal(c.worldPointer.allowed, true);
            assert.equal(pending, 'idle');
            assert.equal(placement, 'none');
          }
          if (c.travel.allowed) {
            assert.equal(c.move.allowed, true);
            assert.equal(state.travelInterruption, null);
          }
          if (c.move.allowed) assert.equal(c.simulate.allowed, true);
          assert.deepEqual(c.combat, c.interact);
          assert.deepEqual(interactionState(context), state, 'Diagnostic reads are pure');
        }
});

test('an unarmed resident uses the underground authority kit after entering a real generated floor', () => {
  const game = new Stichos(1, 4);
  game.acceptLife(0);
  game.enableLivingSystems('interaction-kit-test');
  assert.equal(game.player.appearance.weapon, 'none');
  assert.equal(strikeDestination(false, false), 'equipment');
  const entrance = game.livingSystemsFrame!.entrances[0];
  assert.ok(entrance);
  Object.assign(game.player, { x: entrance.x, y: entrance.y });
  const result = game.fieldCommand({
    kind: 'underworld-enter',
    settlementId: entrance.settlementId,
  });
  assert.equal(result.ok, true, result.message);
  assert.ok(game.underworldFrame);
  assert.equal(game.livingSystemsFrame!.equipment.kind, 'sword');
  assert.equal(
    strikeDestination(!!game.underworldFrame, game.player.appearance.weapon !== 'none'),
    'combat',
  );
  assert.equal(strikeDestination(false, true), 'combat');
});
