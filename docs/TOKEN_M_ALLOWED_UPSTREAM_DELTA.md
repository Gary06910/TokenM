# Token M Allowed Upstream Delta

This is the promotion allowlist for the candidate relative to
`upstream/main` at `bce50dbdb67408dabd1a13758fd5009e36c88753`. Rows group files
that share one reason; every modified or added candidate source/test/document
path is covered by a row.

| File(s) | Upstream status | Token M reason | Exact custom behavior | Why cannot match upstream | Test coverage |
| --- | --- | --- | --- | --- | --- |
| `package.json`, `package-lock.json` (lock unchanged) | Upstream package metadata | Branding and release ownership | `productName: Token M`, Token M repository/publish owner, release template, compatibility artifact names | Official feed would install the wrong product; package identity must remain stable | `upstreamSyncRegression`, `releaseArtifactNames` |
| `src/shared/appUpdater.js` | Upstream updater | Update ownership | `Gary06910/TokenM` is the only release feed | Token M must never consume Javis603 binaries | `appUpdater`, `upstreamSyncRegression` |
| `.github/workflows/release.yml`, `.github/TOKEN_M_RELEASE_TEMPLATE.md`, `scripts/prepare-github-release-notes.js` | Upstream release pipeline | Update ownership | Token M template and repository-checked compare links | Upstream template links to the official release | `prepareGithubReleaseNotes`, `upstreamSyncRegression` |
| `.github/signpath/*.xml`, `scripts/verify-macos-widget-app.js`, `.github/workflows/ci.yml` | Upstream packaging/signing | Branded executable/signing metadata | SignPath and macOS verification use `Token M` executable/product name | Branded binary would otherwise be looked up under `Token Monitor` | `releaseArtifactNames`, mac widget tests |
| `.env.example`, `eslint.config.js` | Upstream project config | Overlay configuration and frozen-tree lint boundaries | Documents Android API URL and excludes generated Android plus frozen WeChat assets from Desktop lint | These expose/validate the isolated overlay without changing upstream runtime | `upstreamSyncRegression`, lint |
| `AGENTS.md` | Upstream has a differing guidance file | User guidance preservation | Candidate copies the current local `AGENTS.md` byte-for-byte | Explicit task requirement; no runtime behavior changes | Byte comparison audit |
| `src/electron/main.js`, `src/electron/preload.js` | Upstream Electron entry points | Notification IPC and compatibility identity | Namespaced notification runtime, settings filtering, legacy user-data path, local-first startup order | Upstream has no Android notification contract; replacing main would lose upstream features | `tokenMIntegrationContract`, `androidSettings`, full suite |
| `src/shared/credentialStore.js` | Upstream credential store | Android credential persistence | Adds only `tokenM.androidCredential` mapping | Credential must survive pairing while provider mappings remain upstream | `androidSettings`, `androidClient` |
| `src/electron/androidClient.js`, `androidPayload.js`, `androidOutbox.js`, `androidNotificationRuntime.js`, `tokenMNotificationRuntime.js` | Token M new files | Android notification overlay | Strict API, pairing, event projection, durable queue, invalid/retry handling | No upstream equivalent | Android and notification contract tests |
| `src/electron/codexHookBridge.js`, `codexHookForwarder.js`, `codexStopHook.js` | Token M new files | Stop Hook | Authenticated loopback Stop event bridge and hook lifecycle | No upstream equivalent | Stop Hook tests and target test |
| `src/electron/renderer/tokenMNotificationSettings.js` | Token M new file | Notification settings UI | Namespaced pairing, enabled/privacy, unpair, hook controls with Chinese notification-specific runtime labels | Must not fork upstream renderer state machine | `androidSettings`, renderer contract, full suite |
| `src/electron/renderer/index.html`, `styles.css` | Upstream renderer | Branding and notification UI | Token M title plus a same-level `手机通知` Settings section and localized notification controls | Visible product and notification controls are custom | `androidSettings`, `i18n`, `aboutSettings`, full suite |
| `src/electron/renderer/app.js`, `i18n.js`, `limitProviderPresentation.js`, `trayComposer.js` | Upstream renderer | Branding and section registration | Registers the Token M notification section in upstream navigation/state/keyboard handling; notification-specific strings are registered through existing i18n | User-facing brand and the Token M section cannot remain absent; generic upstream UI stays unchanged | `androidSettings`, `i18n`, renderer-adjacent full suite |
| `src/shared/collector.js` | Upstream collector integration boundary | Windows Tokscale compatibility | Aligns the Tokscale child `HOME` with the collector profile home while preserving explicit `CODEX_HOME` and upstream scan/provider logic | The Windows Tokscale resolver can prefer an unrelated absolute `HOME`, making the real profile's Codex sessions scan as empty | `tokscaleBlankEnv`, runtime forensic comparison |
| `src/electron/tray.js`, `linuxAutostart.js`, `discordRpc.js`, `src/shared/diagnosticReport.js`, Antigravity OAuth copy | Upstream platform/UI files | Branding | Tray, Discord, autostart, diagnostics, OAuth labels/links use Token M | User-visible integration metadata must identify the custom product | Focused tests and full suite |
| `tests/electron/*` branding/overlay tests and `tests/shared/*` release tests | Upstream tests adapted or Token M new tests | Regression coverage | Expected product metadata and frozen contracts are asserted | Tests must describe the candidate, not reject its deliberate overlay | `npm test`, `npm run verify` |
| `apps/tokenm-android/**` | Token M-only new tree | Android source preservation | Android UI, services, uniCloud, schemas, generated modules retained unchanged | Upstream has no mobile source; this is outside Desktop parity | Copied Android test suite; no business logic changed |
| `wechat-miniapp/**`, `docs/wechat-miniapp/**` | Token M-only frozen legacy tree | WeChat/CloudBase preservation | 130 tracked source/config files and 14 tracked docs copied byte-for-byte; ignored dependencies/generated files excluded | User requires the transitional legacy tree to remain frozen without re-enabling it | Presence and byte comparison audit; excluded from Desktop lint |
| `tests/android/**` | Token M-only new test tree | Android contract regression coverage | The 17 existing Android/uniCloud test files run against the preserved mobile source tree | Upstream has no Android source or mobile contract to test | `node --test "tests/android/**/*.test.js"` (142/142), `npm run verify` |
| `docs/android/**` | Token M-only new tree | Android documentation preservation | Pairing, push, UX, performance, and acceptance docs retained | Not an upstream Desktop target | Documentation/source audit |
| `docs/TOKEN_M_UPSTREAM_DIVERGENCE_AUDIT.md`, `docs/TOKEN_M_DESKTOP_OVERLAY_MANIFEST.md`, `docs/UPSTREAM_FEATURE_DELTA.md`, `docs/UPSTREAM_FEATURE_PARITY_MATRIX.md`, `docs/TOKEN_M_ALLOWED_UPSTREAM_DELTA.md`, `docs/TOKEN_M_DESKTOP_UPSTREAM_SYNC_REPORT.md`, `docs/TOKEN_M_DESKTOP_RUNTIME_FIX_REPORT.md` | Token M-only sync/runtime evidence | Provenance, runtime forensic, and promotion control | Records the fetched head, overlay boundary, parity, usage/limits evidence, validation, and allowlist | Upstream cannot describe this fork-specific synchronization or Token M integration boundary | Cross-checked against Git status, logs, source tests, and official build |

## Reconciliation additions (2026-09-17)

The following paths were absent from the accepted candidate but were found to
be necessary Token M baseline evidence or frozen legacy source. They were copied
from the formal worktree only after path-level classification. None changes the
Desktop runtime or enables the legacy WeChat function.

| Path | Token M reason | Runtime relevance | Source / test relevance | Action and boundary |
| --- | --- | --- | --- | --- |
| `tests/electron/tokenMIndependentProduct.test.js` | Independent product identity and package privacy contract | None | Unique assertions for Token M owner, app identity, legacy user-data compatibility, Android bridge presence, and release exclusions | Adapted to the upstream-owned updater and added to the candidate test source |
| `tests/shared/codexUsageRegression.test.js` | Windows profile-home compatibility regression | Indirectly protects the verified HOME boundary | Unique Codex fixture scan, idempotence, explicit `CODEX_HOME`, and host-calendar assertions | Added unchanged from the accepted formal regression source; targeted test passes |
| `tests/fixtures/codex-home/.codex/archived_sessions/rollout-2026-08-16T00-00-00-00000000-0000-4000-8000-000000000002.jsonl`, `tests/fixtures/codex-home/.codex/archived_sessions/rollout-2026-08-17T00-00-00000000-0000-4000-8000-000000000001.jsonl`, `tests/fixtures/codex-home/.codex/sessions/2026/08/17/rollout-2026-08-17T00-00-00000000-0000-4000-8000-000000000001.jsonl` | Fixture data for the HOME compatibility test | Test-only | Supplies two deduplicated Codex sessions and the archived copy | Added as non-production fixtures; no credentials or production data |
| `docs/LEGACY_WECHAT_INVENTORY.md`, `docs/LEGACY_WECHAT_REMAINING_REFERENCES.md`, `docs/TOKEN_M_DESKTOP_INDEPENDENT_PRODUCT_AUDIT.md`, `docs/TOKEN_M_DESKTOP_INDEPENDENT_PRODUCT_MIGRATION_REPORT.md`, `docs/TOKEN_M_DESKTOP_UPSTREAM_INTEGRATION_AUDIT.md`, `docs/TOKEN_M_DESKTOP_WECHAT_LEGACY_REMOVAL_REPORT.md`, `docs/TOKEN_M_INDEPENDENT_RELEASE_GUIDE.md`, `docs/TOKEN_M_UPSTREAM_DELTA_MAP.md`, `docs/TOKEN_M_UPSTREAM_UPDATE_GUIDE.md` | Historical Token M product, updater, upstream, and frozen-WeChat maintenance evidence | None | Preserves decisions and audit provenance that are not replaced by the new upstream-sync report | Added as archive/support documentation; not loaded by Desktop runtime |
| `wechat-miniapp/cloudfunctions/tokenm-maintenance/config.json`, `deployment-spec.json`, `index.js`, `lib/operator.js`, `lib/runtime-identity.js`, `package.json`, `README.md`, `scripts/build.js`, `test/maintenance.test.js` | Frozen WeChat control-plane source preservation | Not enabled and not deployed | Real source, packaging instructions, and 25 maintenance unit tests for the five allowlisted historical records | Added as a frozen source gap; deployment, invocation, and backend changes remain out of scope |

## Reconciliation exclusions

The following formal-worktree paths were audited but are not candidate source:

- `apps/tokenm-android/unpackage/**` (699 generated Android files),
  `wechat-miniapp/cloudfunctions/tokenm-api/node_modules/**` (5,814 dependency
  files), and the 37 files under `wechat-miniapp/.recovery-build-*/` are build,
  dependency, or recovery output.
- `wechat-miniapp/project.private.config.json` and
  `apps/tokenm-android/.hbuilderx/launch.json` are machine-local IDE/config
  state. They must remain on the user's machine when present, but must not be
  staged, packaged, or treated as source parity.
- `tests/helpers/tokenmRendererAcceptance.cjs` has no test or script caller and
  its selectors target the superseded renderer; it remains in the formal local
  tree as historical QA material and is not copied.
- Old Kilo/New API icon assets, forensic bundles, independent build logs, old
  provider/collector/worker copies, and deleted WeChat Desktop runtime files
  remain classified as generated or stale/superseded material. They are not
  restored into the candidate and are not deleted from the formal tree.

## Explicitly Not Allowed

No current Token M collector/provider/limits/session/Hub/Worker implementation was
copied into the candidate. The only usage-side change is the minimal Tokscale
child-environment compatibility boundary listed above; no collector algorithm,
provider, limits, session, Hub, Worker, or Tokscale source was replaced. No old
renderer drag implementation, active WeChat Desktop runtime, historical updater
owner, or obsolete workaround is present in the candidate baseline. The separate
tracked legacy source/docs are preserved only as a frozen, non-Desktop-parity
addition.

## Diff Result

- Candidate tracked modifications: 37 files (36 runtime/build/test overlay files
  plus the protected user `AGENTS.md`).
- Candidate Token M additions: the grouped files above, including the frozen
  Android and tracked WeChat/CloudBase trees.
- `UNEXPLAINED_DIFFS: 0` after applying this allowlist.
- Ignored local build/test logs are validation artifacts only and are not part of
  the promotion payload.
