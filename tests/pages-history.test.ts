import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedPagesReleases } from '../scripts/pages-history.mjs';

const release = (letter: string, published: string, extra = {}) => ({
  id: letter.charCodeAt(0),
  tag_name: `pages-${letter.repeat(40)}`,
  draft: false,
  prerelease: false,
  published_at: published,
  assets: [
    {
      id: letter.charCodeAt(0) + 100,
      name: 'retained-assets-next.tar.gz',
      state: 'uploaded',
      size: 1024,
    },
  ],
  ...extra,
});

test('unordered paginated releases retain every published archive, including histories absent from the newest', () => {
  const early = release('e', '2026-11-10T06:15:00Z');
  const omitted = release('a', '2026-11-10T07:43:00Z');
  const newest = release('b', '2026-11-10T08:20:00Z');
  const older = release('c', '2026-09-14T05:00:00Z', { prerelease: true });
  const pages = [
    [early, newest],
    [omitted, older],
  ];
  const before = structuredClone(pages);
  assert.deepEqual(
    retainedPagesReleases(pages).map((item: any) => item.tag_name),
    [older, early, omitted, newest].map((item) => item.tag_name),
  );
  assert.deepEqual(pages, before, 'Selection does not reorder or mutate the API response');
  const selected = retainedPagesReleases(pages);
  selected[0].assets[0].size = 99;
  assert.equal(older.assets[0].size, 1024, 'Returned metadata is detached');
});

test('publication ties use tags, repeated pages dedupe, and draft/unrelated releases contribute nothing', () => {
  const a = release('a', '2026-11-10T08:20:00Z');
  const b = release('b', a.published_at);
  const ignored = [
    { tag_name: 'migration-2026-09-14', draft: false },
    { tag_name: 'pages-short', draft: false },
    { tag_name: `pages-${'F'.repeat(40)}`, draft: false },
    { tag_name: `pages-${'c'.repeat(40)}`, draft: true },
  ];
  assert.deepEqual(
    retainedPagesReleases([
      [b, ...ignored],
      [a, structuredClone(b)],
    ]).map((item: any) => item.tag_name),
    [a.tag_name, b.tag_name],
  );
  assert.deepEqual(retainedPagesReleases([]), []);
  assert.deepEqual(retainedPagesReleases([ignored, []]), []);
});

test('malformed API shapes and incomplete published archives fail instead of dropping compatibility', () => {
  const valid = release('a', '2026-11-10T08:20:00Z');
  for (const invalid of [null, {}, [valid], [[null]], [[{ tag_name: valid.tag_name }]]])
    assert.throws(() => retainedPagesReleases(invalid));
  for (const extra of [
    { published_at: null },
    { published_at: 'not-a-date' },
    { published_at: '1' },
    { assets: undefined },
    { assets: [null] },
    { assets: [] },
    { assets: [...valid.assets, ...valid.assets] },
    ...[{ state: 'new' }, { id: 0 }, { size: 0 }, { size: NaN }].map((change) => ({
      assets: [{ ...valid.assets[0], ...change }],
    })),
  ])
    assert.throws(
      () => retainedPagesReleases([[valid, { ...release('b', valid.published_at), ...extra }]]),
      /Published Pages/,
    );
});

test('conflicting duplicate archive identities fail regardless of pagination order', () => {
  const valid = release('a', '2026-11-10T08:20:00Z');
  for (const change of [
    { id: valid.id + 1 },
    { published_at: '2026-11-10T08:21:00Z' },
    ...[
      { id: 999 },
      { size: 2048 },
      { digest: 'sha256:changed' },
      { updated_at: '2026-11-10T08:21:00Z' },
    ].map((value) => ({ assets: [{ ...valid.assets[0], ...value }] })),
  ]) {
    const changed = { ...valid, ...change };
    for (const pages of [[[valid], [changed]], [[changed, valid]]])
      assert.throws(() => retainedPagesReleases(pages), /changed during listing/);
  }
});
