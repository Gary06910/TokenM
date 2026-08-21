# Token M 微信小程序部署手册

状态：人工部署手册；本地文件通过不等于已部署、已发出通知或已通过审核。执行前先阅读冻结的 `ARCHITECTURE.md`、`SECURITY_MODEL.md`、`DATA_MODEL.md` 与 `API_CONTRACT.md`。

收尾状态（2026-08-20）：`bootstrap` 与 `listDesktops` 已完成真实云端 smoke test；bootstrap 临时诊断返回码已移除。CloudBase repository 的 `set`/`update` 必须使用 `{ data: document }`，并在 `.doc(id)` 写入时剔除 `_id`；`errCode=-1` 不能单独视为 document-not-found。`READY_FOR_REAL_PAIRING_TEST` 仍需正式部署和安全收尾。

**第一次真实 desktop pairing 前必须轮换 `PAIRING_CODE_PEPPER` 与 `DEVICE_SECRET_PEPPER`，因为旧值曾在截图中暴露。文档不记录实际 pepper 值。**

## 环境状态

`WECHAT_MINIPROGRAM_STATE` 只有三种合法值：开发者工具/开发版使用 `developer`，上传并设为体验版后的真机验收使用 `trial`，审核通过并发布正式版后才使用 `formal`。每次切换都要重新检查云函数环境变量并部署生效，不能用 `developer` 的模拟结果替代体验版证据。

## 精确 20 步部署流程

1. **取得真实 AppID 与权限。** 在微信公众平台创建或选择小程序，确认操作者具有开发、上传和云开发权限。记录真实 AppID 到仓库外的密码管理位置；不要填写 AppSecret 到小程序、Desktop、文档或仓库。此时不要声称审核完成。

2. **创建 CloudBase 环境。** 从该小程序进入云开发控制台创建独立环境，确认环境归属正确的小程序和地域，记录真实 EnvID 到仓库外。不要复用不受本部署者控制的测试环境。

3. **注入 EnvID 与 Template ID 空位。** 复制 `wechat-miniapp/config/miniprogram-runtime.example.json` 到仓库外填写，然后把 `cloudBaseEnvId`、`subscribeTemplateId` 同步到 `wechat-miniapp/miniprogram/config/runtime.js` 的同名字段。两个字段有任一为空时应保持 `configuration_required`，不得回退到 mock 或本地 endpoint；真实运行配置不得提交。

4. **创建九个 collection。** 按 `wechat-miniapp/config/database/collections.json` 逐项创建 `users`、`desktops`、`pairingSessions`、`tasks`、`notificationState`、`subscriptionGrants`、`notificationDeliveries`、`securityEvents`、`rateLimits`。名称大小写必须一致，不启用客户端自动创建业务文档。

5. **创建并核对 indexes。** 按 `wechat-miniapp/config/database/indexes.json` 在控制台逐项建立复合/单字段索引，特别核对 `tasks` 的 `(ownerId asc, occurredAt desc, _id desc)` 游标顺序。等待全部索引状态变为可用后再继续；失败或“建设中”不是通过。

6. **逐 collection 应用默认拒绝 rules。** 按 `database/rules-manifest.json` 打开每个对应 rule 文件，将 `read=false`、`write=false` 应用到该 collection。保存后用开发者工具尝试客户端直读与直写，九个 collection 都必须失败；云函数仍需执行 ownership 校验，服务端权限不等于可跳过校验。

7. **本地安装云函数依赖。** 进入 `wechat-miniapp/cloudfunctions/tokenm-api/`，执行 `npm ci --omit=dev`（若部署包尚未产生锁文件，先由维护者生成并审查锁文件，不能在生产临时改依赖）。执行云函数范围测试；不要把根项目的 `node_modules` 打进函数包。

8. **部署 `tokenm-api` 与 OpenAPI 权限。** 确认函数 `config.json` 只声明所需的 `subscribeMessage.send` OpenAPI 权限，然后在微信开发者工具选择“上传并部署：云端安装依赖”或使用 CloudBase 控制台部署同一目录。函数名必须是 `tokenm-api`，运行时与包支持范围一致；部署日志成功后再做一次 `bootstrap` 调用。

9. **配置 HTTPS HTTP route。** 在 CloudBase 函数详情或 HTTP 访问服务把公网 HTTPS 域名的触发路径 `/` 绑定到 `tokenm-api`，使固定接口落在同一 origin 下的 `/v1/desktop/*`。默认域名只用于开发/短期验证；生产应使用完成域名所有权校验、备案（适用时）、DNS 与有效 TLS 证书的自定义域名。禁止把需要 CloudBase access token 的函数 HTTP API 地址误当成 Desktop 公共 gateway。

10. **配置 Desktop origin。** 把上一步的纯 origin（形如 `https://<your-domain>`，无 path/query/hash/账号信息）设置为 Desktop 的 `TOKEN_M_WECHAT_API_URL` 预配置值；Desktop 自己追加 `/v1/desktop` 路径。验证不会跨 origin 跟随 redirect，生产不得使用 `http://`、IP、localhost 或开发者工具“不校验合法域名”绕过。

11. **申请真实一次性订阅模板。** 在小程序后台选择与服务类目、真实用途一致的“一次性订阅消息”模板，记录真实 Template ID。模板至少应提供可承载通用完成状态与完成时间的字段；电脑名只能作为可选、隐私安全字段。模板标题、类目或字段未审核可用时停止，不要自造 Template ID。

12. **建立真实 keyword mapping。** 复制 `config/template-keyword-mapping.example.json` 到仓库外，根据模板详情把 `completionStatus`、`completedAt`、可选 `desktopName` 映射到真实 keyword（例如后台确实显示的 `thing1`/`time2`，示例不是默认值），并把 `type` 与 `maxChars` 对齐真实字段。`thing` 最多 20 字符、`phrase` 最多 5 个汉字；发送器还需去控制字符。mapping 的 `templateId` 必须与真实 Template ID 完全一致。

13. **填写云函数环境变量并 fail closed。** 在仓库外复制 `cloudfunction.env.example.json`，填写两个不同且至少 32 字符的随机 pepper、真实 Template ID、上一步 mapping 的单行 JSON、HTTPS public origin、状态及限制项。v1 推荐值为 pairing TTL `600` 秒、pair `10/600`、event `120/60`、status `60/60`、task `90` 天、pairing cleanup `24` 小时、security event `30` 天。体验版必须设 `WECHAT_MINIPROGRAM_STATE=trial`。运行 `validate-platform-config.mjs --production-env ... --production-template ...`，再把值通过控制台设置到函数并重新部署；生产禁止 `MOCK_SENDER`。

14. **导入微信开发者工具。** 从 `wechat-miniapp/project.private.config.example.json` 复制为被 git 忽略的 `project.private.config.json`，只在副本填写真实 AppID。开发者工具导入目录必须精确选仓库内 `wechat-miniapp/`；确认相对的 `miniprogramRoot=miniprogram/` 与 `cloudfunctionRoot=cloudfunctions/` 被正确识别。

15. **编译、预览并关闭调试豁免。** 保持公共配置 `urlCheck=true`，执行编译与真机预览；检查 `wx.cloud.init` 连接的是目标 EnvID、`bootstrap` 不返回 OpenID/credential hash、所有页面无 mock 数据/本地 endpoint。开发者工具的“不校验合法域名/TLS/HTTPS 证书”必须关闭；模拟器结果只作为静态/交互初检。

16. **配置隐私保护指引。** 以 `PRIVACY.md` 为披露草案，在小程序管理后台填写真实运营者、联系渠道、数据类型、CloudBase 处理、保留与删除方式；把 `<请填写…>` 全部替换。若平台判断使用受保护隐私接口，按官方流程接入并真机验证隐私同意状态。体验版隐私指引也必须已配置。

17. **上传开发版并设体验版。** 在开发者工具上传代码（填写可追溯版本号与说明），在管理后台添加所需体验成员，并把指定开发版本设为体验版。上传不等于体验版、审核或发布成功。确认云函数状态为 `trial` 后，由体验成员扫码进入；使用 `docs/wechat-miniapp/TRIAL_CHECKLIST.md` 留证。

18. **在真机触发真实订阅授权。** 体验成员从“补充 1 次通知”的直接点击处理器调用真实 `wx.requestSubscribeMessage`；不得在 `onLoad/onShow` 自动调用。验证 `accept/reject/ban/filter` 与 `20004/20005` 的 UI/服务端结果。只有 `accept` 的单次 grant intent 可让该 OPENID 的内部额度 `+1`；开发者工具模拟授权不计为证据。

19. **完成配对与一次真实 Codex 任务。** 小程序生成 6 位、10 分钟、一次性 code；在 Token M Desktop 的微信通知设置输入 code，确认 Desktop 原子保存一次性 credential，renderer/日志看不到它。随后完成一个真实 Codex 任务；确认同一 `eventId` 即使重试也只产生一个 task、至多一次 provider attempt，隐私模式记录不含 prompt、完整历史、工作目录或源代码。

20. **确认到达、锁屏、深链与额度。** 在真机前台、后台及锁屏场景检查微信服务通知实际到达、文案字段裁剪正确、点击后以 `taskId` 打开本小程序任务详情，且 `miniprogramState=trial` 跳到体验版。确认成功 `errcode=0` 后额度恰好 `-1`；明确失败释放 reservation，`unknown` 保留且不自动重发，额度为 0 时任务仍保存但不发消息。只有这些人工证据完成后才可标记 trial-ready；正式发布前将状态切为 `formal` 并重新走提交清单。

## Pepper 生成与真实配置校验

可分别执行两次以下命令生成不同值，并直接保存到密码管理器；不要把输出贴到 issue、聊天、终端录屏或仓库：

```text
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

真实配置只能在仓库外校验。`WECHAT_TEMPLATE_KEYWORD_MAPPING` 的值应为真实 mapping 文件压成一行后的完整 JSON，而不是文件路径。任何缺值、非法 state、HTTP/loopback origin、mapping 不一致都应阻止生产启动。

## 回滚

出现 credential 泄漏时先撤销受影响 desktop 或触发账户删除，再轮换相应 pepper；`DEVICE_SECRET_PEPPER` 不能静默轮换，否则所有 v1 credential 都会失效。出现模板/域名/发送异常时关闭 `notificationsEnabled` 或停止 gateway/function，保留 task persistence 与 redacted delivery 证据，不把 sender 改成 mock。回滚后再次执行 trial 真实路径。

## 官方依据

- [微信开发者工具项目配置文件](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)
- [微信 `wx.requestSubscribeMessage`](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)
- [微信发送订阅消息](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html)
- [微信小程序隐私协议开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html)
- [微信协同工作与发布](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)
- [CloudBase 通过 HTTP 访问云函数](https://docs.cloudbase.net/service/access-cloud-function)
- [CloudBase 云函数](https://docs.cloudbase.net/cloud-function/introduce)
