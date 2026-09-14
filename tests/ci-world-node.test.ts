import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createCoopServer } from '../server/coop.mjs';
import {
  worldNodeCiPlan,
  verifyPublicWorldImage,
  healthyWorld,
  deployCiWorldNode,
} from '../scripts/ci-world-node.mjs';

const source = 'a'.repeat(40);
const appToken = 'private-test-app-token-not-for-output';
const registryToken = 'anonymous-pull-token-not-for-output';
const hash = (data: string) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const reply = (data: unknown, status = 200) =>
  new Response(typeof data === 'string' ? data : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function fixture({ index = false, labels = source, stamp = source } = {}) {
  const config = JSON.stringify({
    os: 'linux',
    architecture: 'amd64',
    config: {
      Env: [`VERSO_SOURCE_COMMIT=${stamp}`],
      Labels: {
        'org.opencontainers.image.revision': labels,
        'org.opencontainers.image.source': 'https://github.com/sabino/verso',
      },
    },
  });
  const manifest = JSON.stringify({ schemaVersion: 2, config: { digest: hash(config) } });
  const image = index
    ? JSON.stringify({
        manifests: [
          { digest: hash(manifest), platform: { os: 'linux', architecture: 'amd64' } },
          { digest: 'sha256:' + 'b'.repeat(64), platform: { os: 'unknown' } },
        ],
      })
    : manifest;
  const objects = new Map([
    [hash(config), config],
    [hash(manifest), manifest],
    [hash(image), image],
  ]);
  const plan = worldNodeCiPlan({
    source,
    digest: hash(image),
    rollbackReference: 'living-systems-20260913T101657Z',
  });
  const calls: Array<{ url: string; options: any }> = [];
  let posts = 0;
  let afterHealth = 0;
  const health = (commit: string | null = null) => ({
    ok: true,
    protocol: 3,
    durable: true,
    storageHealthy: true,
    voice: { enabled: true, codec: 'ima-adpcm-16k-v1' },
    sourceCommit: commit,
  });
  async function fetcher(url: string, options: any = {}) {
    calls.push({ url, options });
    assert.equal(options.redirect, url.includes('/blobs/') ? 'manual' : 'error');
    if (url.startsWith('https://ghcr.io/token?')) {
      assert.equal(options.headers?.Authorization, undefined);
      return reply({ token: registryToken });
    }
    if (url.startsWith('https://ghcr.io/v2/')) {
      assert.equal(options.headers.Authorization, `Bearer ${registryToken}`);
      const data = objects.get(url.split('/').at(-1)!);
      return data ? reply(data) : reply({}, 404);
    }
    if (options.method === 'POST') {
      posts++;
      return reply({ status: 100 });
    }
    assert.equal(url, 'https://verso-world.host.sabino.pro/health');
    if (posts) afterHealth++;
    return reply(health(posts ? source : null));
  }
  return {
    plan,
    calls,
    fetcher,
    health,
    objects,
    get afterHealth() {
      return afterHealth;
    },
  };
}

test('CI plan pins exactly the existing app, digest and source without accepting injected paths', () => {
  const f = fixture();
  assert.equal(f.plan.captain, 'https://captain.host.sabino.pro');
  assert.deepEqual(f.plan.definition.dockerfileLines, [`FROM ${f.plan.image}`]);
  for (const override of [
    { source: 'main' },
    { source: 'A'.repeat(40) },
    { digest: 'sha256:latest' },
    { digest: f.plan.digest + '\nRUN malicious' },
    { rollbackReference: 'not\na reference' },
    { rollbackReference: '' },
  ])
    assert.throws(() => worldNodeCiPlan({ ...f.plan, ...override }));
  assert.equal(
    worldNodeCiPlan({ ...f.plan, captain: 'https://evil.example' }).captain,
    f.plan.captain,
  );
});

test('anonymous manifest and OCI index verification hash each config and bind the exact runtime stamp', async () => {
  for (const index of [false, true]) {
    const f = fixture({ index });
    const result = await verifyPublicWorldImage(f.plan, { fetcher: f.fetcher });
    assert.equal(result.anonymouslyPullable, true);
    assert.equal(result.source, source);
    assert.ok(f.calls.every(({ options }) => options.method !== 'POST'));
    assert.ok(!JSON.stringify(result).includes(registryToken));
  }
  for (const settings of [{ labels: 'b'.repeat(40) }, { stamp: 'b'.repeat(40) }]) {
    const f = fixture(settings);
    await assert.rejects(verifyPublicWorldImage(f.plan, { fetcher: f.fetcher }), /source labels/);
  }
});

test('bad digest, private package, redirect/transport errors and oversized registry bodies stop before deployment', async () => {
  for (const failure of ['digest', 'private', 'redirect', 'oversized']) {
    const f = fixture();
    const fetcher = async (url: string, options: any) => {
      if (url.includes('/manifests/')) {
        if (failure === 'private') return reply({}, 401);
        if (failure === 'redirect') throw Error('redirect to ' + appToken);
        if (failure === 'oversized') return reply(' '.repeat(600 * 1024));
        return reply({ forged: true });
      }
      return f.fetcher(url, options);
    };
    await assert.rejects(
      deployCiWorldNode(f.plan, { appToken, enabled: true, fetcher }),
      (error: Error) => !error.message.includes(appToken),
    );
    assert.ok(!f.calls.some(({ options }) => options.method === 'POST'));
  }
});

test('deployment is one synchronous app-scoped POST with no configuration/admin requests', async () => {
  const f = fixture({ index: true });
  const result = await deployCiWorldNode(f.plan, {
    appToken,
    enabled: true,
    fetcher: f.fetcher,
    sleep: async () => {},
  });
  const posts = f.calls.filter(({ options }) => options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(
    posts[0].url,
    'https://captain.host.sabino.pro/api/v2/user/apps/appData/verso-world/',
  );
  assert.deepEqual(
    Object.keys(posts[0].options.headers).sort(),
    ['Connection', 'Content-Type', 'x-captain-app-token', 'x-namespace'].sort(),
  );
  assert.equal(posts[0].options.headers['x-captain-app-token'], appToken);
  assert.deepEqual(JSON.parse(posts[0].options.body), {
    captainDefinitionContent: JSON.stringify(f.plan.definition),
    gitHash: source,
  });
  assert.ok(
    f.calls
      .filter(({ url }) => !url.includes('captain.host'))
      .every(({ options }) => !JSON.stringify(options.headers || {}).includes(appToken)),
  );
  assert.equal(f.afterHealth, 3);
  assert.equal(result.exactSourceHealthVerified, true);
  assert.equal(result.operatorWireAndStorageVerificationRequired, true);
  assert.ok(!JSON.stringify(result).includes(appToken));
  assert.ok(!JSON.stringify(result).includes(registryToken));
});

test('disabled deployment and missing/unsafe app credentials make no network calls', async () => {
  for (const options of [
    { enabled: false, appToken },
    { enabled: true },
    { enabled: true, appToken: appToken + '\n' },
  ]) {
    const f = fixture();
    await assert.rejects(deployCiWorldNode(f.plan, { ...options, fetcher: f.fetcher }));
    assert.equal(f.calls.length, 0);
  }
});

test('unhealthy storage/voice and already-live source block the POST', async () => {
  const f = fixture();
  for (const override of [
    { storageHealthy: false },
    { voice: { enabled: false } },
    { sourceCommit: source },
  ]) {
    await assert.rejects(
      deployCiWorldNode(f.plan, {
        appToken,
        enabled: true,
        fetcher: (url: string, options: any) =>
          url.endsWith('/health')
            ? Promise.resolve(reply({ ...f.health(), ...override }))
            : f.fetcher(url, options),
      }),
    );
  }
  assert.ok(!f.calls.some(({ options }) => options.method === 'POST'));
});

test('uncertain POST and API errors are never retried or leaked as server descriptions', async () => {
  for (const failure of ['transport', 'status', 'malformed', 'oversized']) {
    const f = fixture();
    let mutations = 0;
    const fetcher = async (url: string, options: any) => {
      if (options.method === 'POST') {
        mutations++;
        if (failure === 'transport') throw Error(appToken);
        if (failure === 'status') return reply({ status: 1106, description: appToken });
        if (failure === 'oversized') return reply(appToken.repeat(1000));
        return reply(appToken);
      }
      return f.fetcher(url, options);
    };
    await assert.rejects(
      deployCiWorldNode(f.plan, { appToken, enabled: true, fetcher }),
      (error: Error) => !error.message.includes(appToken),
    );
    assert.equal(mutations, 1);
  }
});

test('healthy old source cannot pass and three healthy observations must be consecutive', async () => {
  const stale = fixture();
  await assert.rejects(
    deployCiWorldNode(stale.plan, {
      appToken,
      enabled: true,
      maxHealthAttempts: 4,
      sleep: async () => {},
      fetcher: (url: string, options: any) =>
        url.endsWith('/health')
          ? Promise.resolve(reply(stale.health('b'.repeat(40))))
          : stale.fetcher(url, options),
    }),
    /exact-source healthy/,
  );
  assert.equal(stale.calls.filter(({ options }) => options.method === 'POST').length, 1);
  const f = fixture();
  let healthCalls = 0;
  const result = await deployCiWorldNode(f.plan, {
    appToken,
    enabled: true,
    maxHealthAttempts: 6,
    sleep: async () => {},
    fetcher: (url: string, options: any) => {
      if (url.endsWith('/health')) {
        healthCalls++;
        return Promise.resolve(
          reply(f.health(healthCalls === 1 || healthCalls === 4 ? null : source)),
        );
      }
      return f.fetcher(url, options);
    },
  });
  assert.equal(healthCalls, 7);
  assert.equal(result.consecutiveHealthyChecks, 3);
  assert.equal(healthyWorld({ ...f.health(source), protocol: 99 }, source), false);
});

test('actual public health exposes only the immutable valid source captured at server creation', async () => {
  const previous = process.env.VERSO_SOURCE_COMMIT;
  try {
    for (const value of [source, undefined, 'unversioned', appToken, 'F'.repeat(40)]) {
      if (value === undefined) delete process.env.VERSO_SOURCE_COMMIT;
      else process.env.VERSO_SOURCE_COMMIT = value;
      const server = createCoopServer({ persistenceDirectory: null });
      process.env.VERSO_SOURCE_COMMIT = 'b'.repeat(40);
      try {
        const address = await server.listen(0, '127.0.0.1');
        const response = await fetch(`http://127.0.0.1:${address.port}/health`);
        const health = await response.json();
        assert.equal(health.sourceCommit, value === source ? source : null);
        assert.equal(health.ok, true);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.ok(!JSON.stringify(health).includes(appToken));
      } finally {
        await server.close();
      }
    }
  } finally {
    if (previous === undefined) delete process.env.VERSO_SOURCE_COMMIT;
    else process.env.VERSO_SOURCE_COMMIT = previous;
  }
});

test('world workflow keeps privileged deployment manual, fixed-main, digest-pinned and separate from configuration', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/world-node.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request_target:|^  push:/m);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /name: world-node-production/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /CAPROVER_APP_TOKEN/);
  assert.doesNotMatch(workflow, /CAPROVER_PASSWORD|SSH_PRIVATE_KEY|appDefinitions/);
  assert.match(workflow, /SOURCE_COMMIT=\$\{\{ github.sha \}\}/);
  assert.match(workflow, /needs.verify-image.outputs.digest/);
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /ARG SOURCE_COMMIT=unversioned/);
  assert.match(dockerfile, /VERSO_SOURCE_COMMIT=\$\{SOURCE_COMMIT\}/);
});
