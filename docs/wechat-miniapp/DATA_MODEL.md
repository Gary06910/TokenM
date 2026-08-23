# Token M 微信小程序数据模型

状态：`FROZEN v1`  
数据库：CloudBase document database  
规则：所有时间由服务端写入；所有 collection 默认拒绝小程序客户端直接读写。

## 1. 标识与 ownership

- `userId`: `usr_` + `base64url(sha256(appId + ":" + openid))[0..21]`。OpenID 只保存在 `users.wechatOpenid`，不返回客户端。
- `desktopId`: CSPRNG 16 bytes，`dev_` + 22 chars。
- `taskId`: `tsk_` + 22 chars，取 `sha256(desktopId + ":" + eventId)`；同 desktop/event 天然幂等。
- `deliveryId`: `dly_` + 22 chars，取 `sha256(taskId + ":wechat-subscribe:v1")`。
- `pairingSessions._id`: `pair_` + HMAC-SHA256(`PAIRING_CODE_PEPPER`, six-digit code)。数据库不保存 code 明文。
- 每个业务文档显式保存 `ownerId`；不依赖客户端传入的 `_openid` 做权限判断。

## 2. `users`

```js
{
  _id: "usr_...",
  ownerId: "usr_...",
  wechatOpenid: "server-only",
  appId: "wx...",
  status: "active" | "deleting" | "deleted",
  notificationsEnabled: true,
  historyClearedAt: Date | null,
  deletionRequestedAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

约束：`ownerId === _id`；`wechatOpenid/appId` 永不出现在 public DTO。Bootstrap 用 deterministic `_id` 保证并发创建幂等。

Indexes：`status + updatedAt`（maintenance）。

Retention：active user 保留；delete request 后立即不可用，物理清理完成只保留不含 OpenID 的最小 deletion audit 30 天或直接删除。

## 3. `desktops`

```js
{
  _id: "dev_...",
  ownerId: "usr_...",
  name: "工作台式机",
  status: "active" | "revoked",
  credentialVersion: 1,
  credentialHash: "HMAC-SHA256 hex; server-only" | null,
  credentialIssuedAt: Date,
  revokedAt: Date | null,
  lastSeenAt: Date | null,
  lastEventAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes：`ownerId + status + createdAt desc`；`status + lastSeenAt`。

State：`active -> revoked`，不可恢复。重绑创建新 desktop/credential；rename 不改变 credential。

## 4. `pairingSessions`

```js
{
  _id: "pair_<codeHmac>",
  ownerId: "usr_...",
  status: "active" | "consumed" | "expired" | "superseded" | "locked",
  attempts: 0,
  expiresAt: Date,
  consumedAt: Date | null,
  consumedByDesktopId: "dev_..." | null,
  supersededAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

不保存 code/plain credential。一个 user 最多一个 active session；新建时旧 session 变 `superseded`。Claim 在事务内读取 `_id`，校验 TTL/status/attempts，创建 desktop 并消费 session。

Indexes：`ownerId + status + createdAt desc`；`status + expiresAt`。

TTL/cleanup：安全性由 claim 时实时检查保障；maintenance 删除 `expiresAt < now-24h` 的 session。不能把 cleanup 延迟当成 code 仍有效。

## 5. `tasks`

```js
{
  _id: "tsk_...",
  ownerId: "usr_...",
  desktopId: "dev_...",
  eventId: "evt_...",
  canonicalDigest: "sha256(canonical payload)",
  schemaVersion: 1,
  event: "codex.task.completed",
  sessionId: "opaque string",
  occurredAt: Date,
  privacyMode: true,
  project: null | "project",
  model: null | "model",
  summary: null | "summary",
  durationMs: null | 1234,
  notificationStatus:
    "pending" | "sent" | "skipped_no_quota" | "skipped_disabled" |
    "failed" | "unknown",
  notificationDeliveryId: null | "dly_...",
  createdAt: Date,
  updatedAt: Date
}
```

Privacy invariant：`privacyMode=true` 时 project/model/summary/durationMs 均为 `null`。`eventId` 只在同 desktop 下幂等；deterministic `_id` 与 `canonicalDigest` 检测 conflict。

Indexes：

- `ownerId + occurredAt desc + _id desc`（主 pagination）。
- `ownerId + desktopId + occurredAt desc`。
- `ownerId + notificationStatus + occurredAt desc`（诊断）。
- `_id` 已保证 `desktopId + eventId` 唯一，无需另一个唯一索引。

Retention：默认 90 天（环境可缩短/延长）；用户 `historyClearedAt` 使旧任务立即不可见，maintenance 物理删除。

## 6. `notificationState`

每用户恰好一个文档，`_id = userId`。

```js
{
  _id: "usr_...",
  ownerId: "usr_...",
  available: 8,
  reserved: 0,
  grantedTotal: 12,
  consumedTotal: 4,
  releasedTotal: 0,
  version: 17,
  lastGrantAt: Date | null,
  lastConsumedAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

Invariants：

- 所有计数为 non-negative safe integer。
- `grantedTotal = available + reserved + consumedTotal`（若未来引入 admin adjustment，需新增显式 ledger 字段并升级 schema）。
- Reservation：`available -= 1; reserved += 1`。
- Send success：`reserved -= 1; consumedTotal += 1`。
- Explicit failure：`reserved -= 1; available += 1; releasedTotal += 1`（releasedTotal 仅诊断，不参与等式）。
- 所有 mutation 只能在服务端 transaction 中执行并检查前置状态。

Indexes：无需查询索引，按 `_id` 直接读取；`updatedAt` 可用于 maintenance。

## 7. `subscriptionGrants`

```js
{
  _id: "grt_...",
  ownerId: "usr_...",
  templateIdHash: "sha256(templateId)",
  status: "prepared" | "accepted" | "rejected" | "banned" | "filtered" | "expired",
  result: null | "accept" | "reject" | "ban" | "filter",
  expiresAt: Date,
  consumedAt: Date | null,
  clientRequestId: null | "req_...",
  createdAt: Date,
  updatedAt: Date
}
```

Intent TTL 5 分钟，只能消费一次。只有 `prepared -> accepted` 的同一个事务可以 `available + 1`。重复 outcome 返回原结果，不再次 mutation。

Indexes：`ownerId + status + createdAt desc`；`status + expiresAt`。

Cleanup：终态保留 30 天用于额度争议/安全审计，随后删除；prepared 过期 24 小时后删除。

## 8. `notificationDeliveries`

```js
{
  _id: "dly_...",
  ownerId: "usr_...",
  taskId: "tsk_...",
  desktopId: "dev_...",
  channel: "wechat_subscribe",
  templateIdHash: "sha256(templateId)",
  status: "claimed" | "sending" | "sent" | "failed" | "unknown",
  quotaReserved: true,
  attemptCount: 0 | 1,
  providerAttemptId: "att_..." | null,
  providerErrcode: number | null,
  providerErrmsgCode: "sanitized machine string" | null,
  miniprogramState: "developer" | "trial" | "formal",
  claimedAt: Date,
  sendingAt: Date | null,
  finishedAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

`attemptCount <= 1` 是 v1 at-most-once invariant。`claimed -> sending` 在 transaction 中完成后才调用 provider；`sending -> sent|failed|unknown`。Duplicate event 只读此文档。

`quotaReserved` 是冻结 v1 的不可变 provenance marker：`true` 表示该 delivery 创建时曾通过 `notificationState` 账本建立 quota reservation，不表示 reservation 当前仍 active。正常 `sent`、正常 `failed` 与 reconciliation 后的 `failed` 均保留 `quotaReserved: true`。实时 reservation 的唯一账本权威是 `notificationState.reserved`；settlement 必须由 delivery/task 终态、对应账本 delta 与账本恒等式共同证明，不能用 `quotaReserved: false` 证明。

Indexes：`ownerId + createdAt desc`；`status + updatedAt`（reconciliation）；`taskId`。

Retention：90 天；task 清除时一并删除。`unknown` 不因 TTL 自动释放 quota，须通过明确 reconciliation policy。

## 9. `securityEvents`

```js
{
  _id: "sec_...",
  ownerId: "usr_..." | null,
  subjectId: "short/hash" | null,
  type: "pair_failed" | "rate_limited" | "auth_failed" | "event_rejected" |
        "desktop_revoked" | "account_delete_requested",
  outcome: "allowed" | "denied",
  reason: "machine_code",
  requestId: "req_...",
  networkFingerprint: "HMAC truncated" | null,
  createdAt: Date
}
```

禁止 OpenID、完整 IP、authorization、pair code、prompt/summary、stack。Retention 30 天。

Indexes：`type + createdAt desc`；`ownerId + createdAt desc`；`createdAt` cleanup。

## 10. `rateLimits`

```js
{
  _id: "rl_<route>_<bucket>_<fingerprintHmac>",
  count: 1,
  limit: 10,
  expiresAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

每个 bucket 在 transaction 中原子增量；超限先拒绝再写 redacted security event。Cleanup 删除过期 24 小时以上文档。

## 11. Transaction boundaries

1. Pair claim：pair session + desktop。
2. Grant finalize：subscription grant + notificationState。
3. Event create/skip：task + optional delivery + notificationState reservation + desktop lastEventAt。
4. Delivery claim：delivery `claimed -> sending`。
5. Delivery finalize：delivery + task + notificationState consume/release。
6. Unbind：desktop revoke；其他文档不重写 owner。
7. History clear：users.historyClearedAt；物理 batch delete 在事务外按 owner/时间执行。

事务内不调用微信 API、HTTP 或另一个云函数。
