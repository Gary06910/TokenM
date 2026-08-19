# Token M 微信小程序 Handoff Recovery

审计日期：2026-08-20  
审计分支：`main`  
审计原则：以当前 Git / filesystem / worktree 实际状态为准；未执行 reset、clean、stash、checkout 覆盖或删除。

## 1. Previous architecture commit

- 冻结提交：`5b5dbc0073010a449fa939d6c32d7bdddd3eea34` (`5b5dbc0`)
- parent：`71c82bda0f975b110453e21585582c4a3e3ba127`
- message：`docs(wechat): freeze mini program architecture`
- 当前 refs 基于该提交：`codex/wechat-architecture`、`codex/wechat-backend`、`codex/wechat-desktop`、`codex/wechat-platform`、`codex/wechat-tests`、`codex/wechat-ui`
- 冻结内容已核对：`ARCHITECTURE.md`、`API_CONTRACT.md`、`DATA_MODEL.md`、`SECURITY_MODEL.md`、`UX_SPEC.md`、`DESIGN_SYSTEM.md`、`OFFICIAL_PLATFORM_NOTES.md`、`WORK_PLAN.md`，以及 `docs/agent-prompts/worker-a-ui.md` 至 `worker-e-tests.md`。
- 冻结文档目前位于 architecture worktree；尚未合入 dirty `main`。

## 2. Main repository safety state

- path：`D:\Program Files (x86)\TokenM\token-monitor-main`
- branch：`main`
- HEAD：`71c82bda0f975b110453e21585582c4a3e3ba127`
- 状态：dirty；16 个已修改文件，多个用户已有 untracked 文件/目录（含 `spikes/`），未发现 staged changes。
- 保护结论：这些改动属于恢复前既有用户工作，不在本恢复记录中重新归类或覆盖；`spikes/android-receiver-p0/` 保留。

## 3. Existing worktrees

| Role | Path | Branch | HEAD | Dirty / recoverable work |
|---|---|---|---|---|
| Architecture | `token-monitor-wechat-architecture` | `codex/wechat-architecture` | `5b5dbc0` | clean, frozen docs/prompts |
| A UI | `token-monitor-wechat-ui` | `codex/wechat-ui` | `5b5dbc0` | untracked `wechat-miniapp/miniprogram/**` + UI test |
| B Backend | `token-monitor-wechat-backend` | `codex/wechat-backend` | `5b5dbc0` | untracked `wechat-miniapp/cloudfunctions/tokenm-api/**` |
| C Desktop | `token-monitor-wechat-desktop` | `codex/wechat-desktop` | `5b5dbc0` | modified shared integration files + untracked `src/electron/wechat*.js` and tests |
| D Platform | `token-monitor-wechat-platform` | `codex/wechat-platform` | `5b5dbc0` | modified `.gitignore` + untracked config/docs/rules |
| E Tests | `token-monitor-wechat-tests` | `codex/wechat-tests` | `5b5dbc0` | untracked tests/fixtures/helpers/harness |

No Worker A-E implementation commit exists after the freeze; the untracked/modified files are recoverable implementation output and must be reviewed before Lead commits.

## 4. Worker A status

Status: `COMPLETE-BUT-NEEDS-INTEGRATION`.

The native mini-program UI is present for onboarding/dashboard/tasks/task detail/desktops/pairing/quota/settings/privacy/about, shared components, assets, API client, DTO/presentation mapping, mock states, and UI tests. Focused test command:

```text
node --test wechat-miniapp/tests/ui-states.test.js
9 pass, 0 fail
```

Known Major to fix during integration: `miniprogram/services/api.js` only unwraps `result.error` and otherwise can map a Cloud Function `{ ok:false, error:{...} }` response to `network_error`; business errors such as `pairing_invalid`, `grant_intent_expired`, and quota/subscription failures must remain visible to the UI. Add regression coverage before accepting A.

## 5. Worker B status

Status: `COMPLETE-BUT-NEEDS-INTEGRATION`.

The production CloudBase function exists under `wechat-miniapp/cloudfunctions/tokenm-api/` with `wx-server-sdk` initialization, CloudBase repository/transaction adapter, HMAC/CSPRNG pairing and credentials, exact event/privacy validation, task-first persistence, idempotency, reservation/confirm/release quota state machine, production `cloud.openapi.subscribeMessage.send`, and fail-closed config.

Focused test command:

```text
node --test wechat-miniapp/cloudfunctions/tokenm-api/test/backend.test.js
23 pass, 0 fail
```

The backend tests explicitly cover provider rejection/unknown outcomes, concurrent quota reservation, ownership, deletion, and production sender configuration. Review the service/repository against the frozen contract before commit; do not replace the transaction path with a memory-only implementation.

## 6. Worker C status

Status: `COMPLETE-BUT-NEEDS-INTEGRATION`.

Pairing, private credential migration/redaction, WeChat payload allowlists, durable outbox, bounded retry, shared completion fan-out, enable/disable settings, and tests are present. Focused test command:

```text
node --test tests/electron/wechatClient.test.js tests/electron/wechatCredential.test.js tests/electron/wechatFanout.test.js tests/electron/wechatOutbox.test.js tests/electron/wechatPayload.test.js tests/electron/wechatSettings.test.js
15 pass, 0 fail
```

Integration must manually reconcile the shared dirty-main counterparts (`tokenMNotificationRuntime.js`, renderer/settings, credential store) and confirm Android/Web Push remains independent. No second Codex Hook was found in the Worker C implementation.

## 7. Worker D status

Status: `COMPLETE-BUT-NEEDS-INTEGRATION`.

Platform config, public/private project templates, collection/index/rule manifests, environment/template mapping, deployment/privacy/trial/submission docs, and validation/secret scan are present. Validation commands:

```text
node wechat-miniapp/config/validate-platform-config.mjs
PASS platform config, deny rules, placeholders, indexes, and package manifest
node wechat-miniapp/config/scan-secrets.mjs
PASS secret scan (35 text files)
```

No real AppID, EnvID, Template ID, AppSecret, or deployment result is present. This worker can be Lead-committed after reviewing path/import and official-platform freshness.

## 8. Worker E status

Status: `PARTIAL / TEST HARNESS BROKEN`.

The contract fixtures, mock sender, desktop mock, clock, UI state matrix, and P0 E2E files exist. Running:

```text
node --test wechat-miniapp/tests/contract.test.js wechat-miniapp/tests/p0-e2e.test.js wechat-miniapp/tests/ui-states.test.js
28 pass, 10 fail (38 total)
```

The 10 failures share one harness defect: `ContractModel.snapshot()` passes `structuredClone` directly to `Array.map`, so the array index is interpreted as the `options` argument (`ERR_INVALID_ARG_TYPE`). This is test code, not evidence of a backend failure; fix it with an explicit value-cloning callback, rerun the full matrix, then integrate. Do not weaken assertions or create a second production backend.

## 9. Existing commits

- Architecture freeze: `5b5dbc0` (verified).
- No post-freeze Worker A-E implementation commits exist.
- Older unrelated Token M history remains on `main`; it is outside this recovery change.

## 10. Uncommitted recoverable work

- A: all UI files under its isolated `wechat-miniapp/miniprogram/**`.
- B: all CloudBase function files/tests under its isolated `wechat-miniapp/cloudfunctions/tokenm-api/**`.
- C: modified shared Desktop integration plus new `wechat*.js` modules/tests.
- D: all platform config/rules and deployment/privacy/submission docs.
- E: all test fixtures/harness/tests.

Each set remains in its original worktree. No files were copied into `main` during this audit.

## 11. Known Major issues

1. UI error-envelope mapping can lose business error codes and display `network_error`.
2. E harness snapshot callback causes 10 false-negative contract/E2E failures.
3. Shared Desktop changes overlap the user's dirty `main`; integration requires a three-way review and must not overwrite those edits.

No Critical security flaw was found in the read-only audit. Backend provider calls are outside the reservation transaction in the reviewed service path, and ambiguous provider outcomes retain reservations without automatic resend.

## 12. Test state

- Main baseline: `npm run verify` => 3404 pass, 5 skipped, 1 fail out of 3410. The sole failure is pre-existing/date-sensitive `tests/shared/codexUsageRegression.test.js` (`today: 0` vs static expected `250` on 2026-08-20); it is not attributed to WeChat and remains untouched.
- A: 9/9 pass.
- B: 23/23 pass.
- C: 15/15 pass.
- D: config validation and secret scan pass.
- E: 28/38 pass until snapshot callback is fixed.

## 13. Contract-change requests

No Worker reported a `CONTRACT_CHANGE_REQUEST`. The UI error mapping is an implementation defect and can be corrected without changing the frozen API envelope.

## 14. Missing work

- Lead commits/cherry-picks after review; no integration has yet occurred.
- Fix UI error mapping and add regression test.
- Fix E snapshot clone callback and reach a green E matrix.
- Three-way merge C shared touch points with dirty `main`.
- Run integrated tests, lint/build, secret/dependency checks, and end-to-end duplicate/quota/ownership assertions.
- Locate and attempt WeChat DevTools compile/preview; without real credentials record `VISUAL_RUNTIME_REVIEW_BLOCKED`.
- Perform final gpt-taste visual audit adapted to native mini-program constraints.

## 15. Next execution sequence

1. Review and Lead-commit A after fixing the error envelope mapping Major.
2. Fix E harness, rerun, and Lead-commit the tests.
3. Review/commit B and D (independent directories), then integrate C with explicit three-way overlap review.
4. Assemble an integration branch/worktree from the freeze, preserving dirty `main`; run contract, worker, and full baseline tests.
5. Run config/secret/build checks and mock P0 E2E (event ×3, quota exhaustion, User A/B isolation).
6. Run DevTools compile/preview if executable; otherwise record the blocked runtime gate.
7. Perform final security, platform, and native UI/taste audits; fix all Critical/Major findings before readiness claims.

## Recovery update (2026-08-20)

- A's `services/api.js` now preserves a Cloud Function `{ ok: false, error: ... }` envelope; a regression test covers `pairing_invalid`. UI-focused coverage is now 10/10 in A's worktree and 27/27 in the merged UI state file.
- E's `ContractModel.snapshot()` now clones map values through explicit callbacks. Contract + P0 E2E coverage is now 38/38 in E's worktree; the merged integration matrix includes the UI state checks.
- A-E outputs were copied into `token-monitor-wechat-architecture` for integration because Git index/object writes in the legacy worktrees are denied by the execution sandbox. No commit was created; no dirty `main` file was overwritten.
- Integrated focused matrix in the architecture worktree: 86/86 pass with `--test-concurrency=1` (Desktop 15, Backend 23, E harness 38, merged UI 27; overlapping test names are counted in the total).
- Platform validation and secret scan now pass in the integration worktree after carrying the Worker D `.gitignore` rule and making the documented synthetic secret allowlist effective: config PASS, secret scan PASS (181 text files), scanner self-test PASS.
- WeChat DevTools executable was not found under the known local installation paths during this audit; runtime/screenshot review remains `VISUAL_RUNTIME_REVIEW_BLOCKED` until the tool and real project credentials are available.
- A clean freeze-based integration directory was assembled at `D:\Program Files (x86)\TokenM\token-monitor-wechat-integrated`; current dirty-main baseline files were mirrored into it except the shared WeChat runtime merge point, which remains a deliberate three-way integration boundary. Its focused matrix is 86/86 pass, config validation PASS, secret scan PASS, and targeted ESLint PASS (using the main repository's installed ESLint runtime).
- Final clean handoff directory: `D:\Program Files (x86)\TokenM\token-monitor-wechat-final`. It preserves the current dirty-main hook baseline needed by the one-Hook fan-out test and contains no duplicate top-level mini-program UI tree. Final focused verification: 86/86 pass, platform config PASS, secret scan/self-test PASS, targeted ESLint PASS.
