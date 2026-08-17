# Token M 微信小程序安全模型

状态：`FROZEN v1`  
安全目标：用户隔离、设备真实性、秘密最小暴露、事件/额度幂等、隐私默认、可撤销与可删除。

## 1. 信任边界

| 区域 | 信任级别 | 规则 |
|---|---|---|
| 小程序 WXML/JS | 不可信客户端 | 可被调试/修改；不接受其 userId/openid/额度/owner 声明 |
| Desktop renderer | 不可信展示层 | 不接收完整 credential；只能通过受限 IPC 调 main process |
| Desktop main + private store | 本机受限信任 | 可持有 plaintext device credential；日志必须脱敏 |
| CloudBase HTTP gateway | 公网边界 | schema/body/rate/auth 全部验证 |
| Cloud function domain layer | 可信执行层 | 唯一敏感 mutation 入口 |
| CloudBase database | 可信存储 | 客户端 rules 默认 deny；服务端仍执行 ownership |
| 微信订阅消息 API | 外部权威 | `errcode=0` 才确认发送；失败/未知持久化 |

## 2. 身份与 ownership

- 小程序身份只取当前调用的 `cloud.getWXContext().OPENID/APPID`，每次 main 内读取；忽略 event 中任何 openid/userId。
- Desktop identity 只取 bearer 中的 desktopId 并读取 active desktop；body.desktopId 必须一致。
- 所有 query/mutation 同时带服务端 ownerId 过滤或 direct doc 后 owner compare。
- `task_not_found` 同时覆盖“不存在”和“不是 owner”，防枚举。
- User A 的 OPENID、task、desktop、quota、delivery 与 User B 完全分离；没有共享列表或管理员客户端接口。

## 3. Credential lifecycle

- 格式：`tm_wx_d1.<desktopId>.<32-byte-base64url-secret>`。
- secret 使用 CSPRNG，一次响应，服务端只保存 `HMAC-SHA256(DEVICE_SECRET_PEPPER, secret)`。
- 比较使用 constant-time buffer compare；先校验固定格式/长度以避免异常侧信道。
- Desktop 使用现有 `CredentialStore` 原子私有 JSON（POSIX 0600；Windows 依赖 userData ACL）。不发送 renderer，不放 URL/query，不记录完整值。
- Unbind 将 desktop 置 revoked 并清除 credentialHash；下一请求立即 401。Credential 不支持恢复，只能重新配对。
- `DEVICE_SECRET_PEPPER` 仅在 CloudBase function env，和 pairing pepper 分离；轮换需要明确 credential version/migration，不在 v1 静默轮换。

## 4. Pairing 与暴力枚举

- Code 使用拒绝偏差的 CSPRNG 生成 000000–999999，TTL 10 分钟、一次性、每用户最多一个 active。
- DB key 是 HMAC(code)，不是 code/plain hash；数据库泄漏不能直接离线枚举无 pepper 的 100 万空间。
- HTTP claim 在读取 pairing doc 前先按 HMAC(IP + User-Agent coarse fingerprint + time bucket) rate-limit；默认 10 次/10 分钟/指纹，服务端可调。
- 找到 session 后 attempts 最大 5；expired/consumed/superseded/unknown 都返回相同 `pairing_invalid`。
- 错误响应不包含 user、desktop、expiresAt、attempts 或“差几位”；失败日志不含 code/IP 明文。
- Pair success 的 session 与 desktop 创建同一事务；并发消费最多一个成功。

## 5. HTTP 与输入安全

- 生产只允许 HTTPS；client URL 只能是 origin，无 username/password/query/hash。拒绝 redirect 到其他 origin。
- Desktop endpoint 只接受精确 method/path，JSON content type，body <=16KiB；响应 <=64KiB，`Cache-Control: no-store`。
- Exact-key schema；字符串去 NUL/C0/C1 控制字符并限长；时间有 future/retention bounds；整数必须 safe integer。
- Header/name/value 不回显；错误 envelope 无 stack/DB 查询。
- Event rate 默认 120/min/device；status 60/min/device；pair 10/10min/fingerprint。
- 不把 CloudBase function HTTP gateway 的 requestContext 当用户身份；Desktop 必须 bearer，小程序必须 OPENID context。

## 6. Event idempotency 与 conflict

- task `_id` deterministic，首次 transaction 创建 task/delivery；三个相同 event 并发只能形成一个 task。
- 保存 canonical payload digest。相同 eventId + 同 digest 返回 duplicate；相同 eventId + 不同 digest 返回 409，并写 redacted security event。
- Duplicate 绝不触发第二次 provider send 或 quota mutation。
- Desktop outbox 同 eventId 去重，server 仍为权威防线。

## 7. Quota 与 delivery 安全

- 小程序不能直接读写 `notificationState`；只能调用 fixed actions。
- Grant 使用 server-created 5-minute intent，绑定 owner + fixed template hash，只可消费一次，并受速率限制。只有 `accept` transition 执行 +1。
- 平台限制：普通小程序 API 的 `accept` 结果由客户端回传，服务端无法从 `callFunction` 单独取得不可伪造证明。内部 quota 因此是同一 OPENID 的 UX shadow ledger，不是跨用户授权。伪造只能造成该用户自己的 provider 43101/失败，不能读取他人数据或生成可用微信授权。此限制必须在 review 中保留，不得误称“密码学验证 accept”。
- 生产安全仍由微信 `subscribeMessage.send` 权威验证实际授权。Provider 明确失败释放 reservation；成功才最终 consumed。
- available/reserved/consumed 的 mutation 全在单 doc transaction；并发事件不会 quota<0。
- Provider call 前把 delivery 原子 claim 为 sending，attemptCount=1。调用后模糊异常不自动重发，状态 unknown、reservation 保留；这是防重复消息优先的选择。

## 8. Privacy allowlist

### 默认 privacy

客户端 builder 只构造 `schemaVersion,eventId,event,desktopId,occurredAt,privacyMode,sessionId`。服务端要求内容字段 absent/null。禁止字段一旦出现直接拒绝，不是静默丢弃。

### Full

只新增 `project,model,summary,durationMs`。summary 600 字符且单段；project 只应是 basename/用户别名。始终禁止：prompt、messages、conversation/transcript、cwd、source/sourceCode、environment、files、lastAssistantResponse 全量对象。

微信消息在 privacy 模式不含 project/model/summary，只使用通用完成文案、完成时间和可选电脑名。数据库 rules 与 DTO mapper 防止 OpenID/credentialHash 被返回。

## 9. Collection rules

- `users`, `desktops`, `pairingSessions`, `tasks`, `notificationState`, `subscriptionGrants`, `notificationDeliveries`, `securityEvents`, `rateLimits` 全部客户端 `read=false/write=false`。
- 小程序所有读写通过 cloud function；云函数使用服务端权限仍必须做 ownership。
- 规则配置模板需要部署者逐 collection 应用并在开发者工具/控制台验证；不能因为本地 mock 通过就假定线上 rules 生效。

## 10. Secrets 与配置

禁止提交：AppSecret、device credential、pairing/device pepper、CloudBase secret key、access token、真实本地 private config。

可配置但不视为 secret：AppID、EnvID、Template ID、HTTP public origin；仍通过模板/私有文件/env 注入，避免把某个部署写死为产品默认。

生产入口 fail closed：缺少 template/pepper/origin、`WECHAT_MINIPROGRAM_STATE` 非三种值、keyword mapping 非法时返回 `configuration_required`，不降级到 mock sender。

## 11. Logging 与诊断

允许：requestId、route、machine code、截断 desktop/task ID、provider errcode、duration、状态 transition。禁止：Authorization、secret/hash full value、pair code、OpenID、summary/project（默认不记）、请求 body、微信 access token、stack 对客户端。

日志 helper 接受结构化 allowlist；生产禁用 raw `console.log(event)`。Secret scan 覆盖 source、docs、fixtures 与 build output。

## 12. 删除与保留

- Clear history 提交后立即通过 `historyClearedAt` 隔离旧 task，随后 bounded physical deletion；delivery 同步清理。
- Unbind 立即撤销 auth，不删除历史 task。
- Delete account 首先 status=deleting + revoke all desktop，任何读/写返回 account deleting；之后删除 task/delivery/grant/pairing/state/user。
- Pairing 失效后 24h、security/rate 30d、task/delivery 默认 90d。Retention 可配置但不得无限期默认。

## 13. 威胁与控制矩阵

| 威胁 | 控制 |
|---|---|
| 猜 6 位 code | HMAC key、TTL、single-use、global/session rate limit、uniform error |
| DB 泄漏后伪造 device | server 只有 HMAC hash，secret 256-bit |
| Client 改 ownerId | OPENID/device auth 派生 owner，忽略 client owner |
| 重放 event | deterministic task/delivery + digest conflict |
| 并发扣成负数 | notificationState transaction + precondition |
| Provider timeout 导致重复 | at-most-once sending claim，unknown 不自动 resend |
| Renderer/日志泄密 | credential redaction、IPC allowlist、structured log allowlist |
| Privacy payload 偷带内容 | exact-key mode-specific schema，server rejection |
| 解绑后继续发 | revoked status + hash removal |
| Mock 进入 production | explicit injected test-only sender，production fail closed |
| User A 读 User B | cloud context owner filter + uniform not-found + deny rules |

## 14. Security review gates

1. AUTH/PAIR/OWNERSHIP/PRIVACY/QUOTA/DELETE 自动测试通过。
2. rules 文件逐 collection deny，DevTools 以客户端直读验证失败。
3. secret scan 无 credential/pepper/AppSecret；fixture token 明确 synthetic。
4. production config 缺失时 fail closed；mock sender 无 production env 开关。
5. 实际 CloudBase gateway 只 HTTPS，默认测试域名限制已知，自定义域名证书/备案已核验。
6. Critical/Major security findings 为 0 才可标记 trial-ready。
