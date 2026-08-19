# Token M 微信小程序测试矩阵

本矩阵记录恢复后可在本地重复运行的自动证据；真实微信 AppID、CloudBase EnvID、订阅模板和真机通知仍属于人工 gate。

## Commands

```text
node --test wechat-miniapp/cloudfunctions/tokenm-api/test/backend.test.js
node --test wechat-miniapp/tests/contract.test.js wechat-miniapp/tests/p0-e2e.test.js wechat-miniapp/tests/ui-states.test.js
node --test tests/electron/wechatClient.test.js tests/electron/wechatCredential.test.js tests/electron/wechatFanout.test.js tests/electron/wechatOutbox.test.js tests/electron/wechatPayload.test.js tests/electron/wechatSettings.test.js
node wechat-miniapp/config/validate-platform-config.mjs
node wechat-miniapp/config/scan-secrets.mjs
```

## Coverage

| Area | Evidence |
|---|---|
| Pairing / auth | PAIR-01..04, AUTH-01..02 |
| Completion / idempotency | EVENT-01..04; same event ×3 creates one task, sends at most once, consumes at most once |
| Quota / provider outcomes | QUOTA-01..05; success, explicit failure, unknown reservation, zero quota, concurrency |
| Privacy / ownership / deletion | PRIVACY-01..02, OWNERSHIP-01..02, DELETE-01 |
| UI | first run, bound/no-task, task list/detail, privacy/full detail, quota 0/low/normal, pairing expiry, subscription rejection, pagination error, envelope mapping |
| Desktop | pairing response validation, credential redaction, payload allowlists, retry/suspension, single-hook fan-out, outbox dedupe |
| Platform | project/config/rules/index placeholders, synthetic secret scan and scanner self-test |

## Current recovery result

- Backend: 23/23 pass.
- Contract/E2E harness: 38/38 pass.
- Merged UI state file: 27/27 pass.
- Desktop WeChat focused tests: 15/15 pass.
- Integrated focused run with `--test-concurrency=1`: 86/86 pass.
- Main repository full baseline remains separately documented in `HANDOFF_RECOVERY.md`; its one date-sensitive failure is unrelated to this feature.
