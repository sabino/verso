import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const CAPTAIN = 'https://captain.host.sabino.pro';
const HEALTH = 'https://verso-world.host.sabino.pro/health';
const REGISTRY = 'https://ghcr.io';
const PACKAGE = 'sabino/verso-world';
const API = '/api/v2/user/apps/appData/verso-world/';
const SOURCE = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** Fixed production destination. Neither dispatch input nor secrets can change the host/app. */
export function worldNodeCiPlan({ source, digest, rollbackReference } = {}) {
  if (!SOURCE.test(source || '')) throw Error('A full lowercase source commit is required.');
  if (!DIGEST.test(digest || '')) throw Error('An immutable SHA-256 image digest is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{7,199}$/.test(rollbackReference || ''))
    throw Error('A captured, retention-safe operator rollback reference is required.');
  return {
    source,
    digest,
    rollbackReference,
    app: 'verso-world',
    captain: CAPTAIN,
    health: HEALTH,
    image: `ghcr.io/${PACKAGE}@${digest}`,
    // A tiny FROM definition follows the existing image-only operator path.
    definition: { schemaVersion: 2, dockerfileLines: [`FROM ghcr.io/${PACKAGE}@${digest}`] },
  };
}

async function boundedJson(
  fetcher,
  url,
  options,
  label,
  limit = 512 * 1024,
  publicBlobRedirect = false,
) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      redirect: publicBlobRedirect ? 'manual' : 'error',
    });
  } catch {
    throw Error(`${label}: transport failed; no request was automatically retried.`);
  }
  // GHCR serves public blob bytes through this CDN. Never forward its pull token,
  // follow an arbitrary Location, or allow an additional redirect at the CDN.
  if (publicBlobRedirect && response.status === 307) {
    let target;
    try {
      const location = response.headers.get('location');
      if (!location || location.length > 16384) throw Error('invalid location');
      target = new URL(location);
      if (
        target.protocol !== 'https:' ||
        target.hostname !== 'pkg-containers.githubusercontent.com' ||
        target.port ||
        target.username ||
        target.password ||
        target.hash
      )
        throw Error('invalid target');
    } catch {
      throw Error(`${label}: rejected blob redirect destination.`);
    }
    await response.body?.cancel().catch(() => {});
    try {
      response = await fetcher(target.href, {
        signal: options.signal,
        headers: { Accept: TYPES },
        redirect: 'error',
      });
    } catch {
      throw Error(`${label}: public blob transport failed; redirects were not followed.`);
    }
    if (response.status >= 300 && response.status < 400)
      throw Error(`${label}: a second blob redirect is forbidden.`);
  }
  if (!response.ok) throw Error(`${label}: rejected HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit)
    throw Error(`${label}: response exceeded its size limit.`);
  const reader = response.body?.getReader();
  if (!reader) throw Error(`${label}: missing response body.`);
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw Error('response limit');
      }
      chunks.push(value);
    }
  } catch {
    throw Error(`${label}: response could not be read within its size limit.`);
  }
  const raw = Buffer.concat(chunks);
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw Error(`${label}: invalid JSON response.`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw Error(`${label}: invalid object response.`);
  return { data, raw, headers: response.headers };
}

/** Anonymous pull proves no host registry credential/configuration is required. */
export async function verifyPublicWorldImage(plan, { fetcher = fetch } = {}) {
  const safe = worldNodeCiPlan(plan);
  const auth = await boundedJson(
    fetcher,
    `${REGISTRY}/token?service=ghcr.io&scope=repository:${PACKAGE}:pull`,
    { signal: AbortSignal.timeout(15_000) },
    'Anonymous registry admission',
    16 * 1024,
  );
  const token = auth.data.token ?? auth.data.access_token;
  if (typeof token !== 'string' || !token || token.length > 8192 || /[\r\n]/.test(token))
    throw Error('Anonymous registry admission returned no usable pull token.');
  async function object(kind, digest) {
    if (!DIGEST.test(digest || '')) throw Error('Registry returned an invalid object digest.');
    const result = await boundedJson(
      fetcher,
      `${REGISTRY}/v2/${PACKAGE}/${kind}/${digest}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: TYPES },
        signal: AbortSignal.timeout(15_000),
      },
      'Public image verification',
      512 * 1024,
      kind === 'blobs',
    );
    const hash = `sha256:${createHash('sha256').update(result.raw).digest('hex')}`;
    if (hash !== digest) throw Error('Registry object does not match its requested digest.');
    return result.data;
  }
  let manifest = await object('manifests', safe.digest);
  if (manifest.manifests) {
    if (!Array.isArray(manifest.manifests) || manifest.manifests.length > 16)
      throw Error('Unsupported image index.');
    const platforms = manifest.manifests.filter(
      (item) => item?.platform?.os === 'linux' && item.platform.architecture === 'amd64',
    );
    if (platforms.length !== 1) throw Error('Image must contain exactly one linux/amd64 target.');
    manifest = await object('manifests', platforms[0].digest);
  }
  const config = await object('blobs', manifest.config?.digest);
  if (
    config.os !== 'linux' ||
    config.architecture !== 'amd64' ||
    config.config?.Labels?.['org.opencontainers.image.revision'] !== safe.source ||
    !Array.isArray(config.config?.Env) ||
    !config.config.Env.every((entry) => typeof entry === 'string') ||
    config.config.Env.filter((entry) => entry.startsWith('VERSO_SOURCE_COMMIT=')).join('') !==
      `VERSO_SOURCE_COMMIT=${safe.source}` ||
    config.config?.Labels?.['org.opencontainers.image.source'] !== 'https://github.com/sabino/verso'
  )
    throw Error('Public image platform/source labels do not match the reviewed source.');
  return { image: safe.image, source: safe.source, anonymouslyPullable: true };
}

export function healthyWorld(data, source) {
  return (
    data?.ok === true &&
    data.protocol === 3 &&
    data.durable === true &&
    data.storageHealthy === true &&
    data.voice?.enabled === true &&
    data.voice.codec === 'ima-adpcm-16k-v1' &&
    (!source || data.sourceCommit === source)
  );
}

/** The sole mutation is one fixed app-token build POST. Uncertain results require an operator. */
export async function deployCiWorldNode(
  input,
  {
    appToken,
    enabled = false,
    fetcher = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxHealthAttempts = 90,
  } = {},
) {
  const plan = worldNodeCiPlan(input);
  if (!enabled) throw Error('World-node CI deployment is not explicitly enabled.');
  if (
    typeof appToken !== 'string' ||
    appToken.length < 16 ||
    appToken.length > 4096 ||
    /[\r\n]/.test(appToken)
  )
    throw Error('A protected verso-world application deployment token is required.');
  if (!Number.isInteger(maxHealthAttempts) || maxHealthAttempts < 1 || maxHealthAttempts > 90)
    throw Error('Health observation must be bounded to 1–90 attempts.');
  const publicImage = await verifyPublicWorldImage(plan, { fetcher });
  async function health() {
    return (
      await boundedJson(
        fetcher,
        HEALTH,
        { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10_000) },
        'World health',
        64 * 1024,
      )
    ).data;
  }
  const before = await health();
  if (!healthyWorld(before))
    throw Error('Existing world/storage/voice health is unsafe; deployment was not submitted.');
  const baselineSource = SOURCE.test(before.sourceCommit || '') ? before.sourceCommit : null;
  if (baselineSource === plan.source)
    throw Error('This source is already live; refusing a redundant deployment.');
  const result = await boundedJson(
    fetcher,
    `${CAPTAIN}${API}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-namespace': 'captain',
        'x-captain-app-token': appToken,
        Connection: 'close',
      },
      body: JSON.stringify({
        captainDefinitionContent: JSON.stringify(plan.definition),
        gitHash: plan.source,
      }),
      signal: AbortSignal.timeout(180_000),
    },
    'CapRover image-only deployment (inspect privately before any retry)',
    16 * 1024,
  );
  // Synchronous API success only. App tokens intentionally cannot read admin build status.
  if (result.data.status !== 100)
    throw Error('CapRover did not confirm synchronous deployment; inspect privately before retry.');
  let consecutive = 0;
  for (let attempt = 0; attempt < maxHealthAttempts; attempt++) {
    if (attempt) await sleep(5000);
    try {
      consecutive = healthyWorld(await health(), plan.source) ? consecutive + 1 : 0;
    } catch {
      consecutive = 0;
    }
    if (consecutive >= 3)
      return {
        schema: 1,
        app: plan.app,
        sourceCommit: plan.source,
        image: plan.image,
        baselineSourceCommit: baselineSource,
        rollbackReference: plan.rollbackReference,
        publicImage,
        exactSourceHealthVerified: true,
        consecutiveHealthyChecks: consecutive,
        gameplayEndpoint: 'wss://verso-world.host.sabino.pro/ws',
        voiceEndpoint: 'wss://verso-world.host.sabino.pro/voice',
        operatorWireAndStorageVerificationRequired: true,
      };
  }
  throw Error(
    'Deployment was submitted but exact-source healthy storage/voice was not verified. Inspect privately; no automatic retry or unsafe data rollback was attempted.',
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      digest: { type: 'string' },
      'rollback-reference': { type: 'string' },
      report: { type: 'string' },
    },
  });
  const mode = positionals[0] || 'plan';
  if (positionals.length > 1 || !['plan', 'deploy'].includes(mode))
    throw Error('Use plan or deploy.');
  const plan = worldNodeCiPlan({
    source: values.source,
    digest: values.digest,
    rollbackReference: values['rollback-reference'],
  });
  if (mode === 'plan') {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const result = await deployCiWorldNode(plan, {
    appToken: process.env.CAPROVER_APP_TOKEN,
    enabled: process.env.VERSO_WORLD_DEPLOY_ENABLED === 'true',
  });
  if (values.report)
    await writeFile(values.report, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
