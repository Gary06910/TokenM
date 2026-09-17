# Token M Desktop Overlay Manifest

This manifest records the deliberate differences from the fetched upstream
Desktop. Upstream owns the collector, providers, limits, sessions, projects,
Tokscale integration, Hub/Worker, generic renderer, generic settings, platform
fixes, dependencies, tests, and updater algorithms.

## Branding

- **Files:** `package.json`; `src/electron/renderer/{app.js,i18n.js,index.html,styles.css,trayComposer.js,tokenMNotificationSettings.js}`; `src/electron/{tray.js,linuxAutostart.js,discordRpc.js}`; `src/electron/providers/antigravity/oauthLogin.js`; `src/shared/diagnosticReport.js`; SignPath XML files.
- **Functions / behavior:** product name and visible copy are `Token M`; repository/help/about links use `Gary06910/TokenM`; tray, Discord, autostart, diagnostic, OAuth, and packaged executable labels follow the product name.
- **Dependencies:** none beyond upstream dependencies.
- **IPC:** none for branding.
- **Settings:** no new generic settings.
- **Tests:** `aboutSettings.test.js`, `i18n.test.js`, `tray.test.js`, `linuxAutostart.test.js`, `antigravityOAuthLogin.test.js`, `macWidgetIntegration.test.js`, `releaseArtifactNames.test.js`.
- **Why required:** Token M is an independently branded product.
- **Upstream conflict:** upstream visible strings and metadata changed; only those strings/metadata are overlaid. Internal protocol names, compatibility paths, and upstream attribution remain unchanged.

## Android Notification Integration

- **Files:** `src/electron/androidClient.js`, `androidPayload.js`, `androidOutbox.js`, `androidNotificationRuntime.js`, `tokenMNotificationRuntime.js`.
- **Functions / behavior:** strict HTTPS/loopback API validation; six-digit pairing; credential-bound desktop identity; stable completion event identity; local-first durable queue; bounded retry and suspension; invalid-credential handling; notification delivery never throws through the usage collector.
- **Dependencies:** Node `fetch`/`Response`, `crypto`, filesystem atomic JSON helpers, and the existing Electron runtime. No new npm dependency.
- **IPC:** `notifications:getStatus`, `notifications:enableCodexHook`, `notifications:disableCodexHook`, `notifications:pairAndroid`, `notifications:setAndroidEnabled`, `notifications:setAndroidPrivacyMode`, `notifications:unpairAndroid`; exposed only through `window.tokenMNotifications`.
- **Settings:** `tokenMAndroidApiUrl`, `tokenMAndroidCredential`, `tokenMAndroidDesktopId`, `tokenMAndroidDesktopName`, `tokenMAndroidEnabled`, `tokenMAndroidPrivacyMode`, `tokenMCodexHookEnabled`.
- **Tests:** `androidClient.test.js`, `androidPayload.test.js`, `androidOutbox.test.js`, `androidNotificationRuntime.test.js`, `tokenMNotificationTarget.test.js`, `upstreamSyncRegression.test.js`.
- **Why required:** preserves the verified Desktop -> `tokenm-desktop-http` -> uniCloud -> Android Tasks -> uni-push chain.
- **Upstream conflict:** upstream has no Android destination; the overlay is isolated from collector/provider contracts.

## Pairing

- **Files:** `androidClient.js`, `androidNotificationRuntime.js`, `tokenMNotificationRuntime.js`, `main.js`, `preload.js`, `renderer/index.html`, `renderer/tokenMNotificationSettings.js`.
- **Functions / behavior:** user-entered API URL and exactly six digits produce a paired credential; desktop name is persisted and exposed to Android; unpair calls the server contract before clearing local state; revoked/invalid credentials become an explicit invalid state.
- **Dependencies:** existing `credentialStore` atomic persistence and Electron IPC.
- **IPC / settings:** the pairing methods and Android settings above; generic `settings:update` strips `tokenM*` keys so there is one lifecycle write path.
- **Tests:** `androidClient.test.js`, `androidSettings.test.js`, `androidNotificationRuntime.test.js`, `tokenMNotificationTarget.test.js`.
- **Why required:** preserves the current six-digit Desktop-to-Android pairing protocol.
- **Upstream conflict:** none; adapter is additive.

## Codex Stop Hook

- **Files:** `codexHookBridge.js`, `codexHookForwarder.js`, `codexStopHook.js`, `tokenMNotificationRuntime.js`.
- **Functions / behavior:** loopback-only authenticated bridge; Codex `Stop` hook installation/migration/removal; stable runtime metadata; packaged/source executable selection; trust-state reporting.
- **Dependencies:** Node HTTP, `crypto`, Codex `hooks.json`, and the existing Electron executable.
- **IPC / settings:** enable/disable methods and `tokenMCodexHookEnabled`.
- **Tests:** `codexHookBridge.test.js`, `codexHookForwarder.test.js`, `codexStopHook.test.js`, `tokenMNotificationTarget.test.js`.
- **Why required:** completion events originate from the currently verified Stop Hook path.
- **Upstream conflict:** upstream collector remains authoritative; the hook is an independent event adapter.

## Durable Outbox

- **Files:** `androidOutbox.js`, `androidNotificationRuntime.js`, `tokenMNotificationRuntime.js`.
- **Functions / behavior:** atomic private JSON persistence, duplicate event suppression, bounded exponential retry, credential/terminal suspension, restart recovery, and queue status.
- **Dependencies:** existing `readRegularFileNoFollow` and `writePrivateJsonAtomic`; no package changes.
- **IPC / settings:** status is read through `notifications:getStatus`; data is stored under the existing Token M user-data path.
- **Tests:** `androidOutbox.test.js`, `androidNotificationRuntime.test.js`, `upstreamSyncRegression.test.js`.
- **Why required:** cloud or push failure must not lose a completion event or break local usage tracking.
- **Upstream conflict:** none; queue is downstream of the upstream collector.

## Credential Storage

- **Files:** `src/shared/credentialStore.js`, `main.js`, Android client/runtime modules.
- **Functions / behavior:** private `tokenM.androidCredential` mapping, renderer redaction, revoke/invalid handling, and atomic settings migration; existing user-data directory remains `Token Monitor` for compatibility.
- **Dependencies:** upstream credential store implementation.
- **IPC / settings:** raw credential never crosses the generic renderer settings payload; pairing/unpair owns mutations.
- **Tests:** `androidSettings.test.js`, `androidClient.test.js`, `tokenMIntegrationContract.test.js`.
- **Why required:** protects the current Desktop credential contract and existing installations.
- **Upstream conflict:** credential store is shared; one mapping is added without replacing upstream provider mappings.

## Privacy / Full Upload Mode

- **Files:** `androidPayload.js`, `androidNotificationRuntime.js`, renderer settings island, `main.js`.
- **Functions / behavior:** privacy mode strips project/model/summary/duration/body fields; full mode sends the currently allowed fields; both preserve the same event ID and task identity.
- **Dependencies:** no new dependency.
- **IPC / settings:** `notifications:setAndroidPrivacyMode`, `tokenMAndroidPrivacyMode`.
- **Tests:** `androidPayload.test.js`, `androidNotificationRuntime.test.js`, `upstreamSyncRegression.test.js`.
- **Why required:** preserves the frozen privacy semantics while allowing an explicit full mode.
- **Upstream conflict:** upstream usage collection does not receive task-body upload fields; adapter owns projection only.

## Update Ownership

- **Files:** `src/shared/appUpdater.js`, `package.json`, `.github/workflows/release.yml`, `.github/TOKEN_M_RELEASE_TEMPLATE.md`, `scripts/prepare-github-release-notes.js`, SignPath XML, `scripts/verify-macos-widget-app.js`.
- **Functions / behavior:** upstream updater algorithm is retained, but the feed and publish target are `Gary06910/TokenM`; release notes and compare links are repository-checked; macOS verifier derives the branded executable name; signing metadata names `Token M`.
- **Dependencies:** upstream `electron-updater` `6.8.9` and `electron-builder` `26.15.3`.
- **IPC / settings:** existing upstream update IPC remains unchanged.
- **Tests:** `appUpdater.test.js`, `releaseArtifactNames.test.js`, `tests/scripts/prepareGithubReleaseNotes.test.js`, `upstreamSyncRegression.test.js`.
- **Why required:** a Token M build must never auto-install the official Javis603 binary.
- **Upstream conflict:** release ownership is intentionally different; artifact filenames remain upstream-compatible `Token-Monitor-*` names, while the owner/repo and feed are Token M.

## Token M-only Directories

- **Files:** `apps/tokenm-android` (349 source/vendor files; its separate 699-file `unpackage` tree is generated and excluded from promotion), `docs/android` (28 files), `tests/android` (17 files), `wechat-miniapp` (130 Git-tracked frozen files plus the separately preserved nine-file `tokenm-maintenance` source), and `docs/wechat-miniapp` (14 Git-tracked files).
- **Functions / behavior:** Android UI, pairing, tasks, privacy, background protection, uni-push, and backend contracts are preserved as source-of-truth additions.
- **Dependencies:** HBuilderX/uni-app/uniCloud dependencies already present in the source tree; not added to the Desktop npm package.
- **IPC / settings:** shared Desktop HTTP contract is consumed but not changed.
- **Tests:** Android tests are copied unchanged; Desktop contract tests cover the client boundary.
- **Why required:** these are explicitly out of upstream Desktop scope and contain the verified mobile notification consumer.
- **Upstream conflict:** upstream does not contain these directories; they are preserved, not merged into upstream logic. Ignored WeChat dependencies/recovery/generated files are deliberately excluded, and the legacy runtime remains frozen.

## Guidance Preservation

- **File:** `AGENTS.md`.
- **Behavior:** the user's current project guidance is preserved byte-for-byte even though upstream has a differing tracked `AGENTS.md`.
- **Why required:** the task explicitly protects the user-maintained file; it is not application runtime code.
- **Test / audit:** byte comparison against the original worktree and explicit allowlist classification.

## Overlay Boundary

The overlay starts after `startMode()` initializes the upstream collector. Notification
startup, pairing, upload, and hook failures are isolated and logged; they cannot
change upstream usage calculations, provider discovery, limits, sessions, projects,
Hub, Worker, or generic renderer state.
