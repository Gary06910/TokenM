# Token M WeChat API Contract

状态：`FROZEN v1`  
日期：2026-08-18

## 1. 通用约定

- JSON key 使用 lower camelCase；时间为 UTC ISO-8601；ID 是不透明字符串。
- 小程序 API 通过 `wx.cloud.callFunction({ name: "tokenm-api", data: { action, requestId, ... } })`。
- Desktop API origin 由部署配置提供，固定前缀 `/v1/desktop`，只接受 HTTPS（自动测试可用 loopback HTTP）。
- JSON 响应均带 `requestId`。敏感响应头：`Cache-Control: no-store`。
- 错误 envelope：

```json
{
  "ok": false,
  "error": {
    "code": "machine_code",
    "message": "可显示的简短中文文案",
    "retryable": false
  },
  "requestId": "req_..."
}
```

- 未列出的 input key 默认拒绝。客户端不得提交 `userId`/`openid` 作为 ownership 依据。

## 2. ID 与限制

| 值 | 格式/上限 |
|---|---|
| requestId | `req_` + 16–43 base64url chars |
| userId | `usr_` + 22 base64url chars（不对 Desktop 暴露） |
| desktopId | `dev_` + 22 base64url chars |
| taskId | `tsk_` + 22 base64url chars |
| deliveryId | `dly_` + 22 base64url chars |
| pairing code | 恰好 6 位数字，保留前导 0 |
| deviceName | 1–80 Unicode chars，去控制字符 |
| eventId/sessionId | 1–128 chars，禁止控制字符 |
| project/model | 0–80 chars |
| summary | 0–600 chars，单段，禁止控制字符 |
| HTTP body | 最大 16 KiB |

## 3. 小程序 actions

所有 action 都要求有效微信云函数 OPENID，除非表中另述。

### `bootstrap`

Request：`{ action: "bootstrap", requestId }`

Response：

```json
{
  "ok": true,
  "user": { "id": "usr_...", "createdAt": "..." },
  "settings": { "notificationsEnabled": true },
  "quota": { "available": 8, "reserved": 0, "status": "normal" },
  "desktopCount": 2,
  "todayCompletedCount": 3,
  "recentTasks": [],
  "requestId": "req_..."
}
```

`quota.status`: `normal`（>=4）、`low`（1–3）、`empty`（0）。

### `getDashboard`

Request：`{ action: "getDashboard", requestId }`

返回与 `bootstrap` 的 settings/quota/count/recentTasks 同形；不会创建第二个用户。

### `listTasks`

Request：`{ action: "listTasks", requestId, cursor?: "opaque", limit?: 1..30 }`

Response：`{ ok: true, items: TaskSummary[], nextCursor: string|null, requestId }`

Cursor 由服务端签名/编码 `(occurredAt,taskId)`，客户端不能用任意 owner 条件。默认 limit 20。

### `getTask`

Request：`{ action: "getTask", requestId, taskId }`

只有 task owner 可读；不存在和不属于当前用户都返回同一 `task_not_found`。

Task view：

```json
{
  "taskId": "tsk_...",
  "desktop": { "desktopId": "dev_...", "name": "工作台式机" },
  "occurredAt": "2026-08-18T08:00:00.000Z",
  "privacyMode": true,
  "project": null,
  "model": null,
  "summary": null,
  "durationMs": null,
  "notificationStatus": "skipped_no_quota"
}
```

隐私 task 的内容字段必须为 `null`，UI 固定显示“该任务使用隐私模式，未上传任务内容。”

### `listDesktops`

Request：`{ action: "listDesktops", requestId }`

Response item：`{ desktopId, name, status: "active"|"revoked", createdAt, lastSeenAt, lastEventAt }`。不返回 credential/hash。

### `createPairingCode`

Request：`{ action: "createPairingCode", requestId }`

Response：`{ ok: true, code: "824193", expiresAt: "...", ttlSeconds: 600, requestId }`

同一用户已有 active code 会被标记 `superseded`。code plaintext 只在本次响应返回，不落日志。

### `renameDesktop`

Request：`{ action: "renameDesktop", requestId, desktopId, name }`

要求 owner + active desktop。Response：`{ ok: true, desktop, requestId }`。

### `unbindDesktop`

Request：`{ action: "unbindDesktop", requestId, desktopId, confirmation: "UNBIND" }`

事务内把 desktop 置 `revoked`、清除 auth hash、失效 active outbox authentication。重复 unbind 返回成功且 `alreadyRevoked: true`。

### `prepareSubscriptionGrant`

Request：`{ action: "prepareSubscriptionGrant", requestId }`

Response：`{ ok: true, grantIntentId: "grt_...", templateId: "真实配置或空配置错误", expiresAt: "...", requestId }`

Intent TTL 5 分钟、只可消费一次、绑定 OPENID/internal user 和 server-fixed templateId。页面应在用户点击前预取；`requestSubscribeMessage` 本身仍直接在 bindtap 中调用。

### `recordSubscriptionOutcome`

Request：

```json
{
  "action": "recordSubscriptionOutcome",
  "requestId": "req_...",
  "grantIntentId": "grt_...",
  "result": "accept|reject|ban|filter"
}
```

只有 `accept` 在事务内 `available + 1`。同 intent 重放返回 `duplicate: true` 且不再增加。`reject|ban|filter` 只保存 outcome。Intent 过期返回 `grant_intent_expired`，不盲目补加。

### `updateSettings`

Request：`{ action: "updateSettings", requestId, notificationsEnabled: boolean }`

仅允许通知开关。Privacy mode 是 Desktop payload policy，设置页展示说明，不由小程序静默切换 Desktop 上传模式。

### `clearTaskHistory`

Request：`{ action: "clearTaskHistory", requestId, confirmation: "CLEAR" }`

Response：`{ ok: true, clearedAt, deletedCount, cleanupPending, requestId }`。查询从事务提交后立即不可见；物理删除可分批继续。

### `deleteAccount`

Request：`{ action: "deleteAccount", requestId, confirmation: "DELETE" }`

Response：`{ ok: true, deletionRequestedAt, cleanupPending, requestId }`。先 revoke devices 与禁用读取，再分批删除。

## 4. Desktop HTTP API

### `POST /v1/desktop/pair`

无 bearer；必须 `Content-Type: application/json`。

```json
{ "schemaVersion": 1, "code": "824193", "deviceName": "Gary 的电脑" }
```

成功 `201`：

```json
{
  "status": "paired",
  "desktop": { "desktopId": "dev_...", "name": "Gary 的电脑" },
  "credential": "tm_wx_d1.dev_....<secret>",
  "requestId": "req_..."
}
```

credential 使用格式 `tm_wx_d1.<desktopId>.<43-char-base64url-secret>`，只返回一次。错误/过期/已消费 code 一律 `404 pairing_invalid`；rate limit 为 `429 rate_limited`，不得返回 owner 或 code 状态差异。

### `GET /v1/desktop/status`

Header：`Authorization: Bearer <device credential>`。

成功：`{ ok: true, desktop: { desktopId, name, status, lastSeenAt, lastEventAt }, serverTime, requestId }`。

### `POST /v1/desktop/events`

Header：bearer + JSON content type。

Frozen body：

```json
{
  "schemaVersion": 1,
  "eventId": "evt_...",
  "event": "codex.task.completed",
  "desktopId": "dev_...",
  "occurredAt": "2026-08-18T08:00:00.000Z",
  "privacyMode": true,
  "sessionId": "opaque-session-id",
  "project": null,
  "model": null,
  "summary": null,
  "durationMs": null
}
```

Exact rules：

- `event` 只能是 `codex.task.completed`。
- credential subject 必须等于 body `desktopId`，并从 desktop 解析 owner。
- `occurredAt` 不能比 server time 超前 5 分钟或早于 30 天。
- Privacy mode：`project/model/summary/durationMs` 必须缺失或 `null`；未知/禁止字段（`prompt`, `cwd`, `conversation`, `messages`, `sourceCode`, `lastAssistantResponse`, `turnId`）直接 `422 privacy_payload_rejected`。
- Full mode：只允许非 null 的 project/model/summary/durationMs；仍拒绝任何未知字段。

新事件成功 `201`：

```json
{
  "status": "created",
  "taskId": "tsk_...",
  "notificationStatus": "sent|skipped_no_quota|skipped_disabled|failed|unknown",
  "requestId": "req_..."
}
```

Duplicate `200`：同 eventId 与 canonical body 一致时返回 `{ status: "duplicate", taskId, notificationStatus, requestId }`。不同 canonical body 复用 eventId 返回 `409 event_conflict`。Duplicate 不创建、不发送、不 reserve、不扣 quota。

### `POST /v1/desktop/unpair-self`

Bearer required，body `{ "confirmation": "UNPAIR" }`。成功后当前 credential 即刻无效；重试会因已失效返回 401。

## 5. Notification 状态

Task public status：

- `pending`：已持久化，等待 claim/send（短暂）。
- `sent`：微信 API 明确返回 `errcode=0`，quota 已最终消费。
- `skipped_no_quota`：task 已保存，额度为 0。
- `skipped_disabled`：用户通知开关关闭。
- `failed`：provider 明确拒绝，reservation 已释放，quota 未消费。
- `unknown`：provider 调用/最终确认结果不确定，reservation 保留，不自动重发。

Internal delivery：`claimed -> sending -> sent|failed|unknown`；terminal 状态不可回退。

## 6. Retry contract

- Desktop: network/timeout/408/425/429/5xx 使用 full-jitter exponential backoff（1s 起，15min 封顶），不超过本地 outbox 1000 项；401/403 挂起 credential，400/409/413/422 挂起 terminal。
- Server 对同 eventId 的 retry 仅返回现有结果。微信 provider 调用后不因 Desktop retry 再调用。
- 微信明确失败不自动无限 retry；`unknown` 通过维护/reconciliation 报告处理，默认不重新发送。

## 7. Error codes

`configuration_required`, `unauthenticated`, `unauthorized`, `rate_limited`, `invalid_request`, `body_too_large`, `pairing_invalid`, `desktop_revoked`, `event_conflict`, `privacy_payload_rejected`, `task_not_found`, `grant_intent_expired`, `grant_intent_used`, `provider_rejected`, `provider_unknown`, `cleanup_pending`, `internal_error`。

错误 message 不包含 secret、OpenID、原始 prompt/summary、数据库查询或 stack。
