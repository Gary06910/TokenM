# Token M 微信小程序工作计划

状态：Architecture gate `FROZEN v1`  
Lead：GPT-5.6 Sol / max（当前主对话）  
Workers：GPT-5.6 Sol / high

## 1. Git 安全基线

- 起始分支：`main`
- 起始 HEAD：`71c82bda0f975b110453e21585582c4a3e3ba127`
- 起始 dirty：

```text
 M eslint.config.js
 M package.json
 M src/electron/codexHookForwarder.js
 M src/electron/codexStopHook.js
 M src/electron/tokenMNotificationRuntime.js
 M src/shared/collector.js
 M src/shared/hubBuildRegistry.json
 M tests/electron/codexStopHook.test.js
 M tests/electron/tokenMNotificationsIntegration.test.js
 M tests/helpers/sourceEnv.js
 M tests/shared/collectorLoadGuards.test.js
 M tests/worker/managedNotifications.test.js
 M worker/src/index.js
 M worker/src/managed.cjs
 M worker/src/shared/hubBuildRegistry.json
 M worker/wrangler.toml
?? scripts/diagnose-codex-usage.js
?? spikes/
?? tests/electron/codexHookForwarder.test.js
?? tests/fixtures/codex-home/
?? tests/pwa/serviceWorkerPush.test.js
?? tests/shared/codexUsageRegression.test.js
```

规则：不 reset/stash/checkout 覆盖、不清理 untracked、不 force push、不触碰 `spikes/`。实现 worktree 从确认 HEAD + architecture freeze commit 创建；最终由 Lead cherry-pick 到当前 dirty main 并逐冲突人工审查。

Baseline focused tests：34 pass / 0 fail：

```text
node --test tests/shared/codexCompletion.test.js tests/electron/notificationOutbox.test.js tests/electron/tokenMCloudClient.test.js tests/electron/tokenMNotificationsIntegration.test.js tests/worker/managedNotifications.test.js
```

## 2. Phase gates

1. Research/audit：完成。
2. Architecture/API/data/security/UX/design freeze：本文档 commit 后完成。
3. Parallel implementation：5 个独立 Worker；最多 3 个并发，分两波保持真正并行。
4. Lead integration：逐 commit review/cherry-pick，解决 dirty main overlap。
5. Full verification：lint/test/E2E/build/config/secret/dependency。
6. Visual runtime review：优先 DevTools CLI；不可用则保留 mock preview 证据并标 `VISUAL_RUNTIME_REVIEW_BLOCKED`。
7. Taste redesign audit + focused fix agents。
8. Submission/deployment readiness final report。

## 3. Worker ownership

### Worker A — Mini Program UI

Branch/worktree：`codex/wechat-ui` / `token-monitor-wechat-ui`

Owns：`wechat-miniapp/miniprogram/**`（不含 D 的 project config）、`wechat-miniapp/assets/**`、UI fixture adapter。必须读取 gpt-taste 与 frozen docs。不得修改 backend/Desktop/docs contracts。

Deliver：所有页面、components、tokens、loading/empty/error/disabled/pressed、mock state selector、UI smoke tests。

### Worker B — CloudBase Backend

Branch/worktree：`codex/wechat-backend` / `token-monitor-wechat-backend`

Owns：`wechat-miniapp/cloudfunctions/tokenm-api/**`。不得修改 miniapp WXML/WXSS 或 Desktop。

Deliver：production handler/repository/sender、pair/auth/event/task/quota/delivery/query/delete、backend unit tests within function dir。

### Worker C — Desktop Integration

Branch/worktree：`codex/wechat-desktop` / `token-monitor-wechat-desktop`

Owns new：`src/electron/wechat*.js`、`tests/electron/wechat*.test.js`。Shared touch points allowed only：`src/electron/tokenMNotificationRuntime.js`, `main.js`, `preload.js`, renderer notification settings files, `src/shared/credentialStore.js`, `.env.example`, `package.json` minimal scripts/pack files。必须先读取 current dirty main counterpart and avoid reverting it。

Deliver：pair claim、private credential、payload privacy allowlist、outbox/retry、single-hook fan-out、settings/diagnostics。

### Worker D — Security / Platform / Packaging

Branch/worktree：`codex/wechat-platform` / `token-monitor-wechat-platform`

Owns：`wechat-miniapp/project.config.json`, private example, `.gitignore` additions limited to WeChat local config, `wechat-miniapp/config/**`, `docs/wechat-miniapp/DEPLOYMENT.md`, `PRIVACY.md`, `SUBMISSION_CHECKLIST.md`, config validation fixtures。不得改 backend domain/UI。

Deliver：rules/index/env templates、HTTP gateway/deploy/import/trial instructions、privacy/submission docs、secret scan config。

### Worker E — Tests / Integration Harness

Branch/worktree：`codex/wechat-tests` / `token-monitor-wechat-tests`

Owns：`wechat-miniapp/tests/**`, `wechat-miniapp/scripts/**`, root test scripts only if non-overlap, `docs/wechat-miniapp/TEST_MATRIX.md`。不得改 production logic；发现不可测 contract 写 CR。

Deliver：fixtures、required PAIR/AUTH/EVENT/QUOTA/PRIVACY/OWNERSHIP/DELETE tests、3x duplicate、User A/B E2E、UI state smoke、config/build smoke。

## 4. Agent output contract

每个 Worker：

1. 在自己的 worktree 操作。
2. 不更改 frozen contract；问题写 `CONTRACT_CHANGE_REQUEST`。
3. 运行范围 tests 和 `git diff --check`。
4. Conventional commit，不写 AI co-author。
5. 报告 commit SHA、文件列表、命令/结果、known issues。

Prompt 保存于 `docs/agent-prompts/worker-{a..e}.md`。

## 5. Required test ownership

| IDs | Primary owner | Secondary review |
|---|---|---|
| PAIR-01..04 | B | E |
| AUTH-01..02 | B | E/Security Lead |
| EVENT-01..04 | B | E |
| QUOTA-01..05 | B | E |
| PRIVACY-01..02 | C + B | E |
| OWNERSHIP-01..02 | B | E |
| DELETE-01 | B | E |
| UI state matrix | A | E/Lead |
| Mock E2E A/B | E | Lead |

## 6. Integration order

1. Cherry-pick architecture freeze.
2. Backend + platform (independent directory)；review contract compliance。
3. UI；resolve only project config ownership boundaries。
4. Desktop；manually merge overlap with user dirty notification runtime and credential store。
5. Tests/harness；update imports only, never weaken expectations。
6. Run `git diff --check`, focused/full tests, lint, config validation, secret scan, dependency audit。
7. Visual review, Taste audit, fix loop until Critical=0/Major=0。

## 7. Definition-of-done evidence

- Mini Program compile/static config proof。
- Cloud function production sender present and mock injected only in tests。
- Pairing/auth/task/quota/privacy/ownership/idempotency automated proof。
- Desktop reuses one Stop Hook and current normalization。
- `same eventId x3 => task 1, notification <=1, quota -1` E2E。
- Deployment/privacy/submission docs and empty config templates。
- No real AppID/EnvID/Template ID/AppSecret/credential。
- Actual DevTools screenshots or explicit runtime-blocked marker。
- Final readiness states judged separately；real notification stays unverified without credentials/device run。
