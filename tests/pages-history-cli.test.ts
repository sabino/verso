import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('history CLI preserves divergent archives from unordered paginated releases without network', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-history-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, 'migration'));
  const migration = 'migration-2026-09-14';
  fs.writeFileSync(
    path.join(root, 'migration/hosting.json'),
    JSON.stringify({
      repository: 'sabino/verso',
      legacyArchive: { tag: migration },
    }),
  );
  fs.writeFileSync(path.join(root, migration + '.tgz'), 'pinned migration fixture');
  function published(generation: string, letter: string, hour: string) {
    const tag = `pages-${letter.repeat(40)}`;
    const source = path.join(root, generation);
    fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(source, `assets/${generation}.js`),
      `export const generation='${generation}';`,
    );
    fs.writeFileSync(path.join(source, 'assets/shared.js'), 'export const shared=true;');
    const archive = path.join(root, tag + '.tgz');
    execFileSync('tar', ['-czf', archive, '-C', source, 'assets']);
    return {
      id: letter.charCodeAt(0),
      tag_name: tag,
      draft: false,
      published_at: `2026-11-10T${hour}:00:00Z`,
      assets: [
        {
          id: letter.charCodeAt(0) + 100,
          name: 'retained-assets-next.tar.gz',
          state: 'uploaded',
          size: fs.statSync(archive).size,
        },
      ],
    };
  }
  const older = published('older', 'a', '07');
  const newer = published('newer', 'b', '08');
  fs.writeFileSync(
    path.join(root, 'releases.json'),
    JSON.stringify([
      [newer, { tag_name: migration, draft: false }],
      [older, newer],
    ]),
  );
  // Replace only gh in this subprocess. Unexpected commands fail locally, so a
  // test cannot fall through to credentials or the real GitHub service.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.VERSO_PAGES_FIXTURE_ROOT;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  assert.deepEqual(args, ['api', 'repos/sabino/verso/releases?per_page=100', '--paginate', '--slurp']);
  process.stdout.write(fs.readFileSync(path.join(root, 'releases.json')));
} else {
  assert.equal(args[0], 'release');
  assert.equal(args[1], 'download');
  assert.equal(args.length, 9);
  assert.equal(args[3], '--repo');
  assert.equal(args[4], 'sabino/verso');
  assert.equal(args[5], '--pattern');
  assert.equal(args[7], '--dir');
  const expected = args[2].startsWith('migration-') ? 'legacy-site.tar.gz' : 'retained-assets-next.tar.gz';
  assert.equal(args[6], expected);
  fs.copyFileSync(path.join(root, args[2] + '.tgz'), path.join(args[8], expected), fs.constants.COPYFILE_EXCL);
}
`,
    { mode: 0o755 },
  );
  const script = fileURLToPath(new URL('../scripts/fetch-pages-history.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      VERSO_PAGES_FIXTURE_ROOT: root,
    },
  });
  assert.deepEqual(JSON.parse(output), {
    migration,
    retainedPages: [older.tag_name, newer.tag_name],
  });
  const result = path.join(root, '.dream-loop/pages-history/retained-assets.tar.gz');
  for (const generation of ['older', 'newer']) {
    assert.equal(
      execFileSync('tar', ['-xOf', result, `assets/${generation}.js`], { encoding: 'utf8' }),
      `export const generation='${generation}';`,
    );
  }
  assert.equal(
    execFileSync('tar', ['-xOf', result, 'assets/shared.js'], { encoding: 'utf8' }),
    'export const shared=true;',
  );
  const calls = fs
    .readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.filter((args) => args[0] === 'release').map((args) => args[2]),
    [migration, older.tag_name, newer.tag_name],
  );
  assert.equal(
    fs.readFileSync(path.join(root, '.dream-loop/pages-history/legacy-site.tar.gz'), 'utf8'),
    'pinned migration fixture',
  );
  assert.deepEqual(fs.readdirSync(path.join(root, '.dream-loop/pages-history')).sort(), [
    'legacy-site.tar.gz',
    'retained-assets.tar.gz',
  ]);
});
