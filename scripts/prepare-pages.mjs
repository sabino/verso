import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBuildMetadata } from './build-metadata.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function staticManifest(directory) {
  const out = {};
  function visit(relative = '') {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw Error('Static assets cannot be links');
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && !['sw.js', 'release.json'].includes(name)) {
        const bytes = fs.readFileSync(path.join(directory, name));
        out[name] = { sha256: sha(bytes), bytes: bytes.length };
      }
    }
  }
  visit();
  return out;
}

export function releaseManifest(directory, metadata) {
  if (!/^[a-f0-9]{40}$/.test(metadata.revision) || metadata.modified)
    throw Error('Pages requires a clean, committed source');
  const assets = staticManifest(directory);
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const entrypoint = html.match(
    /<script\b[^>]*type="module"[^>]*src="\.\/(assets\/[A-Za-z0-9_-]+\.js)"/,
  )?.[1];
  const stylesheets = Array.from(
    html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="\.\/(assets\/[A-Za-z0-9_-]+\.css)"/g),
    (x) => x[1],
  );
  if (!entrypoint || !assets[entrypoint] || stylesheets.some((file) => !assets[file]))
    throw Error('Built entry is missing from assets');
  const swVersion = fs
    .readFileSync(path.join(directory, 'sw.js'), 'utf8')
    .match(/const VERSION = "([a-f0-9]{20})"/)?.[1];
  if (!swVersion) throw Error('Content-versioned worker is missing');
  return {
    schema: 1,
    sourceRepository: 'https://github.com/sabino/verso',
    sourceBranch: 'main',
    sourceCommit: metadata.revision,
    version: metadata.version,
    sourceDate: metadata.sourceDate,
    frontendUrl: 'https://sabino.pro/verso/',
    legacyUrl: 'https://sabino.pro/games/verso/',
    worldEndpoint: 'wss://verso-world.host.sabino.pro/ws',
    voiceEndpoint: 'wss://verso-world.host.sabino.pro/voice',
    codec: 'ima-adpcm-16k-v1',
    entrypoint,
    stylesheets,
    swVersion,
    assets,
  };
}

/** Reject links, traversal and archive bombs; only copy regular static files. */
export function mergeArchive(archive, directory, kind) {
  if (!['legacy', 'retained'].includes(kind)) throw Error('Unknown archive kind');
  execFileSync(
    'python3',
    [
      '-c',
      `
import tarfile,pathlib,sys,shutil,re
archive,destination,kind=sys.argv[1:]
root=pathlib.Path(destination)
with tarfile.open(archive,'r:gz') as stream:
 members=stream.getmembers()
 if len(members)>20000 or sum(m.size for m in members)>256*1024*1024: raise ValueError('Static archive budget exceeded')
 for m in members:
  name=m.name.removeprefix('./').rstrip('/')
  if not name: continue
  if not re.fullmatch(r'[A-Za-z0-9_./-]+',name) or any(x in ('..','.') for x in name.split('/')) or name.startswith('/'): raise ValueError('Unsafe archive path')
  if not(m.isfile() or m.isdir()): raise ValueError('Static archive links are forbidden')
  if kind=='retained' and not(name=='assets' or name.startswith('assets/')): raise ValueError('Unexpected retained content')
 for m in members:
  if not m.isfile(): continue
  name=m.name.removeprefix('./')
  target=root/name
  if target.exists():
   if target.read_bytes()!=stream.extractfile(m).read(): raise ValueError('Content hash filename collision')
   continue
  target.parent.mkdir(parents=True,exist_ok=True)
  with stream.extractfile(m) as source,target.open('wb') as output: shutil.copyfileobj(source,output)
`,
      archive,
      directory,
      kind,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export function preparePages({
  directory,
  metadata,
  legacyArchive,
  retainedArchive,
  legacySha256,
}) {
  // This manifest describes only the new complete build, not archived generations.
  const release = releaseManifest(directory, metadata);
  if (legacyArchive) {
    if (sha(fs.readFileSync(legacyArchive)) !== legacySha256)
      throw Error('Pinned migration archive checksum mismatch');
    mergeArchive(legacyArchive, path.join(directory, 'compat/games-verso'), 'legacy');
  }
  if (retainedArchive) mergeArchive(retainedArchive, directory, 'retained');
  fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, '.nojekyll'), '');
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(new URL('../migration/hosting.json', import.meta.url)));
  const release = preparePages({
    directory: 'dist',
    metadata: readBuildMetadata(),
    legacyArchive: process.argv[2],
    retainedArchive: process.argv[3],
    legacySha256: config.legacyArchive.sha256,
  });
  console.log(
    JSON.stringify({
      sourceCommit: release.sourceCommit,
      swVersion: release.swVersion,
      assets: Object.keys(release.assets).length,
    }),
  );
}
