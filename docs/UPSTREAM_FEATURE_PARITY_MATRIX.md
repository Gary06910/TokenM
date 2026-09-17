# Upstream Feature Parity Matrix

Candidate base: `upstream/main` at `bce50dbdb67408dabd1a13758fd5009e36c88753`.
Statuses are limited to `MATCH`, `TOKEN_M_OVERLAY`, `NOT_APPLICABLE`, and
`BLOCKED`.

| Feature | Upstream | Candidate | Status | Notes |
| --- | --- | --- | --- | --- |
| Core collector and local usage | Current main | Same source tree | MATCH | Upstream test suite passes. |
| Amp token usage | Present | Present | MATCH | Includes source roots, health, WSL markers, and token/cache buckets. |
| Large session archive protection | Present | Present | MATCH | Session archive store retained. |
| Reversible local model aliases | Present | Present | MATCH | Main, settings, grouping, and chart paths retained. |
| T3 Code session titles | Present | Present | MATCH | T3 store metadata path retained. |
| ZCode WAL-index self-watch guard | Present in `bce50dbd` | Present | MATCH | Suppresses only measured SQLite `-shm` self-events and retains database/`-wal` signals. |
| Antigravity CLI quota endpoint alignment | Present in `76afecb4` | Present | MATCH | Daily endpoint is authoritative with production fallback. |
| Kimi Code monthly quota pools | Present in `d8d60a4e` | Present | MATCH | Named `limit_month_total` pool and Kimi/Code breakdown retained. |
| macOS 26 release runners | Present in `492fd047` | Present | MATCH | Release workflow retains arm64 and Intel macOS 26 jobs. |
| macOS Quit `Cmd+Q` | Present in `babac2c1` | Present | MATCH | Platform-scoped tray accelerator retained. |
| Provider discovery and client classification | Current main | Same source tree | MATCH | No old provider files copied. |
| Usage calculations and history | Current main | Same source tree | MATCH | No Token M calculation override. |
| Limits and reset semantics | Current main | Same source tree | MATCH | Includes scheduled reset presentation. |
| Volcengine Agent Plan | Present | Present | MATCH | `src/shared/providers/volcengine/limits.js`. |
| Droid and Factory usage | Present | Present | MATCH | Upstream feature retained. |
| Tokscale 4.17 integration | Present | Present | MATCH | Upstream dependency and manifest retained. |
| WorkBuddy 5.5 support | Present | Present | MATCH | New scan roots and limits path retained. |
| Live token rate | Present | Present | MATCH | Bubble and macOS paths retained. |
| Per-tool custom scan paths | Present | Present | MATCH | Collector and settings retained. |
| Session timestamps and project attribution | Present | Present | MATCH | Scan-backed metadata retained. |
| Session titles | Present | Present | MATCH | Persisted/local titles retained. |
| Codex background-review grouping | Present | Present | MATCH | Current upstream grouping retained. |
| DSH versioned transcripts | Present | Present | MATCH | Windows promotion fix retained. |
| Codex scheduled resets | Present | Present | MATCH | Current upstream limit UI retained. |
| Hub bandwidth optimization | Present | Present | MATCH | No legacy Hub copy restored. |
| Main-screen drag refactor | Present in `a24a24e0` | Present | MATCH | Old `preferenceDragSort.js` is not reintroduced. |
| Native macOS widget redesign | Present | Present | MATCH | Current widget view/model structure retained. |
| Native macOS widget release packaging | Present in `ea6ddf03` | Present | MATCH | Upstream release-artifact build path retained with Token M executable naming adaptation only. |
| Projects and session metadata UI | Present | Present | MATCH | Generic renderer is upstream. |
| Generic settings and accessibility | Present | Present | MATCH | Token M settings are namespaced. |
| Generic theme and platform fixes | Present | Present | MATCH | No fork-wide renderer replacement. |
| Upstream updater algorithm | Present | Present | MATCH | `electron-updater` behavior retained. |
| Token M update feed ownership | Not upstream | `Gary06910/TokenM` | TOKEN_M_OVERLAY | Prevents installation of official upstream binaries. |
| Token M branding and package identity | Not upstream | `Token M` | TOKEN_M_OVERLAY | Visible labels/metadata only; compatibility IDs documented. |
| Android pairing and notification delivery | Not upstream | Namespaced overlay | TOKEN_M_OVERLAY | Contract adapter and tests preserved. |
| Codex Stop Hook | Not upstream | Namespaced overlay | TOKEN_M_OVERLAY | Local-first completion bridge. |
| Durable outbox | Not upstream | Namespaced overlay | TOKEN_M_OVERLAY | Atomic queue and bounded retry. |
| Privacy/full upload mode | Not upstream | Namespaced overlay | TOKEN_M_OVERLAY | Payload projection only. |
| Android/uniCloud source tree | Not upstream | Preserved frozen tree | NOT_APPLICABLE | Explicitly outside Desktop parity scope. |
| WeChat/CloudBase legacy | Not upstream target | 130 tracked source/config and 14 tracked docs preserved frozen | NOT_APPLICABLE | Not re-enabled; ignored dependency/generated trees are excluded. |

No row is marked `BLOCKED` for an upstream feature. The separate Windows package
validation is environment-blocked before the upstream Tokscale asset preflight,
as recorded in the sync report; that does not change the source-level parity
matrix.
