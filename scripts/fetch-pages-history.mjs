import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const out = '.dream-loop/pages-history';
fs.mkdirSync(out, { recursive: true });
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
const latest = releases
  .flat()
  .find((release) => !release.draft && /^pages-[a-f0-9]{40}$/.test(release.tag_name));
if (latest) {
  gh(
    'release',
    'download',
    latest.tag_name,
    '--repo',
    config.repository,
    '--pattern',
    'retained-assets-next.tar.gz',
    '--dir',
    out,
  );
  fs.renameSync(`${out}/retained-assets-next.tar.gz`, `${out}/retained-assets.tar.gz`);
} else {
  fs.mkdirSync(`${out}/empty/assets`, { recursive: true });
  execFileSync('tar', ['-czf', `${out}/retained-assets.tar.gz`, '-C', `${out}/empty`, 'assets']);
}
console.log(
  JSON.stringify({ migration: config.legacyArchive.tag, previousPages: latest?.tag_name ?? null }),
);
