import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerConnection, getBrowserPlayerId } from '../src/stichos/multiplayer.ts';
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

function environment(
  t: { after(fn: () => void): void },
  dependencies: ConstructorParameters<typeof MultiplayerConnection>[0] = {},
) {
  const previousSocket = globalThis.WebSocket;
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  TestSocket.instances = [];
  const client = new MultiplayerConnection(dependencies);
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
    assert.equal(changes, 0, 'Late transport closure cannot repeat the already-reported failure.');
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('transport constructor failure leaves a terminal offline attempt and permits retry', async (t) => {
  let fail = true;
  const client = environment(t, {
    createWebSocket: (url) => {
      if (fail) throw Error('Socket construction failed');
      return new TestSocket(url.href) as unknown as WebSocket;
    },
  });
  await assert.rejects(client.connect('ws://localhost:4175/ws', identity), /construction failed/);
  assert.equal(client.status, 'offline');
  assert.match(client.lastError, /construction failed/);
  fail = false;
  const result = outcome(client.connect('ws://localhost:4175/ws', identity));
  assert.equal(client.status, 'connecting');
  client.disconnect();
  await turn();
  assert.equal(result.error?.name, 'AbortError');
});

test('cancellation settles before a saved-world verification finishes and stale rejection is isolated', async (t) => {
  const lookup = deferred<null>();
  const client = environment(t, { loadSavedRoom: () => lookup.promise });
  const old = outcome(client.connect('ws://localhost:4175/ws', identity, 'TEST'));
  client.disconnect();
  await turn();
  assert.equal(old.error?.name, 'AbortError');
  const current = outcome(client.connect('ws://localhost:4176/ws', identity));
  lookup.reject(Error('Expired lookup failed'));
  await turn();
  assert.equal(client.status, 'connecting');
  assert.equal(client.lastError, '');
  assert.equal(current.status, 'pending');
  assert.equal(TestSocket.instances.length, 1);
});

test('async peer configuration and synchronous peer factory failure settle offline and can retry', async (t) => {
  const config = deferred<never>();
  let factoryFails = false;
  const client = environment(t, {
    loadPeerTransport: () =>
      factoryFails
        ? Promise.resolve(() => {
            throw Error('Peer factory failed');
          })
        : config.promise,
  });
  const pending = outcome(client.connect('peer:', identity));
  config.reject(Error('Relay configuration unavailable'));
  await turn();
  assert.equal(pending.status, 'rejected');
  assert.equal(client.status, 'offline');
  assert.match(client.lastError, /configuration unavailable/);
  factoryFails = true;
  await assert.rejects(client.connect('peer:', identity), /factory failed/);
  assert.equal(client.status, 'offline');
  assert.match(client.lastError, /factory failed/);
});

test('replacement during peer configuration rejects promptly and never constructs the stale transport', async (t) => {
  const config = deferred<(...args: unknown[]) => never>();
  let constructed = 0;
  const client = environment(t, { loadPeerTransport: () => config.promise });
  const old = outcome(client.connect('peer:', identity));
  const current = outcome(client.connect('ws://localhost:4175/ws', identity));
  await turn();
  assert.equal(old.error?.name, 'AbortError');
  config.resolve(() => {
    constructed++;
    throw Error('Must not construct');
  });
  await turn();
  assert.equal(constructed, 0);
  assert.equal(current.status, 'pending');
  assert.equal(client.status, 'connecting');
  assert.equal(client.lastError, '');
});

test('credential storage failures remain visible until a successful write and authority durability is independent', async (t) => {
  const client = environment(t);
  let blocked = true;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        if (blocked) throw Error('Quota exceeded');
      },
      removeItem: () => {},
    },
  });
  // Explicit browser identity isolates token persistence from identity persistence in this test.
  const connected = client.connect('ws://localhost:4175/ws', {
    ...identity,
    clientId: crypto.randomUUID(),
  });
  const socket = TestSocket.instances[0];
  socket.readyState = 1;
  socket.onopen?.();
  socket.onmessage?.({ data: await signedWelcome(socket) });
  await connected;
  assert.match(client.credentialStorageError ?? '', /could not be saved/);
  const status = {
    phase: 'degraded',
    lastSavedRevision: 3,
    lastSavedAt: 1000,
    error: 'Storage is unavailable.',
  };
  socket.onmessage?.({ data: JSON.stringify({ type: 'durability', status }) });
  assert.deepEqual(client.durability, status);
  assert.equal(client.status, 'online');
  blocked = false;
  const request = client.sendChat('Storage recovered', 'world');
  const sent = socket.sent.at(-1) as { requestId: string };
  socket.onmessage?.({
    data: JSON.stringify({ type: 'chat_result', requestId: sent.requestId, ok: true }),
  });
  await request;
  assert.equal(client.credentialStorageError, null);
  assert.equal(
    client.durability.phase,
    'degraded',
    'Credential writes cannot clear authority storage failure.',
  );
});

for (const hosting of ['hostSavedWorld', 'hostPublicWorld'] as const)
  test(`${hosting} cannot start a late host after cancellation or replacement`, async (t) => {
    const lookup = deferred<null>();
    const client = environment(t, { loadSavedRoom: () => lookup.promise });
    const hosted = outcome(client[hosting]('TEST', identity));
    const current = outcome(client.connect('ws://localhost:4175/ws', identity));
    await turn();
    assert.equal(hosted.error?.name, 'AbortError');
    lookup.resolve(null);
    await turn();
    assert.equal(current.status, 'pending');
    assert.equal(client.status, 'connecting');
    assert.equal(client.lastError, '');
    assert.equal(TestSocket.instances.length, 1);
  });

test('a successful older-server welcome clears stale durability retained during reconnection', async (t) => {
  const client = environment(t);
  const first = client.connect('ws://localhost:4175/ws', identity);
  const original = TestSocket.instances[0];
  original.readyState = 1;
  original.onopen?.();
  original.onmessage?.({ data: await signedWelcome(original) });
  await first;
  original.onmessage?.({
    data: JSON.stringify({
      type: 'durability',
      status: {
        phase: 'degraded',
        lastSavedRevision: 3,
        lastSavedAt: 1000,
        error: 'Storage unavailable',
      },
    }),
  });
  const current = client.connect('ws://localhost:4175/ws', identity, 'TEST');
  assert.equal(client.durability.phase, 'degraded');
  await turn();
  const replacement = TestSocket.instances[1];
  replacement.readyState = 1;
  replacement.onopen?.();
  replacement.onmessage?.({ data: await signedWelcome(replacement) });
  await current;
  assert.equal(client.durability.phase, 'untracked');
  assert.equal(client.durability.error, null);
});

test('explicit browser identity from the app surfaces identity-only storage failure until a successful retry', async (t) => {
  const client = environment(t);
  const data = new Map<string, string>();
  let blockIdentity = true;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (blockIdentity && key === 'verso-room-v1:identity')
          throw Error('Identity storage unavailable');
        data.set(key, value);
      },
      removeItem: (key: string) => data.delete(key),
    },
  });
  const clientId = getBrowserPlayerId();
  const connected = client.connect('ws://localhost:4175/ws', { ...identity, clientId });
  const socket = TestSocket.instances[0];
  socket.readyState = 1;
  socket.onopen?.();
  socket.onmessage?.({ data: await signedWelcome(socket) });
  await connected;
  assert.match(client.credentialStorageError ?? '', /could not be saved/);
  assert.ok(
    [...data.keys()].some((key) => key.includes('credential:')),
    'Token saved successfully but its browser identity did not.',
  );
  blockIdentity = false;
  const request = client.sendChat('Retry identity persistence', 'world');
  const packet = socket.sent.at(-1) as { requestId: string };
  socket.onmessage?.({
    data: JSON.stringify({ type: 'chat_result', requestId: packet.requestId, ok: true }),
  });
  await request;
  assert.equal(client.credentialStorageError, null);
  assert.equal(JSON.parse(data.get('verso-room-v1:identity')!), clientId);
});
