# Legacy URL and installed-app bridge

The canonical client moves to `https://sabino.pro/verso/`. Publish the five readable files in `migration/legacy/` at the existing `/games/verso/` directory only after the new project release is available. They contain a loader, manifest validator and cache adapter, with no duplicated engine or generated game assets. Deployment and the main website are managed separately; these templates do not publish themselves.

The old page stays at its original URL, including the exact query and fragment used for invitations. Its base URL points to `/verso/`, and it loads that release's entry module and styles. `localStorage`, IndexedDB, browser identity and other origin storage are neither copied nor rewritten by the bridge. The legacy manifest explicitly retains `/games/verso/` as its ID, start URL and scope. Icons come from the new project. A separate new-project installation can have its own identity; the bridge does not merge installations.

## Release contract

The only discovery URL is same-origin `/verso/release.json`:

```json
{
  "schema": 1,
  "sourceCommit": "FULL_40_CHARACTER_LOWERCASE_GIT_SHA",
  "entrypoint": "assets/index-CONTENTHASH.js",
  "stylesheets": ["assets/index-CONTENTHASH.css"],
  "assets": {
    "assets/index-CONTENTHASH.js": { "sha256": "FULL_64_CHARACTER_LOWERCASE_SHA256", "bytes": 1234 }
  },
  "swVersion": "20_TO_64_LOWERCASE_HEX_CHARACTERS"
}
```

The placeholder example is illustrative, not a valid release. All entrypoint and stylesheet paths must exist in `assets`; an empty stylesheet list is supported when the entry imports its own CSS. The producer includes every required static asset, including lazy chunks, audio, art, fonts and icons, while excluding `sw.js` and `release.json`. The validator allows only literal relative paths in the documented static directories and fixed metadata/icon filenames. It rejects origins, absolute paths, traversal, URL encodings, queries, fragments, prototype keys and unknown schema fields. Limits are 512 assets, 32 MiB each, 128 MiB total, 32 stylesheets and a 256 KiB release response.

Optional bounded scalar metadata fields are `sourceRepository`, `sourceBranch`, `worldNodeSourceCommit`, `worldEndpoint`, `voiceEndpoint`, `worldNodeEndpoint`, `worldUrl`, `voiceUrl`, `version`, `sourceDate`, `frontendUrl`, `legacyUrl` and `codec`; they do not affect URL authority or imports. Missing and null optional metadata are accepted. This is a same-origin publishing trust boundary, not a signed-release or hostile-origin integrity system. The entry and declared styles use browser subresource integrity; the worker verifies all cached bytes against the manifest.

## Offline and worker upgrade

1. The loader registers a module worker at the **existing** `/games/verso/sw.js`, with the old scope. It never calls `skipWaiting`, clears application storage or forces a reload. The game may independently register its canonical `/verso/` worker; that worker has a different scope.
2. Installation downloads the fixed release, checks each asset's exact byte length and SHA-256, and caches the four legacy shell files. Only a complete cache receives a release marker and becomes the current pointer. Failed fetches, integrity checks or cache writes leave the previous release intact. An origin-wide Web Lock serializes staging and cleanup across active and installing workers; without Web Locks, installation/refresh refuses all cache mutation. Each network response has a 30-second deadline covering its body, including the loader's initial manifest.
3. Normal activation follows the browser's existing-client lifecycle. Only then can the bridge remove obsolete `verso-offline` caches for the exact old scope. New-project and unrelated caches are untouched.
4. A controlled old page opens its current complete cached release and asks the worker to refresh in the background. A successful refresh makes the new release available on the next launch. An uncontrolled online page reads the current project release directly. Identical bridge script bytes do not prevent later game-release discovery.
5. Keep the current and immediately preceding complete bridge releases. Known cached assets and the old shell work without network access; unknown URLs are passed through and never cached. Only GET requests qualify. APIs, voice transport and microphone input are not part of the cache contract.

The manifest JSON and all published static responses must remain on the same origin without redirects. Both locations require their normal HTTPS service-worker support. Serving `sw.js` and its imports with update-friendly cache headers is recommended; registration uses `updateViaCache: 'none'`. Publish the project assets and release before replacing the old website shell. Do not remove old deployment files as a side effect of installing these source templates; the website integrator owns that bounded migration and its live gates.

## Honest limits and rollout checks

- An already-open old game can request an old lazy asset before the replacement worker activates. If that asset was never cached and the website has removed it, the request can fail. The bridge cannot repair code already executing in a tab. Keep an appropriate old-asset transition window or ask affected players to close and reopen after a successful bridge install.
- Two complete bridge versions are retained. A tab left open through several subsequent releases is not guaranteed every obsolete lazy chunk forever. Content-addressed project deployment retention can improve that window.
- First-time offline visits, failed precaching, denied browser storage, missing Web Locks and unsupported module workers have no new offline guarantee. Online loading remains available where modules and fetch work; a previously installed bridge keeps its last complete release if update capabilities later disappear. The fallback link preserves invitations and offers `/verso/` without silently navigating or changing saves.
- Save compatibility remains the game's responsibility. These files do not validate, downgrade, export or rewrite saved lives. Same-origin code can access origin storage; path separation is not a security sandbox.

`tests/legacy-pages-bridge.test.ts` executes the actual loader and worker logic with an in-memory Cache API. It covers strict manifests, body bounds, invitation preservation, old PWA identity, failed and successful cache upgrades, two-release retention and request isolation. This is not a native browser upgrade certification. Before publication, use a held old worker/PWA and real saved life to verify online upgrade, closed-and-reopened activation, offline reload and movement, invitations, and canonical installation separately. Keep the old-tab limitation in the release handoff.
