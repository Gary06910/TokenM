# Upstream Feature Delta

Source: `git log upstream/main` after `git fetch upstream main`, with the
candidate rooted at `bce50dbdb67408dabd1a13758fd5009e36c88753`.
The local fork has no merge-base with upstream, so an exact ancestry range from
the fork is unavailable. The candidate therefore takes the complete upstream
tree and records the release-to-head commit range plus the older semantic delta
visible in the current fork comparison.

## Release Position

- Latest release tag included: `v0.58.0` (`d426b8ec59dfb2a0f3c7cfc375cb923ab6ec3691`)
- `v0.57.0` to `v0.58.0`: 11 commits
- Post-release commits included: yes (5 commits)
- Candidate package version: `0.58.0`

## Commit Delta

| Commit | Upstream change carried into candidate |
| --- | --- |
| `bce50dbd` | Stop ZCode's SQLite WAL-index sidecar from re-triggering its own collector scan while preserving database/WAL events. |
| `76afecb4` | Query Antigravity OAuth quota from the CLI-aligned daily endpoint first, with the production endpoint as a compatibility fallback. |
| `492fd047` | Build release artifacts on `macos-26` and `macos-26-intel` runners. |
| `d8d60a4e` | Show Kimi Code monthly quota from named Code API usage pools, including Kimi/Code breakdown. |
| `babac2c1` | Expose the native `Command+Q` accelerator on the macOS Quit tray item. |
| `d426b8ec` | Release `v0.58.0`. |
| `ea6ddf03` | Ship the native macOS Widget in release artifacts. |
| `1cdbed0f` | Track Amp token usage and reconcile blank XDG environment boundaries. |
| `57375044` | Prevent large session archives from freezing the app. |
| `44cb60e2` | Align the Tokscale fork with 4.17.0 and support WorkBuddy 5.5. |
| `f58ba5d8` | Read T3 Code session titles from the T3 store. |
| `a5b73cf3` | Add reversible local model aliases. |
| `67756fd0` | Align provider ordering with the supported-tools documentation. |
| `4567e13c` | Add Factory Droid plan limits. |
| `97fa8910` | Redesign native macOS widgets. |
| `a24a24e0` | Unify Main Screen drag handling and remove the old renderer drag path. |

The complete tree also includes the earlier audited upstream features that remain
absent or older in the fork: live token rate, per-tool scan paths, scan-backed
session timestamps/project attribution, persisted session titles, Codex background
review grouping and scheduled resets, Droid/Factory usage, Volcengine Agent Plan,
Hub bandwidth optimization, Windows DSH transcript promotion, quota/reset fixes,
and current provider/limits/session/project/Worker behavior. This is a baseline
checkout, not a hand-picked cherry-pick list.

## Dependency Delta

The candidate adopts the fetched upstream `package.json` and `package-lock.json`
first. The relevant effective versions are:

- Node engine: `>=22.15.0`
- Electron: `43.4.0`
- electron-builder: `26.15.3`
- electron-updater: `6.8.9`
- Tokscale: `^4.17.0`
- koffi: `^3.1.5`
- ESLint: `^10.8.0`

No Token M dependency was used to downgrade an upstream package. The upstream
Tokscale manifest remains `mode: override` and points at its own
`Javis603/tokscale` release asset; this is upstream provenance carried intact,
not a new Token M fork change. The Desktop notification overlay adds no npm
dependency.

## Refactor and Drift Policy

Collector, provider, limits, sessions, projects, Hub/Worker, renderer drag, and
Tokscale changes are taken from upstream's current module boundaries. Historical
Token M copies are not reapplied over those files. Only the overlay files listed
in `TOKEN_M_DESKTOP_OVERLAY_MANIFEST.md` remain outside the upstream baseline.
