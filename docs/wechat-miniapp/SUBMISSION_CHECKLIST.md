# Token M 微信小程序提交审核清单

本清单分开判断“开发可运行”“体验版真机通过”“可提交审核”“正式版可发布”。任何本地脚本、模拟器或 mock 通过都不能代替 AppID/EnvID 关联、模板可用性、真机授权、消息到达、锁屏展示、体验版深链或微信审核结论。

## A. 自动与仓库门禁

- [ ] `node wechat-miniapp/config/validate-platform-config.mjs` 通过。
- [ ] 合并 UI/云函数后 `node wechat-miniapp/config/validate-platform-config.mjs --integrated` 通过。
- [ ] `node wechat-miniapp/config/scan-secrets.mjs --self-test` 与 `node wechat-miniapp/config/scan-secrets.mjs` 通过。
- [ ] 仓库没有真实 AppID、EnvID、Template ID、AppSecret、CloudBase secret、pair/device pepper、access token 或 device credential。
- [ ] `project.config.json` 只含公共相对 root，真实 AppID 仅在被 ignore 的 `project.private.config.json`。
- [ ] production config 没有 `MOCK_SENDER`、mock fixture、`http://`、localhost、IP gateway 或开发者工具域名校验豁免。
- [ ] `git diff --check`、微信范围单测、root lint/test 与依赖锁文件审查通过；Critical/Major security finding 为 0。
- [ ] 包内只有需要的 miniprogram、cloudfunction、公开 assets/config；未打入真实私有配置、日志、测试 credential、根 `node_modules` 或 Desktop 用户数据。

## B. CloudBase 与安全门禁

- [ ] 真实 AppID 归属、CloudBase EnvID、环境地域和操作者权限已由第二人复核。
- [ ] 九个 collection 与 `config/database/collections.json` 完全一致。
- [ ] `config/database/indexes.json` 中每个索引已创建且状态为可用，任务游标索引方向正确。
- [ ] 九个 collection 已逐项应用 exact `read=false/write=false`；客户端直读与直写负向验证全部失败。
- [ ] 云函数仍在每个 action/query/mutation 执行 OPENID/desktop ownership 校验；规则不是唯一权限边界。
- [ ] `tokenm-api` 使用审查过的 lockfile 安装并部署；`config.json` 只请求发送订阅消息所需 OpenAPI 权限。
- [ ] 生产入口缺少 template/pepper/origin、非法 keyword mapping 或非法 state 时返回 `configuration_required`，不降级到 mock。
- [ ] 两个 pepper 不同、至少 32 字符、仅在云函数环境；日志不输出 env/request body/Authorization/OpenID/code/summary。
- [ ] Pair code 为均匀六位、10 分钟、一次性；pair 路由在读 session 前已限速，所有无效状态统一响应。
- [ ] Desktop bearer 只经 HTTPS header 发送，服务端只保存 HMAC；解绑后下一请求 401。
- [ ] same eventId 三次/并发只形成一个 task、至多一次发送与一次额度消耗；conflicting digest 返回 409。
- [ ] Privacy/ownership/quota/delete 测试通过，未知 provider 结果不自动重发，quota 不为负。

## C. 域名、函数与真实配置

- [ ] CloudBase HTTP 访问服务把 HTTPS 自定义域名触发路径 `/` 绑定到 `tokenm-api`，固定 Desktop API 为 `/v1/desktop/*`。
- [ ] 自定义域名完成所有权校验、备案（适用时）、DNS 与有效 TLS 证书；默认测试域名限制已阅读。
- [ ] Desktop `TOKEN_M_WECHAT_API_URL` 是纯 HTTPS origin，无 path/query/hash/账号信息；跨 origin redirect 被拒绝。
- [ ] 小程序只通过 `wx.cloud.callFunction` 访问业务 API，不把 `api.weixin.qq.com` 或 Desktop gateway 配成前端 request 域名。
- [ ] 真实 EnvID 与 Template ID 注入运行配置但不提交；`wx.cloud.init` 连接目标环境。
- [ ] 云函数环境变量与仓库外真实 keyword mapping 通过 production validator；体验版为 `trial`，正式版才为 `formal`。
- [ ] task 默认 90 天、pairing cleanup 24 小时、security/rate 30 天及所有 rate limit 与真实披露一致。

## D. 订阅模板与额度

- [ ] 一次性订阅模板已在真实小程序后台审核可用，服务类目、标题和用途与“Codex 任务完成提醒”一致。
- [ ] mapping 的每个 keyword 都来自该模板详情，类型与 `thing/phrase/time/date/...` 一致，不把示例 `thing1` 当成默认。
- [ ] `thing` 最多 20 字符、`phrase` 最多 5 个汉字，所有值去控制字符；privacy 消息不含 project/model/summary。
- [ ] `wx.requestSubscribeMessage` 只在用户点击“补充 1 次通知”的 handler 直接调用；没有 onLoad/onShow 自动申请、循环申请或模拟点击。
- [ ] `accept/reject/ban/filter`、`20004`、`20005` 和网络失败有明确 UI；只有 accept 的未消费 grant intent 增加一次内部额度。
- [ ] 文案没有把 `wx.getSetting({withSubscriptions:true})` 解释为剩余通知次数，也没有宣称 accept 有不可伪造的服务端证明。
- [ ] 只有 provider `errcode=0` 记 sent/消耗；43101/43107/43108/40037/47003 进入脱敏 delivery 状态并按契约释放或保留 reservation。

## E. 隐私、删除与审核内容

- [ ] `PRIVACY.md` 中运营者、生效日期、联系方式和实际处理地域已填写，所有 `<请填写…>` 已清零。
- [ ] 微信管理后台《小程序用户隐私保护指引》已声明 OpenID 账户关联、设备绑定、任务元数据、订阅授权、CloudBase、保留与删除；体验版指引也生效。
- [ ] 未请求头像、昵称、手机号、位置、通讯录或聊天记录；如果最终增加受保护接口，已更新声明和同意流程。
- [ ] UI 明确默认 privacy 不上传 prompt、完整对话/历史、cwd、源代码或 Codex 最终回复；full 仅增加 project/model/最多 600 字摘要/duration。
- [ ] Privacy task API 字段为 null 且 UI 不渲染内容 placeholder；日志与微信消息也不泄露这些内容。
- [ ] 清除历史后查询立即不可见并有 bounded physical cleanup；解绑立即撤销 credential；删除账户先 deleting/revoke 再分批物理删除。
- [ ] 清除、解绑、删除都有具体后果的二次确认；产品没有“完全匿名”“保证送达”“立即物理删除无限数据”等不实表述。
- [ ] About 页标明 Token M 非微信官方产品并提供真实联系入口。

## F. 体验版真机门禁

- [ ] 开发者工具导入目录为 `wechat-miniapp/`，AppID/roots 识别正确，`urlCheck=true`，编译与预览无错误。
- [ ] 上传代码使用可追溯版本号/说明；指定开发版已设为体验版，体验成员名单正确。
- [ ] 按 `TRIAL_CHECKLIST.md` 在至少一台真实 iOS 或 Android 微信客户端执行并保存时间、版本、设备与脱敏证据。
- [ ] 真机真实订阅弹窗完成 accept；reject、主开关关闭或至少一个非 accept 路径也已验证。
- [ ] 真机 6 位配对成功，credential 不出 renderer/日志；过期/错误/重复 code 均显示统一错误。
- [ ] 完成真实 Codex 任务后 task 保存；privacy 数据最小化、duplicate 幂等与 notification status 正确。
- [ ] 微信服务通知在前台/后台/锁屏按测试设备能力真实出现，字段正确，点击以 taskId 深链到体验版详情。
- [ ] `miniprogramState=trial` 已从 delivery/环境复核；没有误跳 developer/formal。
- [ ] 成功发送额度恰好 -1，明确失败不消耗，unknown 保留，额度 0 时 task 仍保存。

## G. 提交审核与正式发布

- [ ] 服务类目、订阅模板、隐私指引、页面能力、审核描述和截图相互一致；没有测试入口、测试账号依赖或无法理解的开发者文案。
- [ ] 所有主页面 loading/empty/error/offline/disabled 状态可用，320px 无横滚，触控、对比、safe area 与中文断行已人工检查。
- [ ] 上传版本在体验版回归后才提交审核；记录提交时间与版本。上传、体验版、提交审核、审核通过、发布五个状态没有混称。
- [ ] 审核反馈已逐项闭环；未经审核通过不标记 formal-ready。
- [ ] 发布前把真实云函数 state 改为 `formal`、重新部署并校验，随后用正式版执行一次授权、配对、任务、通知、深链、额度 smoke。
- [ ] 正式监控覆盖配置缺失、401/429、provider errcode、unknown reservation 与 cleanup backlog，日志仍只含 allowlist 字段。

## 官方平台复核入口

- [项目配置](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)
- [`wx.requestSubscribeMessage`](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)
- [发送订阅消息](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html)
- [隐私协议开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html)
- [协同工作与发布](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)
- [CloudBase HTTP 访问服务](https://docs.cloudbase.net/service/access-cloud-function)
