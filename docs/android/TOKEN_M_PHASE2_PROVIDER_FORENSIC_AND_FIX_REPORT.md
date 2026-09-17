# TOKEN_M_PHASE2_PROVIDER_FORENSIC_AND_FIX_REPORT

Date: 2026-09-09, Asia/Shanghai

STATUS: TOKEN_M_PHASE2_PROVIDER_FORENSIC_READY_FOR_REAL_EVENT

MODEL: GPT-Astra low (user-selected for continuation)

## Runtime baseline

User-supplied production evidence, 2026-09-04 12:39:35 +08:00:

- task persisted: PASS
- eligibility: PASS
- notificationTargetCount: 1
- atomic claim: PASS
- notificationStatus: failed
- notificationReason: provider_error
- provider code/message/stage: absent
- failure latency after target resolution: approximately milliseconds

The frozen Android, identity, permission, pairing and Desktop data path was not redesigned or re-audited in production. Automated fixture tests use fake identities only.

## Production evidence

LOCAL_UNI_CLOUD_PUSH_EXTENSION: PRESENT

PRODUCTION_UNI_CLOUD_PUSH_EXTENSION: UNPROVEN for actual API availability; PASS for deployed extension declaration.

PRODUCTION_RUNTIME: Alipay, tokenm-prod, env-00jy6pbiul92. HBuilderX CLI reports cloud Node 18.18.2 during deployment. Deployed package config is Nodejs18, timeout 10 seconds, URL path /tokenm-desktop-http.

HBuilderX CLI version: 5.24.2026081301. Installed local cloud runner reports Node 18.20.0. Unit tests ran under Node 24.15.0.

The official HBuilderX CLI downloaded production tokenm-desktop-http and tokenm-core before deployment. The downloaded HTTP package includes extensions.uni-cloud-push = {}, and the downloaded provider source matches the original audited implementation. This rejects PRODUCTION_DEPLOYED_PACKAGE_EXTENSION_MISSING; it does not prove that runtime.getPushManager is callable in a production invocation.

Production core originally discards caught errors in processTaskNotification. Resolved nonzero/missing errCode produces provider_rejected, while thrown errors produce provider_error. transitionNotification catches persistence errors and returns the prior status, so ordinary outcome persistence failure would retain pending rather than produce this failed/provider_error record.

No additional runtime probe or provider invocation was performed.

## PUSH_PROVIDER_CALL_CHAIN

Paths below are relative to apps/tokenm-android/uniCloud-alipay.

| FILE | FUNCTION | STAGE | INPUT | OUTPUT | THROW POSSIBILITY | CATCH LOCATION | PERSISTED RESULT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cloudfunctions/tokenm-desktop-http/index.js | getRuntimeApplication | runtime wiring | globalThis.uniCloud | application with sender | initialization/config error | http-contract handler | no provider attempt |
| cloudfunctions/common/tokenm-core/application.js | events | task commit first | authenticated event | committed task | repository transaction error | events/HTTP handler | task commits before notification processing |
| cloudfunctions/common/tokenm-core/application.js | processTaskNotification, resolveNotificationTargets | evaluate eligibility | owner, device and official identity records | target count and in-memory CID array | repository query error | processTaskNotification | skipped states or notification_prepare diagnostic |
| cloudfunctions/common/tokenm-core/application.js | claimNotification | atomic claim | task ID, not_requested | one claimant | conditional update error | claimNotification | not_requested -> pending; attempt timestamp/count |
| cloudfunctions/common/tokenm-core/repository-unicloud.js | updateWhere | claim/result write | status predicate and patch | update count | database error | caller | single where().update(), outside task transaction |
| cloudfunctions/common/tokenm-core/push-notification.js | buildTaskCompletedNotification | build_request | task ID, desktop name, in-memory CID array | bounded request | invalid local input | sender then application | failed/provider_error with build_request |
| cloudfunctions/common/tokenm-core/push-notification.js | sender, getPushManager | get_push_manager | appId __UNI__46C9063 | cached manager | missing extension, manager creation or missing method | sender then application | failed/provider_error with get_push_manager |
| cloudfunctions/common/tokenm-core/push-notification.js | sender | send_message | request | promise result | synchronous throw or rejected promise | sender then application | failed/provider_error with send_message |
| cloudfunctions/common/tokenm-core/push-notification.js | withTimeout | provider_timeout | one operation, 4000 ms | result or timeout | timeout rejection | sender identifies its own timeout error | failed/provider_error with provider_timeout |
| cloudfunctions/common/tokenm-core/push-notification.js | sender | provider_response | errCode/errMsg | accepted, code, safe message | exceptional response accessor | sender then application | response stage preserved |
| cloudfunctions/common/tokenm-core/application.js | processTaskNotification, transitionNotification | success persistence | accepted and code 0 | submitted | DB update failure | transitionNotification | pending -> submitted, code 0, submitted timestamp |
| cloudfunctions/common/tokenm-core/application.js | processTaskNotification, transitionNotification | failure persistence | normalized stage/code/message | failed | DB update failure | transitionNotification | pending -> failed, provider_error and safe diagnostics |
| cloudfunctions/common/tokenm-core/application.js | transitionNotification | provider_persist | failed outcome write | original status | underlying DB error | local catch | no resend; fixed safe log because failed DB cannot reliably persist diagnostics |
| cloudfunctions/tokenm-desktop-http/http-contract.js | createHttpHandler | Desktop response | created/duplicate result | HTTP 201/200 | unrelated transport error | HTTP handler | provider failure does not reject the committed event |

Actual order is request construction BEFORE manager creation. No request validation stage exists between manager creation and send other than checking manager.sendMessage is a function.

## Official contract and request audit

Sources verified in the initial forensic pass:

- https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html
- https://uniapp.dcloud.net.cn/unipush-v2
- https://doc.dcloud.net.cn/uniCloud/cf-functions.html
- Installed HBuilderX uni-cloud-server/extension/push.d.ts

PUSH_MANAGER_CREATION: uniCloud.getPushManager({ appId }) is correct; production runtime invocation remains unproven.

SEND_MESSAGE_CONTRACT: manager.sendMessage(object) returns a promise; errCode 0 indicates submission, not device delivery. Nonzero responses and thrown exceptions are recorded separately by stage.

| FIELD | CURRENT VALUE TYPE | OFFICIAL EXPECTED TYPE | AUDIT |
| --- | --- | --- | --- |
| appId | string __UNI__46C9063 | string | VALID parameter; AppID unchanged; production push-service configuration not independently read |
| push_clientid | array; runtime baseline count 1 | string or array, up to 1000 | VALID; local cap remains 500; no CID printed |
| platform | string app-android | string or array | VALID enum; UNNECESSARY for direct CID targeting; retained |
| title | string Token M | string, length <20 | VALID |
| content | string, task-completed phrase and desktop name; capped at 49 code points | string, length <50 | No proven failure; actual historical value not retrieved; UTF-16/code-point interpretation not used to justify a speculative change |
| payload | object containing only taskId | string or object, <800 characters | VALID bounded task ID object |
| force_notification | boolean true | boolean | VALID |

## ROOT_CAUSE_MATRIX

| Candidate | Status | Evidence |
| --- | --- | --- |
| P1 getPushManager entry | UNPROVEN | Immediate failure is consistent; deployed declaration present, actual API availability not tested |
| P2 request validation | UNPROVEN | Local construction precedes P1; no confirmed invalid input or official field violation |
| P3 sendMessage entry throw | UNPROVEN | Consistent with production catch and millisecond interval |
| P4 immediate promise rejection | UNPROVEN | Consistent with same evidence |
| P5 timeout wrapper | UNPROVEN for unexpected wrapper error; normal timeout REJECTED | Normal configured deadline is 4000 ms, incompatible with supplied interval |
| P6 resolved nonzero errCode | REJECTED as sole cause of this historical record | Downloaded production source would write provider_rejected |
| P7 ordinary response-shape mismatch | REJECTED as sole cause | Missing errCode follows provider_rejected; exotic throwing accessor remains unproven |
| P8 success then persistence failure | REJECTED as sole cause | Downloaded transition helper returns pending on update exception |
| P9 other exception | UNPROVEN | Original exception was not retained |

ROOT_CAUSE: Historical failure is narrowed to a thrown-error path; precise provider cause cannot be recovered from the old task/log evidence.

ROOT_CAUSE_STATUS: NARROWED

ROOT_CAUSE_CONFIDENCE: MEDIUM for narrowing; exact stage unproven.

SELECTED_FIX: Minimal staged safe provider diagnostics; no speculative request changes. Local and production-deployed-package missing-extension hypotheses are rejected.

## Observability and invariants

PROVIDER_OBSERVABILITY_BEFORE: provider_error only for exceptions.

PROVIDER_OBSERVABILITY_AFTER:

- notificationProviderStage: finite enum
- notificationProviderCode: bounded string, null if unavailable/unsafe
- notificationProviderMessage: first-line short text, at most 240 UTF-16 units, null when absent; suspicious echoed data is omitted

The helper reads errMsg before message, and errCode before code. It never serializes the error/request. Known request values and explicit sensitive-data patterns suppress messages. Stack and nested error properties are not persisted. provider_persist uses a fixed message without the raw database error. The schema uses the repository's existing nullable-field convention, with bounded string values enforced by the backend.

TASK_SCHEMA_CHANGED: YES

FIELDS_ADDED: notificationProviderStage, notificationProviderMessage. notificationProviderCode existed and now permits unavailable codes as null.

SENSITIVE_DATA_PERSISTED: NONE in added diagnostics

CID_LOGGED: NO

HASH_USAGE: NONE

AT_MOST_ONCE: PRESERVED

FAILED_EVENT_RETRIED: NO

TASK_PERSISTENCE: PRESERVED

DESKTOP_EVENT_ACCEPTANCE: PRESERVED

ANDROID_SOURCE_CHANGED: NO

ANDROID_CLOUD_BUILD_REQUIRED: NO

DESKTOP_SOURCE_CHANGED: NO

## Files and tests

BACKEND_FILES_CHANGED:

- cloudfunctions/common/tokenm-core/push-notification.js
- cloudfunctions/common/tokenm-core/application.js
- database/tokenm-tasks.schema.json

Tests updated: tests/android/uniPushProvider.test.js, tests/android/pushDelivery.test.js.

TESTS: 19 passed, 0 failed; focused ESLint passed. Mock-only tests cover manager throw/missing extension, synchronous send throw, promise rejection, timeout, nonzero/zero/missing response, safe diagnostic persistence, HTTP 201/200 acceptance, committed task survival, duplicate and historical event no-retry, competing claims, and fixed safe persistence-failure logging. Existing fixture eligibility tests were retained, not production re-investigations. No full repository verification was run because this task prohibits unrelated flows and content-fingerprint operations.

## Production deployment validation

Official HBuilderX CLI used the already-associated tokenm-android project, provider alipay, space tokenm-prod. Local function files and core draft were copied to a task backup before download; no deletion commands were issued. Deployment actions were restricted to named resources:

1. tokenm-tasks.schema.json upload --force: SUCCESS. The initial non-force request explicitly skipped the existing schema; only the later successful upload is counted.
2. tokenm-core upload --force: SUCCESS. HBuilderX reported automatic update of dependent cloud functions. tokenm-co depends on this common module; its independent source was not edited/uploaded separately.
3. tokenm-desktop-http upload --force: SUCCESS, including its existing uni-cloud-push declaration.
4. Downloaded all three named resources again: SUCCESS. Core JS files, HTTP entry/contract/package and schema match intended contents. Common-module package JSON was minified by HBuilderX; structural comparison passed. No content fingerprints were used.
5. Re-ran the 19 tests and focused lint on downloaded source: PASS.

PRODUCTION_DEPLOYMENT_RESULT: SUCCESS; runtime send acceptance pending new real event.

REAL_PROVIDER_CALL_AFTER_DEPLOY: NOT_RUN

NEXT_RUNTIME_ACTION: Complete one new real Codex task with a new desktopId/eventId pair. Do not replay any old failed event.

EXPECTED_NEXT_TASK_DIAGNOSTICS: notificationStatus, notificationProviderStage, notificationProviderCode, notificationProviderMessage. A DB outcome-write failure may leave pending and emits provider_persist in the function log instead.

ADB_USED: NO

SMOKE: NONE

SHA256: NONE

AGENTS_MD: UNTOUCHED by this task; pre-existing modifications retained

COMMIT: NO

PUSH_GIT: NO

FINAL_CONCLUSION: The historical exact stage is unproven and no speculative provider fix is claimed. The error-information-loss defect is fixed and deployed. Production deployment package configuration is verified, while actual Push extension API availability awaits the new event. The user can complete one new real Codex task for acceptance. No APK rebuild is needed.
