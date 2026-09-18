# TOKEN_M_INDEPENDENT_RELEASE_GUIDE

STATUS: ACTIVE
MAINTENANCE_MODEL: INDEPENDENT
SOURCE_REPO: Gary06910/TokenM

Token M Desktop is independently maintained. Original-author releases, ancestry bridges and merging upstream are not release prerequisites. Original source remains historical attribution under MIT. The Android integration and cloud API contract remain frozen for this migration.

## TOKEN_M_RELEASE_ARCHITECTURE
VERSION_SOURCE: package.json (currently 1.0.0); no second registry.
BUILD_COMMAND: npm run dist:win:dir -- --config.directories.output=dist/<new-candidate-directory>
WINDOWS_ARTIFACT: Token M.exe in win-unpacked; NSIS Token-Monitor-Setup-${version}.exe; portable Token-Monitor-${version}.exe. Existing artifact filenames retained; product display name is Token M.
SIGNING: TOKEN_M_SIGNPATH_PENDING; upstream SignPath is NOT_OWNED and disabled. Windows local candidates may show unknown publisher / SmartScreen warnings until Token M's own signing project is approved and configured.
RELEASE_SOURCE: https://github.com/Gary06910/TokenM/releases
UPDATE_SOURCE: https://api.github.com/repos/Gary06910/TokenM/releases/latest
USER_DATA_SURVIVAL: fixed appData/Token Monitor, outside install tree.
HOOK_SURVIVAL: fixed executable + helper path; startup validates current command without modifying Codex configuration.
ROLLBACK: reinstall retained prior Token M installer to same directory; preserve userData. Never roll back with original-author binaries.

## VERSIONING
Token M 1.0.0 is the first independently maintained release. Keep package.json and its existing lockfile root metadata aligned, use sensible semver for later releases, update the actual release notes for each version, and do not republish an existing version with different binaries.

## TEST / BUILD / PACKAGE
Use Node >=22.13.0 (validated locally with 24.15.0).

1. Review current working-tree changes and frozen Android/backend boundaries.
2. Run npm run verify (lint plus unit/integration/contract tests).
3. Run the isolated Electron renderer acceptance helper with a new absolute output directory. It mocks IPC, blocks HTTP/HTTPS and uses its own userData; never use production credentials in automation.
4. Run npm run dist:win:dir with a new output directory. Inspect app.asar, product metadata, update authority, Android helper inclusion, absence of WeChat runtime and private data.
5. For a local release candidate, use the project script `npm run dist:win -- --config.directories.output=dist/<new-installer-candidate>`; it uses electron-builder with `--publish never`. The tag-triggered Windows release workflow uses `npm run dist:win:dir`, writes the updater configuration, signs the unpacked application, runs `npm run dist:win:prepackaged`, signs the installer and portable artifacts, rebuilds updater metadata, then uploads the final artifacts.
6. Keep LICENSE and third-party notices in distribution. Never add actual .env, credentials, settings, runtime outbox or logs. Packaging explicitly excludes them, electron-updater and the unused native-install quit helper.

The active `.github/workflows/release.yml` is tag-triggered and Windows-only for the official 1.0.0 Desktop release: it creates the GitHub Release only after the Windows application, installer and portable executable have passed the configured SignPath and Authenticode gates. macOS/Linux source and build capabilities remain outside this release workflow. This local preparation does not dispatch the workflow, invoke SignPath, upload artifacts or create a release. No workflow was dispatched in this preparation.

## SIGNING
The local release candidate is unsigned and must be checked with `Get-AuthenticodeSignature`; builder configuration alone is not evidence of a signed result. The active GitHub workflow has an external SignPath gate, but this preparation makes no claim that the gate is available or that a local candidate is signed. Do not report the local artifact as publisher-verified.

## RELEASE
At audit time the repository was PUBLIC and had no Releases. Build architecture and manual checking are implemented; there is no downloadable Token M release yet.

Publishing requires a separate explicit request. Then review the exact version, source state, installer and notes before creating the release. Use a stable semver tag corresponding to package.json and publish the Windows installer and optional portable artifact. Retain a previous known-good Token M installer. No original-author binary or signing pipeline is part of this process.

Use .github/TOKEN_M_RELEASE_TEMPLATE.md as the current notes seed, replacing its content with the actual version changes. The older .github/RELEASE_TEMPLATE.md belongs to historical release tooling. For inline localized notes, use app-update-notes:zh/en markers with ### headings and list items, following the new template. Full notes are always accessible on the Token M release page.

## UPDATE
Settings -> General/About -> Check for updates. Checks run only on request, using one public GitHub API endpoint without credentials. Redirects are refused; no other provider/fallback. No release, malformed response or network failure produces a failed-check state. Stable versions only; latest version and localized release notes are shown when available. View update opens the Token M release page; download and installation remain user actions.

Native automatic update is OFF. Existing saved automatic-update preference cannot enable it. The old upstream version cache is ignored unless marked with the Token M source; a successful manual check records own metadata without replacing other settings. electron-updater remains installed for historical tests/tooling but is excluded from the product package and never imported by main.

AUTO_UPDATE_READINESS: NOT_READY. Remaining gates: own signing, own artifacts/feed acceptance, real same-directory NSIS upgrade, installer identity ownership migration if desired, and installed Hook survival. This is not a failure of independent/manual migration.

## USER_DATA / CREDENTIAL
Windows location: %APPDATA%\Token Monitor, explicitly pinned before app.setName('Token M'). Keep appId com.javis.tokenmonitor and package name token-monitor for this migration. Renaming appId requires a separate tested installer migration plan; userData does not derive from appId.

credentials.json, settings.json and token-m-android-outbox-<desktopId>.json stay outside source/install/build trees. No store redesign or namespace changes. Preference/identity metadata remains in settings; credential remains private. Bridge runtime metadata is transient and regenerated. Never delete userData during upgrade or run an uninstall option that removes it. A future appId/name change must preserve this pin or introduce a separately tested non-destructive migration.

Source/test evidence proves this migration preserves paths and persisted fixture behavior; an actual installed-version upgrade has not been executed. Keep a private local backup before a future installer upgrade; never put it in repository or build output.

## HOOK
Registration storage is CODEX_HOME/hooks.json or ~/.codex/hooks.json. The current real registration was read narrowly: it targets this repository's node_modules/electron/dist/electron.exe and src/electron/codexHookForwarder.js. Both exist. The transient runtime JSON was absent during audit; that file is created by an active bound runtime and is not persistent registration.

A source update in this same directory retains both paths. A fixed-directory installer upgrade with unchanged Token M.exe and resources/app.asar/src/electron/codexHookForwarder.js also retains command identity. Versioned directories, portable moves and source-to-installer transitions change it. Existing startup/status validation detects the mismatch and does not silently modify Codex files. Enable Codex Hook in the installed Token M app and confirm Codex trust when transitioning to a new path. No automatic re-registration or retry framework has been added.

## ROLLBACK
Close candidate, reinstall the prior Token M version in the same installation directory, preserve userData and check Hook status. If helper/executable path changed, explicitly register from the running intended app. Do not run both source and installed notification hosts during acceptance. No bulk deletion, reset, clean, stash, ancestry bridge or original-author update is needed.

## REAL_RUNTIME_ACCEPTANCE
User acceptance, after local checks:

1. Start the intended Token M Desktop build; verify existing Android pairing and privacy preference remain.
2. If moving from source to installed build, enable its Codex Hook and confirm trust.
3. Complete one new real Codex task.
4. Confirm a new Android task and Honor system notification.
5. Check update UI; until the first own release exists, failed check is expected.

No synthetic production event, real automated Push, Android rebuild, ADB, backend deployment or production configuration change belongs to the local verification steps.
