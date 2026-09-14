import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { waitForDevTools } from '../scripts/ci-browser.mjs';

function fixture() {
  const browser = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
  const states: any[] = [];
  let elapsed = 0;
  const options = {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
    readPort: () => '43123\n/devtools/browser/cold-runner\n',
    fetcher: async () =>
      new Response(
        JSON.stringify({
          Browser: 'Chrome/140',
          webSocketDebuggerUrl: 'ws://127.0.0.1:43123/devtools/browser/cold-runner',
        }),
      ),
    diagnostic: (state: any) => states.push(state),
  };
  return { browser, options, states, elapsed: () => elapsed };
}

test('cold Chromium gets its bounded 90s window and must pass HTTP readiness after the port appears', async () => {
  const f = fixture();
  const endpoint = await waitForDevTools(f.browser, '/unused', {
    ...f.options,
    readPort: () => {
      if (f.elapsed() < 12_500) throw Error('Port not written yet');
      return f.options.readPort();
    },
    fetcher: async (url: string, options: any) => {
      assert.equal(url, 'http://127.0.0.1:43123/json/version');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return f.elapsed() < 15_000 ? new Response('', { status: 503 }) : f.options.fetcher();
    },
  });
  assert.equal(endpoint, 'http://127.0.0.1:43123');
  assert.equal(f.elapsed(), 15_000);
  assert.equal(f.states.at(-1).status, 'ready');
  assert.equal(f.states.at(-1).timeoutMs, 90_000);
  assert.equal(f.browser.listenerCount('error'), 0);
  assert.equal(f.browser.listenerCount('exit'), 0);
});

test('missing and partial port files stop at the actual deadline without touching another endpoint', async () => {
  for (const port of ['', '43123', '0\n/devtools/browser/test', '70000\n/devtools/browser/test']) {
    const f = fixture();
    let requests = 0;
    await assert.rejects(
      waitForDevTools(f.browser, '/unused', {
        ...f.options,
        timeoutMs: 1_250,
        readPort: () => port,
        fetcher: async () => {
          requests++;
          return f.options.fetcher();
        },
      }),
      /within 1250 ms/,
    );
    assert.equal(f.elapsed(), 1_250);
    assert.equal(requests, 0);
    assert.equal(f.states.at(-1).status, 'failed');
  }
});

test('process launch errors and early exit fail promptly with structured diagnostics', async () => {
  for (const kind of ['error', 'exit']) {
    const f = fixture();
    await assert.rejects(
      waitForDevTools(f.browser, '/unused', {
        ...f.options,
        readPort: () => '',
        sleep: async (ms: number) => {
          await f.options.sleep(ms);
          if (kind === 'error')
            f.browser.emit(
              'error',
              Object.assign(new Error('private process text'), { code: 'ENOENT' }),
            );
          else f.browser.emit('exit', 7, null);
        },
      }),
      (error: Error) =>
        !error.message.includes('private process text') &&
        /failed to launch|exited before/.test(error.message),
    );
    assert.equal(f.elapsed(), 250);
    assert.equal(f.states.at(-1).status, 'failed');
    if (kind === 'error') assert.equal(f.states.at(-1).launchError, 'ENOENT');
    else assert.deepEqual(f.states.at(-1).exit, { code: 7, signal: null });
  }
});

test('HTTP availability alone cannot accept a stale or non-loopback browser websocket', async () => {
  for (const socket of [
    'ws://attacker.invalid:43123/devtools/browser/cold-runner',
    'ws://127.0.0.1:43124/devtools/browser/cold-runner',
    'ws://127.0.0.1:43123/devtools/browser/stale-profile',
    'ws://user:password@127.0.0.1:43123/devtools/browser/cold-runner',
    'http://127.0.0.1:43123/devtools/browser/cold-runner',
  ]) {
    const f = fixture();
    await assert.rejects(
      waitForDevTools(f.browser, '/unused', {
        ...f.options,
        timeoutMs: 500,
        fetcher: async () =>
          new Response(JSON.stringify({ Browser: 'Chrome/140', webSocketDebuggerUrl: socket })),
      }),
      /within 500 ms/,
    );
    assert.equal(f.states.at(-1).status, 'failed');
    assert.ok(!JSON.stringify(f.states).includes(socket));
  }
});

test('a process that exits during the readiness request cannot be accepted', async () => {
  const f = fixture();
  await assert.rejects(
    waitForDevTools(f.browser, '/unused', {
      ...f.options,
      fetcher: async () => {
        f.browser.emit('exit', 0, 'SIGTERM');
        return f.options.fetcher();
      },
    }),
    /exited before/,
  );
  assert.equal(f.states.at(-1).status, 'failed');
  assert.deepEqual(f.states.at(-1).exit, { code: 0, signal: 'SIGTERM' });
});
