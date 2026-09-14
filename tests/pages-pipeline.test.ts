import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { releaseManifest, preparePages, mergeArchive } from '../scripts/prepare-pages.mjs';
const metadata = {
  revision: 'a'.repeat(40),
  version: '0.1.0',
  sourceDate: '2026-09-14',
  modified: false,
};
function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-pages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(dist, 'index.html'),
    '<script type="module" crossorigin src="./assets/index-abc.js"></script><link rel="stylesheet" href="./assets/main-abc.css">',
  );
  fs.writeFileSync(path.join(dist, 'assets/index-abc.js'), 'export const game=1;');
  fs.writeFileSync(path.join(dist, 'assets/main-abc.css'), 'body{}');
  fs.writeFileSync(path.join(dist, 'sw.js'), 'const VERSION = "0123456789abcdef0123";');
  return { root, dist };
}
test('Pages release identifies exact clean source, entry and content without caching archival generations', (t) => {
  const { root, dist } = fixture(t);
  const prior = path.join(root, 'prior');
  fs.mkdirSync(path.join(prior, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(prior, 'assets/prior.js'), 'old');
  const archive = path.join(root, 'prior.tgz');
  execFileSync('tar', ['-czf', archive, '-C', prior, 'assets']);
  const release = preparePages({ directory: dist, metadata, retainedArchive: archive });
  assert.equal(release.sourceRepository, 'https://github.com/sabino/verso');
  assert.equal(release.entrypoint, 'assets/index-abc.js');
  assert.deepEqual(release.stylesheets, ['assets/main-abc.css']);
  assert.equal(release.assets['assets/prior.js'], undefined);
  assert.equal(fs.readFileSync(path.join(dist, 'assets/prior.js'), 'utf8'), 'old');
  assert.equal(
    release.assets['assets/index-abc.js'].sha256,
    createHash('sha256').update('export const game=1;').digest('hex'),
  );
  assert.equal(release.assets['sw.js'], undefined);
  assert.equal(release.assets['release.json'], undefined);
  assert.throws(() => releaseManifest(dist, { ...metadata, modified: true }), /clean/);
  assert.throws(() => releaseManifest(dist, { ...metadata, revision: 'unknown' }), /committed/);
});
test('migration compatibility archive must match its committed checksum before writing', (t) => {
  const { root, dist } = fixture(t);
  const archive = path.join(root, 'compat.tgz');
  execFileSync('tar', ['-czf', archive, '-C', dist, 'assets']);
  assert.throws(
    () =>
      preparePages({
        directory: dist,
        metadata,
        legacyArchive: archive,
        legacySha256: 'f'.repeat(64),
      }),
    /checksum/,
  );
  assert.equal(fs.existsSync(path.join(dist, 'compat')), false);
  const sum = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  preparePages({ directory: dist, metadata, legacyArchive: archive, legacySha256: sum });
  assert.equal(
    fs.readFileSync(path.join(dist, 'compat/games-verso/assets/index-abc.js'), 'utf8'),
    'export const game=1;',
  );
});
test('archive traversal, links, foreign roots and hashed filename collisions fail closed', (t) => {
  const { root, dist } = fixture(t);
  for (const kind of ['traversal', 'symlink', 'foreign', 'collision']) {
    const file = path.join(root, kind + '.tgz');
    execFileSync('python3', [
      '-c',
      `import tarfile,io,sys\nkind=sys.argv[2]\nwith tarfile.open(sys.argv[1],'w:gz') as t:\n m=tarfile.TarInfo({'traversal':'../outside','symlink':'assets/link','foreign':'server/key','collision':'assets/index-abc.js'}[kind])\n if kind=='symlink':m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd'\n else:m.size=4\n t.addfile(m,io.BytesIO(b'evil') if kind!='symlink' else None)`,
      file,
      kind,
    ]);
    assert.throws(() => mergeArchive(file, dist, 'retained'));
  }
  assert.equal(fs.existsSync(path.join(root, 'outside')), false);
  assert.equal(
    fs.readFileSync(path.join(dist, 'assets/index-abc.js'), 'utf8'),
    'export const game=1;',
  );
});
