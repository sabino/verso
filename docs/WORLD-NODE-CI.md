# World node CI: one existing app, one immutable image

The manually dispatched `World node — reviewed image deployment` workflow builds the exact reviewed `main` commit and updates only the existing `verso-world` image. It keeps `https://verso-world.host.sabino.pro`, `/ws`, `/voice`, volumes, signing identities, payments, proxy settings and environment configuration. It does not create apps, configure registries, update nginx, change DNS, reset data or enable payments. Frontend Pages publication is a separate workflow.

## One-time operator setup

Before enabling or running the deployment job:

1. Protect the `world-node-production` GitHub environment: allow only `main` deployments, configure a required reviewer and prevent self-review/bypass where the account plan supports it. Review workflow changes as production code.
2. Enable the existing **verso-world application deployment token**, using its CapRover Deployment panel or the authenticated existing app-update route while preserving the entire current configuration. Transfer that token directly into environment secret `CAPROVER_APP_TOKEN`; never put the Captain administrator password or SSH key in Actions. The captured pre-migration configuration had app tokens disabled, so no usable credential is silently assumed.
3. Publish the `ghcr.io/sabino/verso-world` package with access inherited from the public `sabino/verso` repository and explicitly make the package public. GHCR packages can initially be private even when the repository is public. The workflow uses its own short-lived `GITHUB_TOKEN` to publish. The deployed host needs no registry credential: anonymous digest/config verification must pass before the deployment request. First dispatch may build the package and then fail this gate until its visibility is set; it has not mutated production at that point.
4. Set environment variable `VERSO_WORLD_DEPLOY_ENABLED=true` only after independent review and operator preparation. The helper rejects missing/disabled configuration before any network request.
5. Capture the current image/revision, configuration hashes, private data/signing identity backup and a retention-safe rollback strategy. Supply the private capture's non-secret reference as the dispatch input. A reference is an operator attestation, not proof that an old image understands new saves. Never roll new data back to an old checkpoint. Keep the previously prepared guarded fallback and use forward repair when a schema downgrade would discard records.

The GitHub environment is a real security boundary, not something a YAML declaration automatically protects. If the account cannot enforce the required gate, keep the enable variable unset and deploy with the reviewed local operator instead.

## Dispatch and execution

Run `.github/workflows/world-node.yml` from `main`, entering the full40-character `source_sha` that exactly matches that branch revision and the captured rollback reference. The workflow rejects a mismatching source before building. It runs `npm ci`, the entire test suite, formatting and production/offline build on Node24.15.0, then publishes a linux/amd64 image with original source/revision labels and build provenance. Production concurrency is serialized; an in-flight deployment is never cancelled by a second dispatch.

The protected deploy job does the following:

- Pins the image by SHA-256 digest, independently checks anonymous GHCR access, hashes the manifest/index/config objects, and verifies the selected linux/amd64 config has the exact source/repository labels and runtime source stamp. GHCR blob responses may use one307 redirect to the exact HTTPS `pkg-containers.githubusercontent.com` CDN; the helper strips registry Authorization, permits no further redirect and still verifies the bytes against their requested digest. Token/manifest requests cannot redirect.
- Requires healthy existing `/health`, durable storage and enabled voice before submitting anything.
- Sends **one synchronous** `POST https://captain.host.sabino.pro/api/v2/user/apps/appData/verso-world/` with the `x-captain-app-token` header, namespace `captain`, `gitHash` and a schema2 `dockerfileLines: ["FROM ghcr.io/sabino/verso-world@sha256:…"]` definition. There are no app-definition/configuration mutations and no automatic POST retries.
- Observes three consecutive healthy results, five seconds apart, whose `sourceCommit` matches the requested source and whose storage/voice are healthy, including the established `ima-adpcm-16k-v1` voice codec. Docker embeds `SOURCE_COMMIT` as `VERSO_SOURCE_COMMIT`; `/health` exposes only a valid lowercase40-character commit or `null` for unstamped/manual builds. The old healthy process cannot satisfy this exact-revision check.
- Saves a secret-free deployment/health report as an Actions artifact. Admin credentials, registry pull tokens, arbitrary server bodies, app environment arrays and build logs never enter output.

App tokens are intentionally admitted only on the app's POST build route. They cannot read administrator app definitions/build logs or verify the Docker service object. Therefore the report explicitly marks **operator wire/storage verification required**. The report means exact runtime source/storage/voice health, not completion of all deployment gates.

## Post-deployment gate and failure handling

The operator must still inspect the actual service image/revision and unchanged configuration/volume/signing identities, run bounded legacy `/ws`, synthetic authenticated `/voice` and living-system persistence/replay checks, and inspect errors/resources. Use the established operator's private capture and smoke scripts; no real microphone recording or unrelated room changes. Confirm the independently published frontend/PWA revision and URL transition before announcing a full release.

Timeouts and interrupted POST responses are **ambiguous**: CapRover may have accepted a build. Do not blindly retry or force an older image. Inspect the app privately, preserve new data, and either finish verification, perform a compatible forward repair, or activate the already verified retention-safe fallback. The helper never silently broadens credentials, deletes data or performs an unsafe automatic rollback. The90-attempt health observation and individual request/response bounds keep polling finite.

## Local checks

`node --experimental-strip-types --test tests/ci-world-node.test.ts` exercises destination/image pinning, anonymous registry verification, app-token-only POST, response redaction/limits, no retries, stale/mismatching source health, disabled setup, and the actual server's public revision field. `node scripts/ci-world-node.mjs plan --source <40hex> --digest sha256:<64hex> --rollback-reference <captured-reference>` is read-only and requires no credentials.

## Primary implementation references

- [CapRover's official GitHub deployment action](https://github.com/caprover/deploy-from-github/blob/main/README.md) documents app-token and prebuilt-image deployment.
- [Pinned app-token injection](https://github.com/caprover/caprover/blob/468e925eac2f4db29af07d999ba61c640fa32132/src/injection/Injector.ts#L110) checks that the named app has an enabled matching token. [User routing](https://github.com/caprover/caprover/blob/468e925eac2f4db29af07d999ba61c640fa32132/src/routes/user/UserRouter.ts#L24) restricts that injection to the POST build route.
- [Pinned deployment route](https://github.com/caprover/caprover/blob/468e925eac2f4db29af07d999ba61c640fa32132/src/routes/user/apps/appdata/AppDataRouter.ts#L73) accepts the definition and `gitHash`; absence of `detached` selects synchronous status100.
- [Pinned token provisioning](https://github.com/caprover/caprover/blob/468e925eac2f4db29af07d999ba61c640fa32132/src/datastore/AppsDataStore.ts#L774) creates an app token when enabled with no existing value. Verify the installed API version before using newer partial-update endpoints.
- [GitHub container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) describes anonymous public pulls, package visibility and workflow authentication.
