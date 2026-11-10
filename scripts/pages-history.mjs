const pagesTag = /^pages-[a-f0-9]{40}$/;
const archiveName = 'retained-assets-next.tar.gz';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every published archive contributes to compatibility: historical releases may
 * have diverged, and the API order does not establish deployment order. */
export function retainedPagesReleases(pages) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
    throw Error('Expected paginated release arrays');
  const retained = new Map();
  for (const release of pages.flat()) {
    if (
      !record(release) ||
      typeof release.tag_name !== 'string' ||
      typeof release.draft !== 'boolean'
    )
      throw Error('Invalid release metadata');
    const tag = release.tag_name;
    if (release.draft || !pagesTag.test(tag)) continue;
    const published = release.published_at;
    const time = typeof published === 'string' ? Date.parse(published) : NaN;
    if (
      !Number.isFinite(time) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(published)
    )
      throw Error(`Published Pages release has no valid publication time: ${tag}`);
    if (
      !Array.isArray(release.assets) ||
      release.assets.some((asset) => !record(asset) || typeof asset.name !== 'string')
    )
      throw Error(`Published Pages release has invalid asset metadata: ${tag}`);
    const archives = release.assets.filter((asset) => asset.name === archiveName);
    if (archives.length !== 1)
      throw Error(`Published Pages release must contain one ${archiveName}: ${tag}`);
    const archive = archives[0];
    if (
      archive.state !== 'uploaded' ||
      !Number.isSafeInteger(archive.id) ||
      archive.id <= 0 ||
      !Number.isSafeInteger(archive.size) ||
      archive.size <= 0
    )
      throw Error(`Published Pages archive is incomplete: ${tag}`);
    // Pagination can repeat an item when the upstream listing moves. Identical
    // references are harmless; changed archive identities must not be guessed.
    const fingerprint = JSON.stringify([
      release.id ?? null,
      published,
      archive.id,
      archive.size,
      archive.updated_at ?? null,
      archive.digest ?? null,
    ]);
    const existing = retained.get(tag);
    if (existing && existing.fingerprint !== fingerprint)
      throw Error(`Published Pages archive changed during listing: ${tag}`);
    if (!existing) retained.set(tag, { release: structuredClone(release), time, fingerprint });
  }
  return [...retained.values()]
    .sort(
      (a, b) =>
        a.time - b.time ||
        (a.release.tag_name < b.release.tag_name
          ? -1
          : a.release.tag_name > b.release.tag_name
            ? 1
            : 0),
    )
    .map(({ release }) => release);
}
