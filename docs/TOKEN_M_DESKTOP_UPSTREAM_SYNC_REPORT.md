# TOKEN_M_DESKTOP_UPSTREAM_SYNC_REPORT

## STATUS

`TOKEN_M_DESKTOP_UPSTREAM_SYNC_IMPLEMENTED_VALIDATION_PASS`

The source candidate is implemented from the fetched upstream baseline and all
source-level tests/verification pass. The official Windows directory script now
completes with the pinned Tokscale 4.17.0 binary and produces the expected
`Token M.exe` directory artifact. The remaining GUI acceptance limitation is
recorded in `TOKEN_M_DESKTOP_RUNTIME_FIX_REPORT.md`; it does not change the
upstream source or packaging result.

## Provenance

- **UPSTREAM_REPOSITORY:** `https://github.com/Javis603/token-monitor`
- **UPSTREAM_HEAD:** `bce50dbdb67408dabd1a13758fd5009e36c88753`
- **UPSTREAM_VERSION:** `0.58.0`
- **LATEST_RELEASE:** `v0.58.0` (`d426b8ec59dfb2a0f3c7cfc375cb923ab6ec3691`)
- **POST_RELEASE_COMMITS_INCLUDED:** `YES`
- **POST_RELEASE_COMMITS:** `5` — `bce50dbd` (ZCode WAL-index self-watch guard), `76afecb4` (Antigravity OAuth quota endpoint alignment), `492fd047` (macOS 26 release runners), `d8d60a4e` (Kimi Code monthly quota pools), `babac2c1` (macOS Quit `Cmd+Q` shortcut)
- **CURRENT_LOCAL_SOURCE:** `D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery`
- **LOCAL_BASE:** `32ddd91459aa27de7076c0f5227c4001a81dca29`
- **MERGE_BASE:** `NONE` (`git merge-base` returned no commit)
- **SYNC_STRATEGY:** `UPSTREAM_FIRST_TOKEN_M_OVERLAY`
- **ORIGINAL_WORKTREE_MODIFIED:** `NO`
- **CANDIDATE_WORKTREE:** `D:\Program Files (x86)\TokenM\token-monitor-upstream-sync-bce50dbd-final`

The original worktree's pre-existing modifications, deletions, and untracked
Android/uniCloud files were not reset, cleaned, stashed, committed, or copied
over the upstream Desktop baseline.

## UPSTREAM_DELTA_SUMMARY

The candidate includes the complete `v0.58.0` tree and every fetched post-release
commit: ZCode WAL-index watcher-loop suppression, Antigravity daily quota endpoint
alignment, macOS 26 release runners, Kimi Code monthly quota pools, and the macOS
Quit `Cmd+Q` shortcut. It also retains the earlier Amp usage, large-session archive
protection, reversible model aliases, T3 Code titles, Tokscale 4.17/WorkBuddy 5.5,
native macOS widgets, live token rate, custom scan paths, session/project metadata,
Codex background-review grouping and scheduled resets, Droid/Factory usage,
Volcengine limits, Hub transfer optimization, Windows DSH fixes, and Main Screen
drag refactor. The detailed commit and feature list is in `UPSTREAM_FEATURE_DELTA.md`.

Upstream package and lockfile versions were adopted first. No old Token M
dependency was used to downgrade them.

## TOKEN_M_OVERLAY_MANIFEST

- **BRANDING:** `Token M` product name, visible renderer copy, tray/Discord/autostart/about/diagnostic/OAuth copy, Token M repository links, and branded signing metadata.
- **ANDROID_NOTIFICATION:** strict `tokenm-desktop-http` client, completion payload, local-first durable outbox, status/retry/revoke handling, and namespaced IPC.
- **PAIRING:** six-digit pairing, desktop name, credential-bound identity, unpair and invalid-credential state.
- **STOP_HOOK:** loopback authenticated Codex Stop Hook bridge, forwarder, install/migrate/remove lifecycle, and trust-state UI.
- **OUTBOX:** atomic private JSON queue, duplicate event identity, bounded retry, suspension, restart recovery.
- **CREDENTIAL:** private `tokenM.androidCredential` mapping, renderer redaction, legacy user-data path compatibility.
- **PRIVACY_MODE:** privacy projection strips task content; full mode preserves the allowed fields.
- **UPDATE_OWNERSHIP:** upstream updater algorithm with `Gary06910/TokenM` feed/publish owner, Token M release template, and repository-checked changelog links.
- **TOKEN_M_ONLY_DIRECTORIES:** `apps/tokenm-android/**`, `docs/android/**`, Android tests, plus the 130 tracked `wechat-miniapp/**` files and 14 tracked `docs/wechat-miniapp/**` files preserved as frozen legacy source.

Full file/function/IPC/test detail is in `TOKEN_M_DESKTOP_OVERLAY_MANIFEST.md`.

## STALE_FORK_DRIFT_DROPPED

- Historical WeChat Desktop client/runtime/outbox/payload copies and their old
  tests were not reintroduced.
- Historical updater ownership and release-template links to the official
  upstream repository were not retained in the active candidate workflow.
- Old renderer drag/module copies and unrelated fork experiments were not copied
  over upstream's current refactors.
- Android and uniCloud legacy trees were preserved as frozen Token M source, not
  treated as Desktop parity drift.

## CONFLICTS_RESOLVED

- **Main/preload:** upstream entry points retained; notification lifecycle added
  through namespaced IPC and starts after the upstream collector.
- **Renderer:** upstream renderer retained; branding and a small notification
  settings island added without replacing the upstream state machine.
- **Credential store:** one Token M mapping added; all upstream provider mappings
  retained.
- **Updater:** upstream algorithm retained; feed owner and release workflow
  changed to Token M.
- **Packaging:** branded executable/signing lookup fixed while upstream-compatible
  artifact filenames remain unchanged.
- **Tests:** upstream expectations updated only where product metadata changed;
  contract tests were added rather than deleting failures.

## CONTRACT_CONFLICTS

`NONE`.

The event identity, credential format, pairing endpoints, privacy semantics,
outbox durability, notification target selection, and local-first behavior were
adapted as an independent boundary. No upstream refactor forced a change to the
external Android contract.

## PACKAGE

- **UPSTREAM_DEPENDENCIES_ADOPTED:** `package.json` and `package-lock.json` from
  upstream; effective key versions include Electron `43.4.0`, electron-builder
  `26.15.3`, electron-updater `6.8.9`, Tokscale `^4.17.0`, koffi `^3.1.5`, and
  ESLint `^10.8.0`.
- **TOKSCALE:** upstream `scripts/vendor/tokscale.json` retained exactly, including
  its `mode: override` and Javis603 Tokscale release provenance. No Token M
  Tokscale downgrade or new hash was created.
- **TOKSCALE_PIN:** `Javis603/tokscale` release tag `token-monitor-09cf5471`,
  source commit `09cf5471e48064c04be5f81e2b766538caf55e04` for the `win32-x64`
  asset; the official directory build re-used this verified pin successfully.
- **NODE_ENGINE:** `>=22.15.0`; environment `v24.15.0` / npm `11.12.1` satisfies it.

## UPDATER_AUDIT

- **AUTO_UPDATE_OWNER:** `Gary06910/TokenM` (`https://github.com/Gary06910/TokenM/releases/latest`).
- **PUBLISH_OWNER:** `Gary06910/TokenM` in electron-builder configuration.
- **TOKEN_M_CANNOT_BE_OVERWRITTEN_BY_OFFICIAL_UPSTREAM:** `PASS` at source/config
  level. The runtime feed, package publish target, release workflow template, and
  changelog ownership all point to Token M. The stable appId and legacy user-data
  directory are intentionally retained for installation/data continuity, not as
  an updater source.
- **ARTIFACT_NAMES:** upstream-compatible `Token-Monitor-*` filenames remain for
  feed compatibility; the executable/product/signing metadata is `Token M`.
- **SIGNPATH:** external project slug `token-monitor` is retained as the existing
  signing service identifier; the artifact configurations and product names are
  Token M.
- **PACKAGED UPDATE CONFIG:** source/config audit passes. The diagnostic
  `--publish never` directory package did not emit `resources/app-update.yml`,
  so no packaged feed file is claimed as runtime evidence; the updater owner is
  verified from `src/shared/appUpdater.js`, `package.json`, and the release workflow.

## UPSTREAM_FEATURE_PARITY_MATRIX

See `UPSTREAM_FEATURE_PARITY_MATRIX.md`. All upstream feature rows are `MATCH`;
only the explicit Token M rows are `TOKEN_M_OVERLAY` or `NOT_APPLICABLE`.

## ALLOWED_UPSTREAM_DELTA

See `TOKEN_M_ALLOWED_UPSTREAM_DELTA.md`.

- **UNEXPLAINED_DIFFS:** `0`

## TOKEN_M_NOTIFICATION_REGRESSION

These are controlled local test-double results; no production endpoint was used.

| Check | Result |
| --- | --- |
| STOP_HOOK | PASS |
| PAIRING | PASS |
| CREDENTIAL_STORAGE | PASS |
| OUTBOX | PASS |
| PRIVACY_MODE | PASS |
| FULL_MODE | PASS |
| EVENT_CONTRACT | PASS |
| ANDROID_CLIENT | PASS |
| LOCAL_FIRST_BEHAVIOR | PASS |

`upstreamSyncRegression.test.js` covers unbound no-network behavior, paired
upload, duplicate identity, privacy/full projection, cloud outage isolation, and
core runtime continuity. These tests do not claim a new handset or production
push acceptance run.

## UPSTREAM_TESTS

- **npm test:** PASS — 4671 tests, 4666 pass, 0 fail, 5 explicit
  platform/environment-conditioned skips on Windows.
- **lint:** PASS — `npm run lint` exit 0.
- **verify:** PASS — `npm run verify` exit 0 with the same 4671/4666/0/5 totals.
- **git diff --check:** PASS.

## TOKEN_M_TESTS

PASS: the explicit 11-file Desktop overlay suite is 36/36; the 17-file Android
suite is 142/142. Coverage includes Android client/payload/outbox/runtime, Stop
Hook bridge/forwarder, pairing target, credential/settings, updater ownership,
renderer branding, release-note ownership, and upstream-sync regression suites.
The latest upstream macOS Quit test was adapted only for the intentional `Token M`
label while preserving its `Command+Q` behavior assertion.

## WINDOWS_BUILD

- **Official command:** `npm run dist:win:dir` — PASS; the pinned Tokscale
  4.17.0 asset was already verified and `electron-builder --win dir --x64
  --publish never` exited 0.
- **Artifact:** produced `dist\win-unpacked\Token M.exe` with the vendored
  Tokscale override.
- **Package-content audit:** PASS — contains `LICENSE`, the Token M notification
  runtime/renderer modules, and the upstream Desktop; excludes `apps/tokenm-android`
  plus runtime credential/settings/outbox metadata.
- **No global Node/environment change:** YES.

## LOCAL_RUNTIME_VALIDATION

An isolated-profile launch used a temporary extracted app payload with empty
clients, limits, history, WSL, Android endpoint, and isolated `APPDATA`/
`CODEX_HOME`; the test process created a `Token M` window without touching the
production profile. The current Computer Use connector returned no app binding
(`getApp`/`listApps` are unavailable and inventory reported no apps), so the
window's accessibility tree and live Settings labels could not be observed.
Main-window process creation is therefore recorded, but renderer and live
settings UI acceptance remains `UNMEASURED_ON_DEVICE`.

## FROZEN_BOUNDARIES

- **ANDROID_SOURCE_CHANGED:** `NO` (copied/preserved only)
- **ANDROID_BACKEND_CHANGED:** `NO`
- **FROZEN_BYTE_COMPARE:** `PASS` — `apps/tokenm-android` 1048/1048,
  `docs/android` 28/28, `tests/android` 17/17, tracked `wechat-miniapp`
  130/130, and tracked `docs/wechat-miniapp` 14/14; missing/different/extra = 0.
- **PRODUCTION_BACKEND_DEPLOYED:** `NO`
- **REAL_PUSH_SENT:** `NO`
- **AGENTS_MD:** `UNTOUCHED`; the candidate preserves the user's local file
  byte-for-byte. Upstream also has an `AGENTS.md`, so this documented guidance
  delta is intentional and does not change product runtime code.
- **WECHAT_CLOUDBASE:** `UNTOUCHED` and not re-enabled
- **COMMIT:** `NO`
- **PUSH:** `NO`
- **TAG:** `NO`
- **CUSTOM_SHA256:** `NONE`
- **OTHER_HASH_USAGE:** `NONE` (no new file/artifact/payload checksum was generated;
  upstream's own vendored asset manifest remains unchanged)

## RECOMMENDED_TOKEN_M_VERSION

`0.58.0` for this candidate. No formal Token M release version was changed beyond
the upstream package version; promotion should make an explicit product-release
decision later.

## PROMOTION_READY

`NO` — source, usage forensic, and official build gates pass, but the required
GUI acceptance is still not observable through the current Computer Use
connector. This is an evidence gate, not a source-parity or notification
contract failure.

## PROMOTION_PLAN

1. In a network-enabled Windows build environment, run
   `npm run dist:win:dir` and the upstream Tokscale verification gates.
2. Start the candidate with a controlled non-production profile and verify the
   main window, tray, renderer usage view, settings, pairing controls, and
   notification status UI.
3. Re-run the full upstream and Token M suites, inspect the final allowlist, and
   only then request explicit promotion into the untouched local source tree.

## FINAL_CONCLUSION

1. The candidate is based on the latest fetched `upstream/main` at `bce50dbd`,
   including all 5 post-`v0.58.0` commits; no merge-base was available, so no naïve
   merge was attempted.
2. Remaining differences are limited to the documented Token M branding,
   Android notification/Stop Hook/pairing/outbox/credential/privacy overlay,
   update ownership, and frozen Android/uniCloud/WeChat legacy source.
3. There is no unexplained candidate diff after the allowlist (`0`).
4. The audited upstream feature delta is present in the candidate baseline.
5. The Android notification contract is preserved by focused local contract and
   test-double regression coverage; no new real Push was sent.
6. The updater feed is Token M-owned and cannot select the official upstream feed
   at source/config level.
7. The official Windows `dist:win:dir` validation passed with pinned Tokscale
   4.17.0.
8. The candidate is implemented but not promotion-ready until the isolated GUI
   acceptance is observable and completed.
