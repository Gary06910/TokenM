# TOKEN_M_DESKTOP_INDEPENDENT_PRODUCT_AUDIT

Audit date: 2026-09-12. Recorded before implementation. Scope: Desktop only. Existing dirty worktree retained, including pre-existing AGENTS.md changes and WeChat removals. No production data contents read.

## CURRENT_PRODUCT_IDENTITY
CURRENT_APP_ID: com.javis.tokenmonitor
CURRENT_PRODUCT_NAME: Token M (PASS)
CURRENT_EXECUTABLE: Token M.exe (builder productName default)
VERSION_SOURCE: package.json, 0.45.0; Node >=22.13.0 (local 24.15.0).
Package name token-monitor retained as identity-sensitive. appId/Windows AUMID retained: changing it may change NSIS identity and cause side-by-side installation. No appId migration this round. Window/tray already use Token M. Installer artifact filenames still Token-Monitor; retain for this migration pending separate release naming decision.

## CURRENT_UPDATE_RUNTIME
CURRENT_PROVIDER: GitHub
CURRENT_OWNER: Javis603
CURRENT_REPO: token-monitor
AUTO_UPDATE_ENABLED: preference default NO, existing saved preference can enable download.
BACKGROUND_CHECK: YES (startup and hourly)
MANUAL_CHECK: YES
DOWNLOAD: YES
INSTALL: YES
ORIGINAL_AUTHOR_COUPLING: shared/appUpdater.js web release source; main.js packaged electron-updater, renderer repository/website URLs and external URL allowlist; package build.publish; original release workflow.

## ORIGINAL_AUTHOR_UPDATE_COUPLING
UPDATE_RUNTIME_REFERENCE: updater source, packaged feed, external release links must be replaced. Cached upstream lastKnownLatest must not appear as a Token M release.
LEGAL_ATTRIBUTION_REFERENCE: LICENSE and icon THIRD_PARTY_NOTICES must remain.
HISTORICAL_REFERENCE: audit docs, upstream guide, original SignPath config retained. No ancestry bridge or upstream remote addition.

## USER_DATA_MAP
CURRENT_USER_DATA_PATH: C:\Users\Gary\AppData\Roaming\Token Monitor
Main pins app.getPath('appData')/Token Monitor before app.setName. Directory and credential/settings/outbox filenames verified read-only; no secret contents printed.

| DATA | PATH relative to userData unless absolute | SENSITIVE | INSIDE_SOURCE_TREE | INSIDE_INSTALL_TREE | SURVIVES_APPLICATION_UPDATE | SURVIVES_PRODUCT_RENAME | MIGRATION_REQUIRED |
| --- | --- | --- | --- | --- | --- | --- | --- |
| credential / pairing secret | credentials.json | YES | NO | NO | YES with pin | YES with pin | NO |
| settings | settings.json | YES | NO | NO | YES with pin | YES with pin | NO |
| Android outbox | token-m-android-outbox-<desktopId>.json | YES | NO | NO | YES with pin | YES with pin | NO |
| notification preference / privacy mode | settings.json | NO | NO | NO | YES with pin | YES with pin | NO |
| Desktop identity / pairing metadata | settings.json + credentials.json | YES | NO | NO | YES with pin | YES with pin | NO |
| bridge port/token | token-m-notification-runtime.json | YES | NO | NO | regenerated on start | YES with pin | NO |
| Codex hook registration | CODEX_HOME/hooks.json or C:\Users\Gary\.codex\hooks.json | YES | NO | NO | DEPENDS on target path | DEPENDS | NO for fixed path |

## CREDENTIAL_SURVIVAL
CredentialStore remains unchanged. Keep private plaintext store and existing namespace. No user AppData writes or production credential access. Add explicit package exclusions for runtime files and include LICENSE. Settings updater cache needs source ownership invalidation only, preserving unrelated fields.

## HOOK_SURVIVAL
HOOK_REGISTRATION_STORAGE: CODEX_HOME/hooks.json (default ~/.codex/hooks.json)
HOOK_TARGET_PATH: process.execPath + __dirname/codexHookForwarder.js + userData/token-m-notification-runtime.json; Windows uses encoded PowerShell command.
ABSOLUTE_PATH: YES
WILL_INSTALLER_UPDATE_PRESERVE_PATH: DEPENDS (same install directory/executable/helper)
WILL_VERSIONED_INSTALL_PATH_BREAK_HOOK: YES
RE_REGISTRATION_REQUIRED_AFTER_UPDATE: CONDITIONAL
readCodexHookState compares current command on startup and status. Existing explicit enable action writes with backup; no automatic config mutation. No helper relocation. Source-to-installer / changed-directory registration remains a user action; fixed-directory NSIS upgrade is the supported design. Real installed-upgrade acceptance not yet performed.

## LICENSE_ATTRIBUTION
ORIGINAL_LICENSE: MIT, Copyright (c) 2026 Javis
DERIVATIVE_DISTRIBUTION_ALLOWED: YES, subject to retaining notice
ATTRIBUTION_REQUIRED: original copyright and complete MIT permission notice in copies/substantial portions
LICENSE_FILE_MUST_REMAIN: YES
NOTICE_REQUIRED: NO separate NOTICE required by this MIT text; existing third-party notices retained
SOURCE_DISCLOSURE_REQUIRED: NO under original MIT license
OTHER_OBLIGATIONS: retain disclaimer; dependency/assets licenses remain applicable, no claim to original signing identity.
Primary reference: https://opensource.org/license/mit; matches local LICENSE. LICENSE itself will not be edited.

## RELEASE_PIPELINE
.github/workflows/release.yml: ORIGINAL_AUTHOR_RELEASE_PIPELINE (tag-triggered multi-platform build, original SignPath, release upload).
.github/signpath/*.xml and scripts/signpath-windows-artifacts.js: historical original signing helpers; not suitable for Token M active release path.
ci.yml / codeql.yml: SHARED verification. pages.yml / star-history.yml: separate website/statistics workflows, not Desktop release feed.
Package build.publish: original provider, must replace with Gary06910/TokenM.
Live read-only gh evidence: Gary06910/TokenM PUBLIC; release list empty. No current installer/feed/assets available. Public manual source suitable after own stable release, native updater readiness unproven.

## SIGNING
Original organization 8bf2856b-5fb0-4c78-ba99-90931fcce837, project token-monitor, policy release-signing: NOT_OWNED / NOT_SUITABLE_FOR_TOKEN_M_RELEASE.
TOKEN_M_WINDOWS_CODE_SIGNING: NOT_CONFIGURED. Remove original publisher assertion; unsigned manual artifacts may affect SmartScreen/publisher trust. No identity impersonation.

## MANUAL_UPDATE_PLAN
Reuse semver, release-note parser and existing UI. Only https://api.github.com/repos/Gary06910/TokenM/releases/latest; reject redirects, no upstream fallback. Browser links only to own release pages. Manual only; no background checks, download/install runtime or automatic preference effect. No release means unable to check, not falsely latest. Invalidate old provider cache by source marker. No alternate provider.

## AUTO_UPDATE_READINESS
NOT_READY: no own release artifacts/feed acceptance, no own signing, installer upgrade and Hook fixed-path acceptance pending. Manual migration can complete independently.

## SELECTED_CHANGES
Replace updater integration with manual checking; preserve UI state contract where useful. Replace product links/metadata and build.publish; retain appId/name/version/userData. Disable old release workflow with archived body retained; establish build-only manually dispatched Windows workflow without release permissions. Preserve licensing in package. Supersede old guide, add independent release guide and contract/renderer validation. No module moves. No backend/Android/cloud/ADB/commit/push/tag/release actions.

## Post-audit implementation evidence
Read-only actual Hook registration: C:\Users\Gary\.codex\hooks.json contains command and commandWindows targeting D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery\node_modules\electron\dist\electron.exe and D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery\src\electron\codexHookForwarder.js; both exist. Runtime metadata was absent (transient, regenerated at runtime). No config edits performed. Current executable evidence therefore describes source-mode Electron; packaged executable is Token M.exe.
The old release workflow body was retained in docs/TOKEN_M_ORIGINAL_RELEASE_WORKFLOW.yml.reference. Active workflow is now manual Windows build only. Historical tests that assert its old platform/signing behavior now explicitly read that archived reference; new contract tests enforce active workflow has no original signing or publishing action.
