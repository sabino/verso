import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeArchive } from './prepare-pages.mjs';
import { retainedPagesReleases } from './pages-history.mjs';
const out = '.dream-loop/pages-history';
fs.mkdirSync(out, { recursive: true });
const staging = fs.mkdtempSync(path.join(out, 'retention-'));
const config = JSON.parse(fs.readFileSync('migration/hosting.json', 'utf8'));
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (
  config.repository !== 'sabino/verso' ||
  !/^migration-\d{4}-\d{2}-\d{2}$/.test(config.legacyArchive.tag)
)
  throw Error('Unexpected hosting configuration');
gh(
  'release',
  'download',
  config.legacyArchive.tag,
  '--repo',
  config.repository,
  '--pattern',
  'legacy-site.tar.gz',
  '--dir',
  out,
);
const releases = JSON.parse(
  gh('api', `repos/${config.repository}/releases?per_page=100`, '--paginate', '--slurp'),
);
const history = retainedPagesReleases(releases);
const retained = path.join(staging, 'combined');
fs.mkdirSync(path.join(retained, 'assets'), { recursive: true });
// API ordering is not a publication order, and earlier archives may have diverged.
// Recover their union; choosing even the newest archive can strand an open tab.
for (const release of history) {
  const download = path.join(staging, release.tag_name);
  fs.mkdirSync(download);
  gh(
    'release',
    'download',
    release.tag_name,
    '--repo',
    config.repository,
    '--pattern',
    'retained-assets-next.tar.gz',
    '--dir',
    download,
  );
  mergeArchive(path.join(download, 'retained-assets-next.tar.gz'), retained, 'retained');
}
execFileSync('tar', [
  '-czf',
  path.join(staging, 'retained-assets.tar.gz'),
  '-C',
  retained,
  'assets',
]);
fs.renameSync(path.join(staging, 'retained-assets.tar.gz'), `${out}/retained-assets.tar.gz`);
fs.rmSync(staging, { recursive: true, force: true });
console.log(
  JSON.stringify({
    migration: config.legacyArchive.tag,
    retainedPages: history.map((r) => r.tag_name),
  }),
);
