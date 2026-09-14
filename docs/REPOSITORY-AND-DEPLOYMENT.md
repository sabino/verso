# Verso repository and deployment

Verso source lives in [sabino/verso](https://github.com/sabino/verso). The first 179 source commits through `8b88dc2e0321d236a28fb373c57d24385f096077` are copied with their original IDs, authors, dates and parents. No history filtering, squashing or force push is needed: this local repository was game-only from its first commit. Earlier deployment commits and archival source branches in `sabino.github.io` are preserved as historical references; new development goes to this repository.

## One game, two addresses

The canonical project site is **https://sabino.pro/verso/**. Like [DoomGeo](https://github.com/sabino/DoomGeo), it uses GitHub Pages from its own repository and inherits the user site's existing custom domain. No project CNAME, new domain, DNS record or proxy is needed. GitHub documents this [custom-domain inheritance](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

The established **https://sabino.pro/games/verso/** address stays playable using only the small human-readable files in `migration/legacy/`. Its loader reads the canonical build manifest and imports the same game entry; it does not contain another game implementation. The old origin, URL query/hash, installed-app identity and scope remain. Local storage and IndexedDB keys are not renamed, copied, exported or cleared. See [the legacy PWA contract](LEGACY-URL-MIGRATION.md).

Theo is a story scenario on the shared engine. Character origin selects story context; it does not select a different simulator. See [shared story systems](SHARED-STORY-ENGINE.md).

## Pages CI/CD

`.github/workflows/pages.yml` runs dependency installation, the full test suite, formatting, TypeScript/build/offline generation and native headless Chromium portrait QA. Pull requests receive validation only, with read-only repository permission and no deployment credentials. A successful main push or manual main run builds an artifact and deploys it using GitHub's OIDC-backed Pages environment. GitHub's [custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) describes the official artifact/deploy actions.

`release.json` records the exact clean source commit, built entry, styles, content-versioned worker and static-file SHA-256/byte manifest. The browser build and service worker come from CI; minified bundles are not committed to either source repository. Generated Pages artifacts and compatibility assets are kept as GitHub release assets instead.

The pinned `migration-2026-09-14` release contains the exact old public website payload, SHA-256 recorded in `migration/hosting.json`. CI exposes that archive under `/verso/compat/games-verso/` for operator recovery. Previously published content-hashed JS/CSS under the new project path is carried forward from the latest successful `pages-<source SHA>` release. Archive extraction rejects links, traversal, foreign roots, hash-name collisions and more than 256 MiB or 20,000 entries; a failed retention check stops publication rather than dropping old files. This is bounded operational retention, not an unlimited archive guarantee. If that budget is approached, review installed-client compatibility before changing it.

`retain` completes before Pages deployment is allowed. A retention-upload failure blocks publication. A later failed deployment may leave extra harmless archived assets; the next run retains those along with the last working build. Release discovery is paginated. Re-running a successful source SHA can repair its generated archive without rewriting source history.

## World-node CI/CD

The existing **verso-world** CapRover app, `/ws`, `/voice`, volume, payment configuration, signing identities and secrets are retained. [World-node CI](WORLD-NODE-CI.md) builds an immutable GHCR image and deploys only through an app-scoped token in the `world-node-production` environment. It never receives the Captain administrator password or edits app settings. A manual exact-main-SHA dispatch, explicit enable variable, preserved rollback reference, anonymous digest/revision verification and matching live health identity are required.

Pages and world-node releases are deliberately separate workflows: frontends remain compatible with the deployed protocol; changes needing new authority behavior deploy the verified node before exposing dependent client behavior. A green generic health response is insufficient: the node returns its immutable source identity. Final production verification must also check legacy joins, scoped voice, storage and operator configuration. No workflow automatically reverts to a serializer that could discard newer saved fields.

## Migration order and rollback

1. Capture original refs, a complete local git bundle, old public payload and operator revision/configuration/data reference.
2. Create the dedicated repository and copy the source history unchanged; enable workflow Pages without a CNAME.
3. Validate source, story compatibility, both CI workflows and the old-path worker against actual release metadata. Publish the new project site and verify its exact artifact.
4. Upgrade the old-path loader/worker while its current files still exist. Verify an already-cached life, new entry, installed scope and offline continuation.
5. Remove only the old tracked generated game payload from the website's current tree, retaining the reviewed shim. Keep historical commits intact. Verify both URLs again.
6. Verify the world-node pipeline on its established service using a least-privilege app token; compare protected operator configuration and all persistent signing/data records.

The captured current website commit and immutable image are rollback references. Never blindly restore an older data backup over new player progress. The earlier living-systems serializer boundary requires its tested retained-data guard if an old engine must be used; see the historical [release contract](LIVING-SYSTEMS-RELEASE.md). This migration adds no new save format and makes no changes to world coordinates or procedural generation. For a frontend-only incident, restore the compatible captured loader/build while retaining player storage and all needed hashed assets.

Physical iOS/Android installed-app updates, OS microphone routing and long-session behavior still need real-device checks. Browser automation verifies actual native pointer/keyboard events, service workers, offline cache and unchanged save contents; it is not a physical device certification.
