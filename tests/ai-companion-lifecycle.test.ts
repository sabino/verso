import test from 'node:test';
import assert from 'node:assert/strict';
import { AICompanion } from '../src/stichos/ai-companion.ts';
const code = 'local-test-pairing-capability-0123456789';
const status = {
  paired: true,
  installed: true,
  version: 'test',
  auth: 'chatgpt',
  browserWasm: false,
  transport: 'native-app-server-stdio',
  chatAvailable: false,
  toolsIsolated: false,
  reason: 'Unavailable',
  setup: [],
};
const response = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code });
const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { resolve, promise };
}
test('cancelled pair settles without a cooperative transport and cannot install a late token', async () => {
  const pending = deferred<Response>();
  const client = new AICompanion({ transport: (() => pending.promise) as typeof fetch });
  const pair = client.pair(code);
  const rejected = assert.rejects(pair, { code: 'cancelled' });
  client.cancelPending();
  await rejected;
  pending.resolve(response({ token: 'a'.repeat(43) }));
  await turn();
  assert.equal(client.paired, false);
});
test('old 401 status and cancelled disconnect cannot revoke a newer pairing', async () => {
  const oldStatus = deferred<Response>(),
    oldDisconnect = deferred<Response>();
  let pairs = 0,
    statuses = 0;
  const client = new AICompanion({
    transport: (async (url) => {
      const path = String(url);
      if (path.endsWith('/pair')) return response({ token: String(++pairs).repeat(43) });
      if (path.endsWith('/disconnect')) return oldDisconnect.promise;
      if (++statuses === 1) return oldStatus.promise;
      return response(status);
    }) as typeof fetch,
  });
  const first = client.pair(code);
  const cancelled = assert.rejects(first, { code: 'cancelled' });
  await turn();
  await client.pair(code);
  await cancelled;
  oldStatus.resolve(response({ code: 'pair_required' }, 401));
  await turn();
  assert.equal(client.paired, true);
  const disconnect = client.disconnect();
  const stopped = assert.rejects(disconnect, { code: 'cancelled' });
  await client.pair(code);
  await stopped;
  oldDisconnect.resolve(response({ ok: true }));
  await turn();
  assert.equal(client.paired, true);
});
