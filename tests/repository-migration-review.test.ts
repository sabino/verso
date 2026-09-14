import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  healthyWorld,
  verifyPublicWorldImage,
  worldNodeCiPlan,
} from '../scripts/ci-world-node.mjs';

const source = 'c'.repeat(40);
const anonymousToken = 'review-pull-token-must-not-reach-cdn';
const digest = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const response = (value: unknown, status = 200, headers = {}) =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function registryFixture() {
  const config = JSON.stringify({
    os: 'linux',
    architecture: 'amd64',
    config: {
      Env: [`VERSO_SOURCE_COMMIT=${source}`],
      Labels: {
        'org.opencontainers.image.source': 'https://github.com/sabino/verso',
        'org.opencontainers.image.revision': source,
      },
    },
  });
  const manifest = JSON.stringify({
    schemaVersion: 2,
    config: { digest: digest(config) },
  });
  const plan = worldNodeCiPlan({
    source,
    digest: digest(manifest),
    rollbackReference: 'review-existing-state-retention',
  });
  const location = `https://pkg-containers.githubusercontent.com/ghcr1/blobs/${digest(config)}?review=redacted`;
  return { config, manifest, plan, location };
}

test('observed GHCR config redirect verifies content without forwarding registry credentials', async () => {
  const f = registryFixture();
  const calls: Array<{ url: string; options: any }> = [];
  const result = await verifyPublicWorldImage(f.plan, {
    fetcher: async (url: string, options: any) => {
      calls.push({ url, options });
      if (url.includes('/token?')) return response({ token: anonymousToken });
      if (url.includes('/manifests/')) return response(f.manifest);
      if (url.startsWith('https://ghcr.io/v2/')) {
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers.Authorization, `Bearer ${anonymousToken}`);
        return response('', 307, { Location: f.location });
      }
      assert.equal(url, f.location);
      assert.equal(options.redirect, 'error');
      assert.equal(new Headers(options.headers).has('Authorization'), false);
      assert.ok(!JSON.stringify(options).includes(anonymousToken));
      assert.equal(options.signal, calls.at(-2)!.options.signal);
      return response(f.config);
    },
  });
  assert.equal(calls.length, 4);
  assert.equal(result.anonymouslyPullable, true);
  assert.equal(result.source, source);
  assert.ok(!JSON.stringify(result).includes(anonymousToken));
});

test('registry redirect cannot expand origin, leak credentials, or recurse through a second redirect', async () => {
  const f = registryFixture();
  for (const location of [
    'https://attacker.invalid/config',
    'https://pkg-containers.githubusercontent.com.attacker.invalid/config',
    'http://pkg-containers.githubusercontent.com/config',
    'https://pkg-containers.githubusercontent.com:444/config',
    'https://user:password@pkg-containers.githubusercontent.com/config',
    'https://pkg-containers.githubusercontent.com/config#fragment',
    '/relative/config',
    '//pkg-containers.githubusercontent.com/config',
    f.location,
  ]) {
    let cdnRequests = 0;
    await assert.rejects(
      verifyPublicWorldImage(f.plan, {
        fetcher: async (url: string, options: any) => {
          if (url.includes('/token?')) return response({ token: anonymousToken });
          if (url.includes('/manifests/')) return response(f.manifest);
          if (url.startsWith('https://ghcr.io/v2/'))
            return response('', 307, { Location: location });
          cdnRequests++;
          assert.equal(url, f.location);
          assert.equal(new Headers(options.headers).has('Authorization'), false);
          return response('', 307, { Location: 'https://attacker.invalid/second' });
        },
      }),
      (error: Error) =>
        !error.message.includes(anonymousToken) &&
        !error.message.includes(location) &&
        !error.message.includes('password'),
      location,
    );
    assert.equal(cdnRequests, location === f.location ? 1 : 0);
  }
});

test('redirected blobs still need the reviewed digest and bounded body', async () => {
  const f = registryFixture();
  for (const body of [
    JSON.stringify({ ...JSON.parse(f.config), forged: true }),
    'x'.repeat(600 * 1024),
  ]) {
    await assert.rejects(
      verifyPublicWorldImage(f.plan, {
        fetcher: async (url: string) => {
          if (url.includes('/token?')) return response({ token: anonymousToken });
          if (url.includes('/manifests/')) return response(f.manifest);
          if (url.startsWith('https://ghcr.io/v2/'))
            return response('', 307, { Location: f.location });
          assert.equal(url, f.location);
          return response(body);
        },
      }),
    );
  }
});

test('enabled voice with a missing or incompatible codec cannot satisfy production health', () => {
  const healthy = {
    ok: true,
    protocol: 3,
    durable: true,
    storageHealthy: true,
    sourceCommit: source,
    voice: { enabled: true, codec: 'ima-adpcm-16k-v1' },
  };
  assert.equal(healthyWorld(healthy, source), true);
  for (const codec of [undefined, null, '', 'opus', 'ima-adpcm-48k-v2']) {
    assert.equal(healthyWorld({ ...healthy, voice: { enabled: true, codec } }, source), false);
  }
});
