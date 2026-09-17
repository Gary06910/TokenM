# TOKEN_M_DESKTOP_INDEPENDENT_PRODUCT_MIGRATION_REPORT

STATUS:
TOKEN_M_DESKTOP_INDEPENDENT_UPDATE_READY

Readiness is local source, mocked integration/renderer and Windows directory-package readiness. It is not a claim that an installer upgrade, public release download or real Android notification was executed.

PRODUCT: Token M
MAINTENANCE_MODEL: INDEPENDENT
UPSTREAM_RELEASE_DEPENDENCY: NONE
ORIGINAL_AUTHOR_UPDATE_RUNTIME: REMOVED
ORIGINAL_AUTHOR_UPDATE_UI: REMOVED
ORIGINAL_AUTHOR_BUILD_PUBLISH: REPLACED
ORIGINAL_AUTHOR_RELEASE_URL_RUNTIME: 0
ORIGINAL_AUTHOR_UPDATE_RUNTIME_CALLS: 0
ORIGINAL_AUTHOR_RELEASE_FEED_ACTIVE: NO

LICENSE: MIT, Copyright (c) 2026 Javis; LICENSE unchanged and packaged.
ATTRIBUTION: README names original source and current independent maintainer; LICENSE and existing third-party notices retained. MIT allows derivative distribution with retained notices and does not itself require source disclosure or a separate NOTICE. See local LICENSE and https://opensource.org/license/mit.

CURRENT_PRODUCT_NAME: Token M
CURRENT_APP_ID: com.javis.tokenmonitor
APP_ID_CHANGED: NO
CURRENT_EXECUTABLE: packaged Token M.exe; current registered source-mode executable is node_modules/electron/dist/electron.exe.
USER_DATA_PATH: C:\Users\Gary\AppData\Roaming\Token Monitor
USER_DATA_PATH_CHANGED: NO
CREDENTIAL_PATH: C:\Users\Gary\AppData\Roaming\Token Monitor\credentials.json
CREDENTIAL_SURVIVAL: PASS
SETTINGS_SURVIVAL: PASS
ANDROID_OUTBOX_SURVIVAL: PASS

These PASS values cover preserved path/namespace, existing private-store/outbox tests, mocked manual-check noninterference and absence from the package. Same-path upgrades preserve them by design. Actual installer upgrade was not run; a future change removing the pin or deleting userData would need separate validation. User AppData was not modified or copied. No production credential was printed or used.

CODEX_HOOK_PATH: D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery\src\electron\codexHookForwarder.js
CODEX_HOOK_UPDATE_SURVIVAL: PARTIAL
HOOK_REGISTRATION_STORAGE: C:\Users\Gary\.codex\hooks.json
HOOK_TARGET_PATH: D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery\node_modules\electron\dist\electron.exe plus forwarder above and pinned userData/token-m-notification-runtime.json.
ABSOLUTE_PATH: YES
WILL_INSTALLER_UPDATE_PRESERVE_PATH: DEPENDS (same directory/executable/helper)
WILL_VERSIONED_INSTALL_PATH_BREAK_HOOK: YES
RE_REGISTRATION_REQUIRED_AFTER_UPDATE: CONDITIONAL

Narrow read-only inspection confirmed real executable and helper exist. Transient runtime metadata was absent during audit; this does not prove an active bridge. Startup/status already compares the registered command with the current paths; no automatic Codex config edits were added. This source update preserves both paths. First source-to-installer transition, moving portable installs, or versioned install directories requires explicit Enable Codex Hook and Codex trust. Same-directory installed upgrade remains a user acceptance gate.

TOKEN_M_REPOSITORY: Gary06910/TokenM
TOKEN_M_UPDATE_AUTHORITY: Gary06910/TokenM GitHub Releases, sole provider
TOKEN_M_MANUAL_UPDATE: IMPLEMENTED
TOKEN_M_UPDATE_SOURCE: https://api.github.com/repos/Gary06910/TokenM/releases/latest
AUTO_UPDATE: OFF
AUTO_UPDATE_READINESS: NOT_READY
WINDOWS_SIGNING: NOT_CONFIGURED; final EXE Authenticode status NotSigned
BUILD_PUBLISH: github / Gary06910 / TokenM (build commands use --publish never)
VERSION_SOURCE: package.json, unchanged 0.45.0

Live gh read-only verification: PUBLIC repository, no Releases returned. Therefore manual check is implemented and mocked success/failure verified, but no own release is currently downloadable. 404 is a failed check, not a false latest-version result. No API credentials, redirects, original fallback, background polling, native download or install. Existing upstream update cache is ignored without Token M source ownership. Original SignPath organization/project/policy are NOT_OWNED and inactive. Auto-update blockers: owned signing, published artifact/feed acceptance, installer identity migration if desired, actual NSIS upgrade and installed Hook validation.

FILES_CHANGED (this round only; unrelated existing dirty changes retained):
- package.json: own metadata/publish/notes; preserve appId/name/version; retain legal text, exclude runtime/private files and native updater from package.
- src/shared/appUpdater.js: Token M endpoint, redirect rejection, stable-release checks, injectable transport for tests; existing semver and note parser reused.
- src/electron/main.js: manual-only integration, no native updater or background checks; source-scoped cache and own external links.
- src/electron/preload.js: remove native update download/install IPC surface.
- src/electron/renderer/app.js: own product links, manual release action, hide unavailable automatic control.
- src/electron/renderer/index.html and i18n.js: Token M update label, Chinese View update and independent product description.
- src/electron/discordRpc.js and serviceStatus.js: own product URLs.
- .github/workflows/release.yml: own manual Windows build-only workflow, no release permission or original signing.
- .github/TOKEN_M_RELEASE_TEMPLATE.md: own Chinese/English release-note seed.
- README.md: independent maintenance and legal ancestry.
- docs/TOKEN_M_DESKTOP_INDEPENDENT_PRODUCT_AUDIT.md: pre-implementation audit plus evidence addendum.
- docs/TOKEN_M_UPSTREAM_UPDATE_GUIDE.md: superseded banner only; original body preserved.
- docs/TOKEN_M_INDEPENDENT_RELEASE_GUIDE.md: active release architecture and acceptance procedure.
- docs/TOKEN_M_ORIGINAL_RELEASE_WORKFLOW.yml.reference: original workflow retained verbatim as inactive history.
- tests/electron/tokenMIndependentProduct.test.js: independent authority and packaging contract.
- tests/electron/appUpdateState.test.js: execute actual manual state logic in VM; cache, pairing/settings noninterference, failure containment, concurrent request joining and recovery.
- tests/electron/aboutSettings.test.js, quitPath.test.js, updateInstallQuit.test.js: update active product contracts; retain historical pure guard tests, remove obsolete main native-installer wiring assertions.
- tests/shared/appUpdater.test.js, releaseArtifactNames.test.js, signpathWindowsArtifacts.test.js: own endpoint/notes expectations; original workflow assertions explicitly test the historical reference, not the active product pipeline.
- tests/helpers/tokenmRendererAcceptance.cjs: add mocked failed/successful manual update, own release-page opening, pairing preservation and screenshots.
- this report.

TESTS:
Final npm run verify PASS: 3515 tests, 3510 pass, 0 fail, 5 skip; Node 24.15.0. Log: independent-verify-delivery.log. Includes existing Android client/runtime/outbox/privacy, Codex bridge/hook, private-store, integration and regression tests. New contract/VM checks pass. No production endpoint or credential was supplied.
Renderer acceptance PASS: actual renderer/preload, isolated profile, mock IPC, HTTP/HTTPS blocked. Covers Android pair/privacy/enable/unpair and failed check -> own newer release -> own release-page opening without modifying paired state. Log: independent-renderer-delivery.log. Screenshots: dist/independent-renderer-delivery-20260912/android-notification-settings.png and manual-update.png.
Intermediate results: initial suite exposed obsolete native-updater/workflow tests, updated to the new product contract. One run also hit two existing Hub tests with random local-port `bad port`; final unchanged Hub tests passed. First sandboxed Electron run failed to load renderer with GPU process errors; same isolated acceptance passed outside sandbox. No production-runtime inference from that retry.

BUILD:
PASS: npm run dist:win:dir -- --config.directories.output=dist/independent-product-delivery-20260912
Exit code 0; log independent-build-delivery.log.
Candidate: dist/independent-product-delivery-20260912/win-unpacked/Token M.exe
Artifact audit: dist/independent-product-delivery-20260912/artifact-audit.json
app.asar: Token M 0.45.0; LICENSE present; Android modules/helper present; WeChat files absent; native updater absent; original update URLs/calls absent; forbidden credential/settings/env/runtime/outbox files empty; legacy userData pin present. Authenticode: NotSigned. Installer was not built/executed in this round. No public release was created.

TOKEN_M_ANDROID_INTEGRATION: PRESERVED
WECHAT_RUNTIME: ABSENT
BACKEND_CHANGED: NO
ANDROID_CHANGED: NO
CLOUD_ACTIONS: NONE
UPSTREAM_GUIDE: SUPERSEDED
NEW_RELEASE_GUIDE: docs/TOKEN_M_INDEPENDENT_RELEASE_GUIDE.md
ADB_USED: NO
HASH_USAGE: NONE (no new business/file verification mechanism; inherited tests and builder-internal packaging mechanisms unchanged)
SHA256: NONE (none added)
SMOKE: NONE
AGENTS_MD: UNTOUCHED this round; its pre-existing dirty state preserved
COMMIT: NO
PUSH: NO
TAG: NO
RELEASE: NO

## FINAL_CONCLUSION

Original-author update channels are cut from the active Desktop and release pipeline. Token M owns maintenance, package version, build and sole update source. Manual update is usable with mocked release data and will serve actual downloads after the first own release is published; currently there is no release to download.

Credential/settings/outbox paths and private-store behavior remain intact, with no data migration. Hook survives unchanged source paths; first installed transition and any moved path require explicit re-registration. Own automatic updating remains NOT_READY without blocking this migration. Inherited host core is now maintained as Token M code; no module relocation was necessary. Non-update historical provider user-agent/referrer strings in shared limit integrations are not release fetches and were not mechanically erased.

Next real acceptance: launch the intended Token M Desktop, confirm existing Android pairing/privacy, register the Hook if transitioning to installed paths, complete one new Codex task, then confirm the Android task and Honor system notification. Do not synthesize a production event. This round did not execute that real notification chain.
