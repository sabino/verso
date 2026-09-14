import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {
  validateRelease,
  validAssetPath,
  projectURL,
  isLegacyNavigation,
  readRelease,
} from '../migration/legacy/release.js';
import { createBridgeWorker } from '../migration/legacy/sw.js';
import { releaseManifest } from '../scripts/prepare-pages.mjs';

const origin = 'https://verso.test';
const oldPath = '/games/verso/';
const source = 'a'.repeat(40);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('actual Pages release producer and legacy consumer agree on every published field and static path', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verso-bridge-producer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'assets'));
  await writeFile(
    path.join(directory, 'index.html'),
    '<script type="module" src="./assets/index-game1.js"></script><link rel="stylesheet" href="./assets/game-style1.css">',
  );
  await writeFile(path.join(directory, 'sw.js'), 'const VERSION = "' + '1'.repeat(20) + '";');
  for (const [name, contents] of Object.entries({
    ...fixture().files,
    'assets/AI-COMPANION-Cla8xmjz.md': 'Human-readable companion instructions',
    'manifest.webmanifest': '{"name":"Verso"}',
  })) {
    await writeFile(path.join(directory, name), contents);
  }
  const published = releaseManifest(directory, {
    revision: source,
    modified: false,
    version: '0.1.0',
    sourceDate: '2026-09-14T00:00:00Z',
  });
  const accepted = validateRelease(JSON.parse(JSON.stringify(published)));
  assert.equal(accepted.entrypoint, published.entrypoint);
  assert.deepEqual(accepted.stylesheets, published.stylesheets);
  assert.deepEqual(Object.keys(accepted.assets).sort(), Object.keys(published.assets).sort());
  assert.equal(published.frontendUrl, 'https://sabino.pro/verso/');
  assert.equal(published.legacyUrl, 'https://sabino.pro/games/verso/');
  assert.equal(published.codec, 'ima-adpcm-16k-v1');
  assert.equal(Object.hasOwn(accepted.assets, 'sw.js'), false);
  assert.equal(Object.hasOwn(accepted.assets, 'release.json'), false);
});
function fixture(version = 1) {
  const files: Record<string, string> = {
    [`assets/index-game${version}.js`]: `export const release = ${version};`,
    [`assets/game-style${version}.css`]: `body { color: ${version === 1 ? 'red' : 'blue'}; }`,
    [`assets/lazy-game${version}.js`]: `export const lazy = ${version};`,
    'icon.svg': '<svg/>',
  };
  return {
    files,
    release: {
      schema: 1,
      sourceCommit: source,
      swVersion: String(version).repeat(20),
      entrypoint: `assets/index-game${version}.js`,
      stylesheets: [`assets/game-style${version}.css`],
      assets: Object.fromEntries(
        Object.entries(files).map(([name, bytes]) => [
          name,
          { sha256: hash(bytes), bytes: Buffer.byteLength(bytes) },
        ]),
      ),
    },
  };
}

async function runtime(
  options: { timeout?: number; additionalFiles?: Record<string, string> } = {},
) {
  const stores = new Map<string, Map<string, Response>>();
  const requests: Request[] = [];
  const releaseFixture = (version = 1) => {
    const result = fixture(version);
    for (const [name, bytes] of Object.entries(options.additionalFiles ?? {})) {
      result.files[name] = bytes;
      result.release.assets[name] = { sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
    }
    return result;
  };
  let current = releaseFixture();
  let unavailable = false;
  let badPath = '';
  let stalled = false;
  let claimCount = 0;
  let networkHook: ((request: Request) => Promise<Response | undefined>) | undefined;
  let lockTail: Promise<unknown> = Promise.resolve();
  const cacheAPI = {
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      return {
        async match(url: string) {
          return stores.get(name)!.get(url)?.clone();
        },
        async put(url: string, response: Response) {
          stores.get(name)!.set(url, response.clone());
        },
      };
    },
  };
  const env = {
    registration: { scope: origin + oldPath },
    caches: cacheAPI,
    crypto: webcrypto,
    navigator: {
      locks: {
        request(_name: string, callback: () => Promise<void>) {
          const pending = lockTail.then(callback);
          lockTail = pending.catch(() => {});
          return pending;
        },
      },
    },
    setTimeout: (callback: () => void, delay: number) =>
      setTimeout(callback, options.timeout ?? delay),
    clearTimeout,
    clients: {
      async claim() {
        claimCount++;
      },
    },
    async fetch(request: Request) {
      requests.push(request);
      const intercepted = await networkHook?.(request);
      if (intercepted) return intercepted;
      if (unavailable) throw new Error('Network disabled');
      const url = new URL(request.url);
      if (stalled)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
          }),
        );
      if (url.pathname === '/verso/release.json') return Response.json(current.release);
      if (url.pathname.startsWith('/verso/')) {
        const key = url.pathname.slice('/verso/'.length);
        if (!Object.hasOwn(current.files, key)) return new Response('Not found', { status: 404 });
        return new Response(key === badPath ? 'corrupted bytes' : current.files[key], {
          headers: { 'Content-Type': key.endsWith('.js') ? 'text/javascript' : 'text/plain' },
        });
      }
      return new Response(`legacy shell:${url.pathname}`, {
        headers: { 'Content-Type': 'text/html' },
      });
    },
  };
  const bridge = createBridgeWorker(env);
  return {
    bridge,
    stores,
    requests,
    createWorker: () => createBridgeWorker(env),
    removeLocks: () => {
      delete (env.navigator as any).locks;
    },
    set networkHook(value: typeof networkHook) {
      networkHook = value;
    },
    set version(value: number) {
      current = releaseFixture(value);
    },
    set offline(value: boolean) {
      unavailable = value;
    },
    set corrupt(value: string) {
      badPath = value;
    },
    set stalled(value: boolean) {
      stalled = value;
    },
    get claims() {
      return claimCount;
    },
    async request(path: string, mode = 'cors', method = 'GET') {
      const request = { url: new URL(path, origin).href, mode, method };
      return bridge.handles(request) ? await bridge.respond(request) : undefined;
    },
  };
}

test('legacy bridge skips only the unused canonical HTML document and still opens its own shell offline', async () => {
  const canonicalIndex =
    '<!doctype html><script type="module" src="./assets/index-game1.js"></script>';
  const r = await runtime({
    additionalFiles: {
      'index.html': canonicalIndex,
      'audio/step.mp3': 'original synthetic media bytes',
    },
  });
  r.networkHook = async (request: Request) => {
    if (new URL(request.url).pathname === '/verso/index.html')
      return new Response(canonicalIndex + '<link href="/cdn-cgi/edge-injected.css">');
  };
  await r.bridge.refresh();
  await r.bridge.activate();
  assert.ok(!r.requests.some((request) => new URL(request.url).pathname === '/verso/index.html'));
  assert.ok([...r.stores.values()].every((cache) => !cache.has(origin + '/verso/index.html')));
  assert.ok(r.requests.some((request) => request.url === origin + '/verso/audio/step.mp3'));
  r.offline = true;
  assert.match(
    await (await r.request('/games/verso/?room=ABC#invite=123', 'navigate'))!.text(),
    /legacy shell/,
  );
  assert.equal(
    await (await r.request('/verso/assets/index-game1.js'))!.text(),
    fixture().files['assets/index-game1.js'],
  );
  assert.equal(
    await (await r.request('/verso/audio/step.mp3'))!.text(),
    'original synthetic media bytes',
  );
});

test('excluding unused canonical HTML never exempts used modules, styles, images or media from integrity checks', async () => {
  for (const changed of [
    'assets/index-game2.js',
    'assets/lazy-game2.js',
    'assets/game-style2.css',
    'audio/step.mp3',
    'icon.svg',
  ]) {
    const r = await runtime({
      additionalFiles: { 'index.html': '<!doctype html>', 'audio/step.mp3': 'original media' },
    });
    await r.bridge.refresh();
    r.version = 2;
    r.corrupt = changed;
    await assert.rejects(r.bridge.refresh(), /integrity|too large/);
    r.offline = true;
    assert.equal(
      (await (await r.request('/verso/release.json'))!.json()).swVersion,
      '1'.repeat(20),
    );
    assert.equal(
      await (await r.request('/verso/assets/index-game1.js'))!.text(),
      fixture().files['assets/index-game1.js'],
    );
  }
});

test('network deadline covers a stalled response body and retains the installed release', async () => {
  const r = await runtime({ timeout: 30 });
  await r.bridge.refresh();
  r.stalled = true;
  await assert.rejects(r.bridge.refresh(), /timed out/);
  assert.equal((await (await r.request('/verso/release.json'))!.json()).swVersion, '1'.repeat(20));
});

test('active and installing bridge workers serialize cache updates across their shared origin', async () => {
  const r = await runtime();
  await r.bridge.refresh();
  const installer = r.createWorker();
  r.version = 2;
  let reached!: () => void;
  const firstAsset = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let releaseFailure!: () => void;
  r.networkHook = async (request: Request) => {
    if (request.url.endsWith('/assets/game-style2.css')) {
      reached();
      await new Promise<void>((resolve) => {
        releaseFailure = resolve;
      });
      return new Response('corrupt');
    }
  };
  const activeUpdate = assert.rejects(r.bridge.refresh(), /integrity|too large/);
  await firstAsset;
  const countBefore = r.requests.length;
  const installUpdate = installer.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    r.requests.length,
    countBefore,
    'Installing worker waits for the active writer lock',
  );
  r.networkHook = undefined;
  releaseFailure();
  await activeUpdate;
  await installUpdate;
  r.offline = true;
  assert.equal((await (await r.request('/verso/release.json'))!.json()).swVersion, '2'.repeat(20));
  assert.match(
    await (await r.request('/games/verso/?room=ABC', 'navigate'))!.text(),
    /legacy shell/,
  );
  assert.equal(
    await (await r.request('/verso/assets/lazy-game2.js'))!.text(),
    fixture(2).files['assets/lazy-game2.js'],
  );
});

test('missing origin-wide locks refuses cache mutation and retains the old working worker cache', async () => {
  const r = await runtime();
  r.removeLocks();
  const oldName = `${r.bridge.legacyPrefix}old-version`;
  r.stores.set(oldName, new Map([['sentinel', new Response('saved offline game')]]));
  await assert.rejects(r.bridge.refresh(), /Web Locks/);
  assert.equal(r.requests.length, 0);
  assert.equal(r.stores.size, 1);
  assert.equal(await r.stores.get(oldName)!.get('sentinel')!.text(), 'saved offline game');
});

test('release schema accepts fixed bounded static assets and rejects arbitrary imports and poison keys', () => {
  const good = fixture().release;
  assert.equal(
    validateRelease({ ...good, sourceRepository: 'sabino/verso', worldNodeSourceCommit: null })
      .entrypoint,
    good.entrypoint,
  );
  assert.equal(Object.getPrototypeOf(validateRelease(good).assets), null);
  for (const path of [
    '../index.js',
    '/verso/assets/x.js',
    'https://evil.test/x.js',
    'assets/../../api.js',
    'assets/%2e%2e/x.js',
    'assets/x.js?token=a',
    'assets/x.js#hash',
    'assets\\x.js',
    'assets//x.js',
    'assets/__proto__/x.js',
    '__proto__',
    'constructor',
    'api/session.json',
    'sw.js',
    'release.json',
  ]) {
    assert.equal(validAssetPath(path), false, path);
    assert.throws(
      () =>
        validateRelease({
          ...good,
          assets: { ...good.assets, [path]: { sha256: hash('x'), bytes: 1 } },
        }),
      path,
    );
  }
  for (const changed of [
    { schema: 2 },
    { sourceCommit: 'latest' },
    { swVersion: '../bad' },
    { entrypoint: 'assets/unlisted.js' },
    { entrypoint: 'https://evil.test/game.js' },
    { stylesheets: ['assets/unlisted.css'] },
    { stylesheets: [good.stylesheets[0], good.stylesheets[0]] },
    { unknown: 'future incompatible contract' },
    { assets: { ...good.assets, 'icon.svg': { sha256: 'x', bytes: 1 } } },
    { assets: { ...good.assets, 'icon.svg': { sha256: hash('x'), bytes: 33 * 1024 * 1024 } } },
  ])
    assert.throws(() => validateRelease({ ...good, ...changed }));
  const poison = JSON.parse(JSON.stringify(good));
  poison.assets = JSON.parse('{"__proto__":{"sha256":"' + hash('x') + '","bytes":1}}');
  assert.throws(() => validateRelease(poison));
  assert.equal(({} as any).polluted, undefined);
  assert.equal(projectURL(good.entrypoint, origin), `${origin}/verso/${good.entrypoint}`);
});

test('response bounds reject oversized manifest bodies and failed/redirected responses', async () => {
  await assert.rejects(readRelease(new Response('x'.repeat(256 * 1024 + 1))), /too large/);
  await assert.rejects(readRelease(new Response('{}', { status: 404 })), /failed/);
  await assert.rejects(readRelease(Response.redirect(origin + '/evil')), /failed/);
});

test('actual loader keeps query/hash invitations, uses fixed release and SRI, and never migrates storage', async () => {
  const code = (
    await readFile(new URL('../migration/legacy/bridge.js', import.meta.url), 'utf8')
  ).replace(/^import .*?;\n/s, '');
  const href = `${origin}${oldPath}?room=ABC123&voice=0#invite=one%2Ftwo`;
  const location = Object.freeze({
    href,
    origin,
    search: '?room=ABC123&voice=0',
    hash: '#invite=one%2Ftwo',
  });
  const added: any[] = [];
  const registrations: any[] = [];
  const fetches: any[] = [];
  let removed = false;
  let complete!: () => void;
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const registration = { active: { postMessage() {} } };
  const context = vm.createContext({
    LEGACY_PATH: oldPath,
    RELEASE_PATH: '/verso/release.json',
    isLegacyNavigation,
    projectURL,
    readRelease,
    AbortController,
    setTimeout,
    clearTimeout,
    location,
    window: { isSecureContext: true },
    btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'),
    navigator: {
      serviceWorker: {
        async register(...args: any[]) {
          registrations.push(args);
          return registration;
        },
      },
    },
    async fetch(...args: any[]) {
      fetches.push(args);
      return Response.json(fixture().release);
    },
    document: {
      createElement(tag: string) {
        return { tag };
      },
      head: {
        append(element: any) {
          added.push(element);
          queueMicrotask(() => element.onload());
        },
      },
      getElementById() {
        return {
          remove() {
            removed = true;
            complete();
          },
        };
      },
    },
  });
  new vm.Script(code).runInContext(context);
  await done;
  assert.equal(location.href, href);
  assert.equal(fetches[0][0], '/verso/release.json');
  assert.equal(fetches[0][1].redirect, 'error');
  assert.equal(registrations[0][0], '/games/verso/sw.js');
  assert.equal(registrations[0][1].scope, '/games/verso/');
  assert.equal(registrations[0][1].type, 'module');
  assert.equal(added[0].href, `${origin}/verso/assets/game-style1.css`);
  assert.equal(added[1].src, `${origin}/verso/assets/index-game1.js`);
  assert.match(added[1].integrity, /^sha256-[A-Za-z0-9+/]+=$/);
  assert.equal(removed, true);
  assert.doesNotMatch(
    code,
    /localStorage|indexedDB|location\.(?:replace|assign)|skipWaiting|\.clear\(/,
  );
});

test('uncontrolled loader times out a stalled manifest body and offers an invitation-preserving fallback', async () => {
  const code = (
    await readFile(new URL('../migration/legacy/bridge.js', import.meta.url), 'utf8')
  ).replace(/^import .*?;\n/s, '');
  let complete!: () => void;
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let fallback: any;
  const status = {
    textContent: '',
    append(link: any) {
      fallback = link;
      complete();
    },
  };
  const location = Object.freeze({
    href: origin + oldPath + '?room=ABC#invite=xyz',
    origin,
    search: '?room=ABC',
    hash: '#invite=xyz',
  });
  const context = vm.createContext({
    LEGACY_PATH: oldPath,
    RELEASE_PATH: '/verso/release.json',
    isLegacyNavigation,
    projectURL,
    readRelease,
    AbortController,
    setTimeout: (callback: () => void) => setTimeout(callback, 10),
    clearTimeout,
    location,
    window: { isSecureContext: false },
    async fetch() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
        }),
      );
    },
    document: {
      getElementById() {
        return status;
      },
      createElement(tag: string) {
        return { tag };
      },
    },
  });
  new vm.Script(code).runInContext(context);
  await done;
  assert.match(status.textContent, /saved life has not been changed/);
  assert.equal(fallback.href, '/verso/?room=ABC#invite=xyz');
  assert.equal(location.href, origin + oldPath + '?room=ABC#invite=xyz');
});

test('legacy PWA keeps exact old identity and scope while base and icon resources point to project', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../migration/legacy/manifest.webmanifest', import.meta.url), 'utf8'),
  );
  for (const field of ['id', 'start_url', 'scope'])
    assert.equal(new URL(manifest[field], origin + oldPath).href, origin + oldPath);
  assert.ok(
    manifest.icons.every((icon: any) => new URL(icon.src, origin).pathname.startsWith('/verso/')),
  );
  const html = await readFile(new URL('../migration/legacy/index.html', import.meta.url), 'utf8');
  assert.match(html, /<base href="\/verso\/"/);
  assert.match(html, /href="\/games\/verso\/manifest.webmanifest"/);
  assert.match(html, /src="\/games\/verso\/bridge.js"/);
  for (const url of [
    origin + oldPath + '?room=ABC#invite=123',
    origin + oldPath + 'index.html?study#hello',
  ])
    assert.equal(isLegacyNavigation(url, origin), true);
  for (const url of [
    origin + '/games/verso-other/',
    origin + '/verso/',
    'https://evil.test' + oldPath,
  ])
    assert.equal(isLegacyNavigation(url, origin), false);
});

test('old worker cache survives failed bridge install; successful activation removes only old exact scope', async () => {
  const r = await runtime();
  const oldName = `${r.bridge.legacyPrefix}old-version`;
  const otherName = `verso-offline:${encodeURIComponent(origin + '/verso/')}:new-game`;
  const nestedName = `verso-offline:${encodeURIComponent(origin + '/games/verso/other/')}:other`;
  for (const name of [oldName, otherName, nestedName, 'unrelated-saves'])
    r.stores.set(name, new Map([['sentinel', new Response('unchanged')]]));
  r.corrupt = 'assets/lazy-game1.js';
  await assert.rejects(r.bridge.refresh(), /integrity|too large/);
  assert.ok(r.stores.has(oldName));
  assert.equal(r.claims, 0);
  assert.equal(await r.stores.get(oldName)!.get('sentinel')!.clone().text(), 'unchanged');
  r.corrupt = '';
  await r.bridge.refresh();
  assert.ok(
    r.stores.has(oldName),
    'Successful staging does not force replacement of an open old worker',
  );
  await r.bridge.activate();
  assert.equal(r.claims, 1);
  assert.equal(r.stores.has(oldName), false);
  for (const name of [otherName, nestedName, 'unrelated-saves']) assert.ok(r.stores.has(name));
  for (const request of r.requests) {
    assert.equal(request.mode, 'same-origin');
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'reload');
    assert.equal(new URL(request.url).origin, origin);
  }
});

test('complete cached release and old shell play offline; unknown paths and requests never enter cache', async () => {
  const r = await runtime();
  await r.bridge.refresh();
  await r.bridge.activate();
  r.offline = true;
  const before = r.requests.length;
  assert.match(
    await (await r.request('/games/verso/?room=ABC#invite=123', 'navigate'))!.text(),
    /legacy shell/,
  );
  assert.equal(
    (await (await r.request('/verso/release.json'))!.json()).entrypoint,
    'assets/index-game1.js',
  );
  assert.equal(
    await (await r.request('/verso/assets/lazy-game1.js'))!.text(),
    fixture().files['assets/lazy-game1.js'],
  );
  assert.equal(r.requests.length, before, 'All required offline requests came from verified cache');
  for (const [path, mode, method] of [
    ['/api/session', 'cors', 'GET'],
    ['/verso/api/session.json', 'cors', 'GET'],
    ['/games/verso/api/session', 'cors', 'GET'],
    ['/voice', 'cors', 'GET'],
    ['/verso/assets/lazy-game1.js?auth=secret', 'cors', 'GET'],
    ['/verso/', 'navigate', 'GET'],
    ['/games/verso-other/', 'navigate', 'GET'],
    ['/games/verso/', 'navigate', 'POST'],
    ['https://evil.test/verso/assets/lazy-game1.js', 'cors', 'GET'],
  ])
    assert.equal(await r.request(path, mode, method), undefined, path);
  await assert.rejects(r.request('/verso/assets/unknown-hash.js'), /Network disabled/);
  assert.ok(
    [...r.stores.values()].every(
      (cache) => ![...cache.keys()].some((key) => /unknown|secret|api\/|\/voice/.test(key)),
    ),
  );
});

test('later release switches only after all assets succeed and retains a previous complete release', async () => {
  const r = await runtime();
  await r.bridge.refresh();
  r.version = 2;
  r.corrupt = 'assets/lazy-game2.js';
  await assert.rejects(r.bridge.refresh(), /integrity|too large/);
  assert.equal((await (await r.request('/verso/release.json'))!.json()).swVersion, '1'.repeat(20));
  assert.equal(
    await (await r.request('/verso/assets/lazy-game1.js'))!.text(),
    fixture().files['assets/lazy-game1.js'],
  );
  r.corrupt = '';
  await Promise.all([r.bridge.refresh(), r.bridge.refresh()]);
  assert.equal((await (await r.request('/verso/release.json'))!.json()).swVersion, '2'.repeat(20));
  r.offline = true;
  assert.equal(
    await (await r.request('/verso/assets/lazy-game1.js'))!.text(),
    fixture().files['assets/lazy-game1.js'],
  );
  assert.equal(
    await (await r.request('/verso/assets/lazy-game2.js'))!.text(),
    fixture(2).files['assets/lazy-game2.js'],
  );
  r.offline = false;
  r.version = 3;
  await r.bridge.refresh();
  assert.equal([...r.stores.keys()].filter((key) => key.includes(':release:')).length, 2);
});
