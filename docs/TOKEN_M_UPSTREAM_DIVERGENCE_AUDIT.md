# Token M / Upstream Divergence Audit

## Scope

- Local source of truth: `D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery`
- Local source HEAD: `32ddd91459aa27de7076c0f5227c4001a81dca29`
- Fetched upstream: `https://github.com/Javis603/token-monitor.git`
- Upstream HEAD: `bce50dbdb67408dabd1a13758fd5009e36c88753`
- Candidate: `D:\Program Files (x86)\TokenM\token-monitor-upstream-sync-bce50dbd-final`
- Audit date: 2026-09-17 (Asia/Shanghai)

`git fetch upstream main` completed before the candidate was created. The candidate
is a detached worktree rooted directly at `upstream/main`; no pull, merge, reset,
stash, commit, push, or tag was used.

## Ancestry Result

`git merge-base 32ddd91459aa27de7076c0f5227c4001a81dca29 upstream/main` returned
no commit. The two checkouts therefore have no usable common ancestor in the
available repository history (`NO_MERGE_BASE`). The audit uses the upstream tree
as the authoritative Desktop baseline and a semantic/file-level comparison of the
two worktrees rather than pretending that a three-way merge is meaningful.

For scale, a direct tracked-tree comparison of the current local worktree against
`upstream/main` reports 687 status records (177 additions, 178 deletions, 288
modifications, and 44 rename records). That raw number includes Android, legacy
WeChat, generated assets, documentation, and historical fork drift; it is not a
list of changes carried into the candidate. The candidate itself has 35 modified
upstream files: the 34-file Desktop overlay plus the protected user `AGENTS.md`,
and explicitly listed Token M additions.

## Classification

### A. UPSTREAM_ONLY_CHANGE

All current upstream Desktop changes are present because the candidate starts at
`bce50dbd`. Examples include the full `v0.58.0` tree, ZCode WAL-index self-watch
suppression, Antigravity daily quota endpoint alignment, Kimi Code monthly quota
pools, macOS 26 release runners and `Cmd+Q`, Amp usage tracking, large-archive
session-store protection, reversible local model aliases, T3 Code session titles,
Tokscale 4.17/WorkBuddy 5.5 alignment, provider ordering, per-tool custom scan paths,
scan-backed session timestamps/project attribution, persisted session titles,
Codex background-review grouping, scheduled reset display, Droid/Factory usage,
Volcengine Agent Plan limits, live token rate, Hub transfer reduction, Windows DSH
transcript promotion, native macOS widget redesign, and the Main Screen drag
refactor.

No older Token M copy was used to recreate these areas.

### B. TOKEN_M_ONLY_CHANGE

The candidate adds only the required product overlay: Android HTTP client and
payload validation, durable Android outbox, notification lifecycle, Codex Stop Hook
bridge/forwarder, Token M renderer settings island, Token M release template, and
the preserved `apps/tokenm-android`, `docs/android`, `tests/android`, tracked
`wechat-miniapp`, and tracked `docs/wechat-miniapp` trees. These are detailed in
`TOKEN_M_DESKTOP_OVERLAY_MANIFEST.md`.

### C. BOTH_CHANGED_SAME_AREA

The following upstream files receive small, reviewable Token M hunks while their
upstream implementation remains intact:

- `package.json`, `.env.example`, and `eslint.config.js`
- `src/electron/main.js` and `src/electron/preload.js`
- `src/electron/renderer/index.html`, `app.js`, `i18n.js`, and `styles.css`
- tray, Discord, Linux autostart, diagnostics, and OAuth user-facing branding
- `src/shared/credentialStore.js` and `src/shared/appUpdater.js`
- release workflow, SignPath metadata, and macOS verifier naming
- tests whose expected product metadata must follow Token M
- `AGENTS.md`, where the user-maintained guidance is preserved over upstream's
  differing guidance file without affecting runtime code

The rule for these files is “latest upstream file plus a minimal Token M hunk”; no
full historical Token M file was copied over an upstream refactor.

### D. TOKEN_M_NEW_FILE

Desktop-only additions are the files under `src/electron/android*.js`,
`src/electron/tokenMNotificationRuntime.js`,
`src/electron/codexHook*.js`, `src/electron/codexStopHook.js`,
`src/electron/renderer/tokenMNotificationSettings.js`, the focused
`tests/electron/*` overlay tests, and `.github/TOKEN_M_RELEASE_TEMPLATE.md`.

### E. UPSTREAM_NEW_FILE

Every file newly introduced by upstream through `bce50dbd` is already in the
candidate because its root is the fetched upstream tree. In particular, new
collector/provider/limits/session/Hub/Worker/renderer files were not selectively
cherry-picked and therefore cannot be accidentally omitted by an overlay copy.

### F. DELETED_OR_REFACTORED_UPSTREAM

Old fork-only Desktop implementations were deliberately not restored. This
includes the removed/refactored renderer drag path and legacy WeChat Desktop
client/runtime/outbox/payload files present only in the current Token M worktree.
The candidate keeps upstream's current module boundaries and does not resurrect
those files merely because the fork once modified them.

## Frozen Exclusions

`apps/tokenm-android`, its `uniCloud-alipay` backend, `docs/android`, Android tests,
and the Git-tracked WeChat/CloudBase source/docs are Token M-only source trees.
They were copied byte-for-byte for preservation and were not treated as upstream
Desktop parity targets. Ignored legacy dependency/generated trees were not copied.
No Android business logic or production backend was changed.

## Audit Conclusion

The candidate has a clear upstream-first ancestry despite the absent merge-base.
Every candidate difference is classified in the allowlist, and the final report
records `UNEXPLAINED_DIFFS: 0`. The original local worktree remains untouched.
