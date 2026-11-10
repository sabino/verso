import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerConnection } from '../src/stichos/multiplayer.ts';
import { appearance } from '../src/stichos/world.ts';
import { createRoomSigningIdentity, signRoomHello } from '../src/stichos/room-checkpoint.ts';
import { MULTIPLAYER_PROTOCOL } from '../src/stichos/multiplayer-protocol.ts';

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    TestSocket.instances.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    // Real transports may deliver this event well after a replacement started.
  }
}

const identity = {
  seed: 3886,
  generation: 3 as const,
  name: 'Traveler',
  appearance: appearance(42, 'pilgrim', 1),
  position: { x: 0, y: 5 },
};
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function environment(t: { after(fn: () => void): void }) {
  const previousSocket = globalThis.WebSocket;
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  TestSocket.instances = [];
  const client = new MultiplayerConnection();
  t.after(() => {
    client.disconnect();
    globalThis.WebSocket = previousSocket;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  });
  return client;
}

function outcome(promise: Promise<void>) {
  const result: { status: 'pending' | 'resolved' | 'rejected'; error?: Error } = {
    status: 'pending',
  };
  void promise.then(
    () => {
      result.status = 'resolved';
    },
    (error: Error) => {
      result.status = 'rejected';
      result.error = error;
    },
  );
  return result;
}

test('cancelling a pending handshake settles immediately without waiting for a transport close event', async (t) => {
  const client = environment(t);
  const result = outcome(client.connect('ws://localhost:4175/ws', identity));
  assert.equal(client.status, 'connecting');
  const socket = TestSocket.instances[0];
  client.disconnect();
  await turn();
  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(socket.readyState, 3);
  assert.equal(client.status, 'offline');
  assert.equal(client.lastError, '');
});

test('replacement settles the old handshake and late old callbacks cannot alter or send through the new connection', async (t) => {
  const client = environment(t);
  const previous = outcome(client.connect('ws://localhost:4175/ws', identity));
  const old = TestSocket.instances[0];
  const current = outcome(
    client.connect('ws://localhost:4176/ws', { ...identity, name: 'New life' }),
  );
  const active = TestSocket.instances[1];
  await turn();
  assert.equal(previous.status, 'rejected');
  assert.equal(previous.error?.name, 'AbortError');
  active.readyState = 1;
  old.onopen?.();
  old.onerror?.();
  old.onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'Old world failed' }) });
  old.onclose?.();
  assert.equal(client.status, 'connecting');
  assert.equal(client.lastError, '');
  assert.equal(current.status, 'pending');
  assert.deepEqual(
    active.sent,
    [],
    'An old open event cannot send its identity through the new socket.',
  );
  active.onopen?.();
  assert.equal((active.sent[0] as { name: string }).name, 'New life');
  active.onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'Current world is full' }) });
  active.onclose?.();
  await turn();
  assert.equal(current.status, 'rejected');
  assert.equal(current.error?.message, 'Current world is full');
  assert.equal(client.lastError, 'Current world is full');
  assert.equal(client.status, 'offline');
});

test('cancellation while loading a saved room never opens a transport or reports a successful join', async (t) => {
  const client = environment(t);
  const result = outcome(client.connect('ws://localhost:4175/ws', identity, 'TEST'));
  client.disconnect();
  await turn();
  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(TestSocket.instances.length, 0);
  assert.equal(client.status, 'offline');
});

async function signedWelcome(socket: TestSocket) {
  const challenge = (socket.sent[0] as { challenge: string }).challenge;
  return JSON.stringify({
    type: 'welcome',
    protocol: MULTIPLAYER_PROTOCOL,
    room: 'TEST',
    seed: identity.seed,
    generation: identity.generation,
    peerId: 'test-peer',
    resumeToken: 't'.repeat(32),
    peers: [],
    removed: [],
    opened: [],
    combat: {},
    proof: await signRoomHello('TEST', challenge, '', await createRoomSigningIdentity()),
  });
}

for (const terminal of ['error', 'denied', 'timeout'] as const)
  test(`a ${terminal} handshake cannot accept a delayed valid welcome before its close event`, async (t) => {
    const client = environment(t);
    if (terminal === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
    const result = outcome(client.connect('ws://localhost:4175/ws', identity));
    const socket = TestSocket.instances[0];
    socket.readyState = 1;
    socket.onopen?.();
    const welcome = await signedWelcome(socket);
    let callbacks = 0;
    client.onWorld = client.onCombat = client.onMachines = () => callbacks++;
    // Model a transport that has requested closure but still reports OPEN until its event.
    socket.close = () => {};
    if (terminal === 'error') socket.onerror?.();
    else if (terminal === 'denied')
      socket.onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'Admission denied' }) });
    else {
      t.mock.timers.tick(10001);
      t.mock.timers.reset();
    }
    await turn();
    assert.equal(result.status, 'rejected');
    const reason = client.lastError;
    socket.onmessage?.({ data: welcome });
    socket.onopen?.();
    socket.onerror?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.notEqual(client.status, 'online');
    assert.equal(callbacks, 0, 'A rejected attempt must never apply authenticated world state.');
    assert.equal(socket.sent.length, 1, 'A late open must not repeat the join.');
    assert.equal(client.lastError, reason, 'A late error must not replace the original failure.');
    let changes = 0;
    client.onChange = () => changes++;
    socket.onclose?.();
    socket.onclose?.();
    assert.equal(changes, 1, 'Transport closure is reported once.');
    assert.equal(client.status, 'offline');
  });

test('successful handshake settlement keeps the admitted session able to receive updates', async (t) => {
  const client = environment(t);
  const connected = client.connect('ws://localhost:4175/ws', identity);
  const socket = TestSocket.instances[0];
  socket.readyState = 1;
  socket.onopen?.();
  let worlds = 0;
  client.onWorld = () => worlds++;
  socket.onmessage?.({ data: await signedWelcome(socket) });
  await connected;
  assert.equal(client.status, 'online');
  socket.onmessage?.({
    data: JSON.stringify({ type: 'world', actorId: 'another-peer', removed: ['test-resource'] }),
  });
  assert.equal(worlds, 2, 'Settlement succeeds once but does not close the live message stream.');
});
