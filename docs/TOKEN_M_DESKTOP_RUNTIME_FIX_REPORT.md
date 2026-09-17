# TOKEN_M_DESKTOP_RUNTIME_FIX_REPORT

## STATUS

`IMPLEMENTED_VALIDATED_GUI_ACCEPTANCE_PENDING`

## BASELINE

- **UPSTREAM:** `upstream/main` at `bce50dbdb67408dabd1a13758fd5009e36c88753`
- **VERSION:** `0.58.0`
- **CANDIDATE:** `D:\Program Files (x86)\TokenM\token-monitor-upstream-sync-bce50dbd-final`
- **OLD SOURCE:** `D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery`
- **UPSTREAM_FIRST:** `YES`
- **PROMOTION:** `NO` (not requested in this round)

## ISSUE_1_NOTIFICATION_SETTINGS

- **OLD_LOCATION:** `Settings > General > generalSettingsDetails`
- **NEW_LOCATION:** 独立一级 `Settings > 手机通知` section, alongside upstream
  sections such as `常规`, `外观`, `服务 / 额度`, `高级`, and `关于`.
- **GENERAL_SECTION_CONTAINS_NOTIFICATION:** `NO`
- **LANGUAGE:** 中文 for all Token M notification-specific labels, states,
  descriptions, errors, and controls.
- **UPSTREAM_SETTINGS_ARCHITECTURE:** preserved. The new section is registered
  through `SETTINGS_SECTION_IDS`, the existing section-selection state,
  keyboard navigation, accessibility attributes, and existing i18n mechanism.
- **FILES_CHANGED:**
  - `src/electron/renderer/index.html`
  - `src/electron/renderer/app.js`
  - `src/electron/renderer/i18n.js`
  - `src/electron/renderer/styles.css`
  - `src/electron/renderer/tokenMNotificationSettings.js`
  - `tests/electron/androidSettings.test.js`
- **IPC_CHANGED:** `NO`
- **PAIRING_CONTRACT_CHANGED:** `NO`
- **STOP_HOOK_CHANGED:** `NO`
- **OUTBOX_CHANGED:** `NO`
- **PRIVACY_PROJECTION_CHANGED:** `NO`
- **ANDROID_API_CHANGED:** `NO`
- **GUI_LABEL_OBSERVATION:** `NOT_RUN`. The isolated process created a Token M
  window, but the current Computer Use connector exposed no app binding or
  accessibility tree (`getApp`/`listApps` unavailable); source-level checks
  remain PASS.

## ISSUE_2_USAGE_LIMITS

### CURRENT_RUNTIME_ENVIRONMENT

Paths only; credentials, tokens, and keys were not printed.

- **APPDATA:** `C:\Users\Gary\AppData\Roaming`
- **LOCALAPPDATA:** `C:\Users\Gary\AppData\Local`
- **CODEX_HOME:** 未设置
- **HOME:** `D:\AppData\SPB_Data`
- **USERPROFILE:** `C:\Users\Gary`
- **TOKEN_MONITOR_USER_DATA:** `C:\Users\Gary\AppData\Roaming\Token Monitor`
- **CODEX_SESSION_ROOT_USED_FOR_COMPARISON:** `C:\Users\Gary\.codex\sessions`

### OLD_VERSION_RESULT

Using the old Token M source with the same Codex source and current user
environment produced non-zero usage:

- **USAGE:** today `28,007,987`; month `295,167,075`; all-time
  `4,908,957,946` tokens.
- **LIMITS:** formal Codex provider `unavailable`, `windows=0`,
  `accountDetected=false`.

### NEW_VERSION_RESULT

Before the compatibility-boundary fix, the candidate inherited
`HOME=D:\AppData\SPB_Data`; Tokscale 4.17.0 consequently scanned no Codex
sessions and returned zero usage. Direct Tokscale verification reproduced the
same result under that HOME and returned non-zero rows after using the real
profile home `C:\Users\Gary`.

After the minimal boundary fix, the candidate returned:

- **USAGE:** today `25,904,180`; month `293,063,268`; all-time
  `4,906,854,139` tokens.
- **DIRECT TOKSCALE 4.17.0:** PASS; real Codex sessions were discovered under
  the aligned home (today 2 entries, month 67 entries, all-time 748 entries).
- **LIMITS:** unchanged formal provider result: `unavailable`, `windows=0`,
  `accountDetected=false`.

The old/new totals differ because the two runtimes and Tokscale versions were
observed at different times; the forensic question was the zero/non-zero
boundary, which is resolved by the HOME alignment.

- **USAGE_STATUS:** `PASS` after the minimal integration fix
- **LIMIT_STATUS:** `UNAVAILABLE / ACCOUNT_NOT_DETECTED` in both old and new
- **ROOT_CAUSE:** Tokscale's Windows resolver preferred the inherited absolute
  `HOME`, which pointed away from the real Codex session root. This was a
  Token M integration compatibility regression exposed by the upstream sync,
  not evidence that the upstream usage algorithm was broken.
- **ISOLATED_PROFILE_CAUSED_ZERO:** `NO`; the zero was reproducible in the
  ordinary candidate runtime with the wrong HOME and disappeared when the same
  real session root was used.
- **CODE_REGRESSION:** `YES`, limited to the Token M-to-Tokscale environment
  boundary.
- **TOKSCALE_4_17:** `PASS`
- **CODEX_SESSION_DISCOVERY:** `PASS` after HOME alignment
- **CODEX_LIMIT_DISCOVERY:** `UNAVAILABLE / ACCOUNT_NOT_DETECTED`
- **FILES_CHANGED_FOR_USAGE:**
  - `src/shared/collector.js` — child-process HOME alignment only
  - `tests/shared/tokscaleBlankEnv.test.js` — boundary regression assertion

### UPSTREAM_CORE_MODIFIED

- **COLLECTOR:** `NO` at the upstream algorithm/core level. A Token M
  integration-boundary change was made in the existing orchestration file so
  the child Tokscale process receives the collector's profile home.
- **PROVIDERS:** `NO`
- **LIMITS:** `NO`
- **SESSIONS:** `NO`
- **TOKSCALE:** `NO` (pinned vendored 4.17.0 retained)
- **WHY THE BOUNDARY CHANGE WAS NECESSARY:** the same real Codex session root
  produced zero before the environment alignment and non-zero after it; no
  collector rewrite or old Token M provider/limits implementation was needed.

## ALLOWLIST_AUDIT

- **CANDIDATE_VS_UPSTREAM_MAIN:** re-audited against `bce50dbd`.
- **ALLOWED_DELTA:** Token M notification navigation/localization and the
  proven Windows Tokscale child-environment compatibility boundary, plus the
  already documented Token M overlay/frozen source trees.
- **UNEXPLAINED_DIFFS:** `0`
- **PRODUCTION_PROFILE_MODIFIED:** `NO`
- **ANDROID_SOURCE_MODIFIED:** `NO`
- **UNICLOUD_MODIFIED:** `NO`
- **PUSH/CID/BACKGROUND_PROTECTION_MODIFIED:** `NO`

## TESTS

- **LINT:** `PASS` — `npm run lint`
- **NPM_TEST:** `PASS` — 4671 tests, 4666 pass, 0 fail, 5 skips
- **VERIFY:** `PASS` — 4671 tests, 4666 pass, 0 fail, 5 skips
- **NOTIFICATION_UI:** `PASS` — focused notification/i18n/Tokscale boundary
  suite 36/36; asserts independent section registration, non-General
  placement, Chinese labels/states/modes/Stop Hook text, and unchanged IPC
  calls.
- **USAGE_REGRESSION:** `PASS` — wrong-HOME zero and aligned-HOME non-zero
  behavior reproduced; boundary test passes.
- **GIT_DIFF_CHECK:** `PASS`

## OFFICIAL_WINDOWS_BUILD

- **COMMAND:** `npm run dist:win:dir`
- **RESULT:** `PASS`
- **TOKSCALE:** pinned vendored `4.17.0` reused successfully
- **ARTIFACT:** `dist\win-unpacked\Token M.exe`

## GUI_ACCEPTANCE

- **RESULT:** `NOT_RUN / UNMEASURED`
- **ISOLATION:** temporary app/user-data profile only; no production pairing,
  credential, outbox, Stop Hook, or notification action was invoked.
- **BLOCKER:** CUA inventory reported no apps and the exposed runtime did not
  provide `getApp`/`listApps`, so the created Token M window could not be
  inspected through its accessibility tree.

## PROMOTION_READY

`NO` — the source, forensic usage fix, tests, allowlist, and official build are
validated, but GUI acceptance remains unobservable in this environment and no
promotion is requested.

## FINAL_CONCLUSION

1. 手机通知已在源码中成为独立 Settings 一级版块，不再位于常规；GUI 树本轮未能读取。
2. Token M 通知-specific UI 已按现有 i18n 机制完成中文化。
3. total tokens 为 0 的真实原因是错误的 Windows `HOME` 使 Tokscale 扫描了错误 profile。
4. 属于 Token M integration compatibility regression，不是 upstream collector/limits 算法回退。
5. upstream provider、limits、sessions、Tokscale 4.17.0 与核心 collector 算法保持不变。
6. 本轮保持 `LATEST UPSTREAM + MINIMAL TOKEN M OVERLAY`。
7. 候选可以在 CUA 应用绑定恢复后重新进行隔离 GUI 验收；本轮不宣称 GUI PASS。
