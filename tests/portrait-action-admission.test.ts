import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mountPortraitControls,
  type PortraitAction,
  type PortraitActionAvailability,
  type PortraitActionPhase,
} from '../src/stichos/portrait-controls.ts';

// Only the DOM surface this input component owns. Exercise its actual event
// handlers without pretending to verify browser layout or native event ordering.
function element() {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const children = new Map<string, ReturnType<typeof element>>();
  const node: Record<string, any> = {
    dataset: {},
    title: '',
    disabled: false,
    style: { setProperty() {} },
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
      toggle(name: string, value: boolean) {
        value ? classes.add(name) : classes.delete(name);
      },
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    querySelector(selector: string) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector)!;
    },
    querySelectorAll: () => [],
    setPointerCapture() {},
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 86,
      height: 86,
      right: 86,
      bottom: 86,
    }),
    append() {},
    remove() {},
  };
  return node;
}

function fixture(t: test.TestContext) {
  const root = element(),
    pane = element();
  const buttons = new Map(
    (['attack', 'technique-1', 'technique-2', 'dodge', 'interact'] as PortraitAction[]).map(
      (action) => {
        const button = element();
        button.dataset.portraitAction = action;
        button.setAttribute('aria-label', action);
        return [action, button] as const;
      },
    ),
  );
  pane.querySelectorAll = () => [...buttons.values()];
  const globals = {
    document: {
      hidden: false,
      activeElement: null,
      createElement: () => pane,
      addEventListener() {},
      removeEventListener() {},
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => {
    controls.dispose();
    for (const [key, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  });
  let availability: PortraitActionAvailability = { allowed: true, reason: null, message: null };
  const events: [PortraitAction, PortraitActionPhase][] = [];
  let onAction: (() => void) | undefined;
  const controls = mountPortraitControls(root as unknown as HTMLElement, {
    canAct: () => true,
    actionAvailability: () => availability,
    onMoveStart() {},
    onAction(action, phase) {
      events.push([action, phase]);
      if (phase === 'press') onAction?.();
    },
  });
  return {
    controls,
    buttons,
    events,
    stick: pane.querySelector('.v-joystick-surface'),
    block(reason: string) {
      availability = { allowed: false, reason, message: `Blocked: ${reason}` };
    },
    allow() {
      availability = { allowed: true, reason: null, message: null };
    },
    afterPress(fn: () => void) {
      onAction = fn;
    },
  };
}

const pointer = (id = 1) => ({
  button: 0,
  pointerId: id,
  clientX: 75,
  clientY: 43,
  preventDefault() {},
  stopPropagation() {},
});
const key = { key: 'Enter', repeat: false, preventDefault() {}, stopPropagation() {} };

test('blocked portrait actions preserve movement and reject pointer, keyboard and switch activation', (t) => {
  const f = fixture(t),
    attack = f.buttons.get('attack')!;
  f.stick.onpointerdown(pointer());
  assert.ok(f.controls.input.x > 0);
  f.block('placement');
  f.controls.update({ enabled: true });
  assert.ok(f.controls.input.x > 0, 'Action blocking must not release a movement gesture.');
  assert.equal(attack.disabled, true);
  assert.equal(attack.dataset.blockedReason, 'placement');
  assert.match(attack.getAttribute('aria-label'), /Blocked: placement/);
  assert.equal(attack.getAttribute('aria-description'), 'Blocked: placement');
  attack.onpointerdown(pointer(2));
  attack.onkeydown(key);
  attack.onclick({ detail: 0, stopPropagation() {} });
  assert.deepEqual(f.events, []);
  f.allow();
  f.controls.update({ attackCooldown: 0.5 });
  assert.equal(attack.disabled, false);
  assert.equal(attack.getAttribute('aria-description'), 'Recovering');
});

test('portrait release rechecks current admission even before the next UI update', (t) => {
  const f = fixture(t),
    technique = f.buttons.get('technique-1')!;
  technique.onpointerdown(pointer());
  f.block('placement');
  technique.onpointerup(pointer());
  assert.deepEqual(f.events, [
    ['technique-1', 'press'],
    ['technique-1', 'cancel'],
  ]);
  f.allow();
  technique.onkeydown(key);
  f.block('action-pending');
  technique.onkeyup(key);
  assert.deepEqual(f.events.slice(-2), [
    ['technique-1', 'press'],
    ['technique-1', 'cancel'],
  ]);
  f.allow();
  f.afterPress(() => f.block('placement'));
  technique.onclick({ detail: 0, stopPropagation() {} });
  assert.deepEqual(f.events.slice(-2), [
    ['technique-1', 'press'],
    ['technique-1', 'cancel'],
  ]);
});

test('an existing attack hold survives its acknowledgement, but placement cancels it', (t) => {
  const f = fixture(t),
    attack = f.buttons.get('attack')!,
    technique = f.buttons.get('technique-1')!;
  attack.onpointerdown(pointer());
  technique.onpointerdown(pointer(2));
  f.block('action-pending');
  f.controls.update({ enabled: true });
  assert.equal(f.controls.diagnostics.heldActions, 1);
  assert.deepEqual(f.events.at(-1), ['technique-1', 'cancel']);
  assert.equal(attack.disabled, false, 'Native focus/capture remains owned by the held attack.');
  assert.equal(attack.getAttribute('aria-disabled'), 'true');
  f.allow();
  f.controls.update({});
  assert.equal(f.controls.diagnostics.heldActions, 1);
  f.block('placement');
  f.controls.update({});
  assert.equal(f.controls.diagnostics.heldActions, 0);
  assert.deepEqual(f.events.at(-1), ['attack', 'cancel']);
  attack.onpointerup(pointer());
  assert.deepEqual(f.events.at(-1), ['attack', 'cancel'], 'A cancelled hold cannot release later.');
});

test('action availability never unlocks a locked technique', (t) => {
  const f = fixture(t),
    technique = f.buttons.get('technique-2')!;
  f.controls.update({
    techniques: [
      { label: 'First', unlocked: true, cooldown: 0 },
      { label: 'Second', unlocked: false, cooldown: 0, lockedReason: 'Level 4' },
    ],
  });
  f.block('action-pending');
  f.controls.update({});
  f.allow();
  f.controls.update({});
  assert.equal(technique.disabled, true);
  assert.equal(technique.dataset.blockedReason, 'locked');
  assert.match(technique.getAttribute('aria-label'), /Level 4/);
  technique.onkeydown(key);
  assert.deepEqual(f.events, []);
});
