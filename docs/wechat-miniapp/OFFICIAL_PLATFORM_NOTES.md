# Token M 微信小程序官方平台调研

状态：`FROZEN v1`  
核验日期：2026-08-18（Asia/Shanghai）  
来源范围：微信开放文档、腾讯 CloudBase 官方文档、腾讯云官方文档。关键规则不以博客为唯一依据。

## 1. 登录与 OPENID

- 微信标准登录流程是 `wx.login()` 获取一次性 `code`，服务端通过 `auth.code2Session` 换取 OpenID、可选 UnionID 与 `session_key`。`session_key` 不得下发客户端，登录 `code` 只能使用一次。[微信官方：小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)
- 本项目使用微信云开发，不自行把 `code` 或 `session_key` 暴露给业务层。小程序通过 `wx.cloud.callFunction` 调用云函数；云函数在每次 `exports.main` 调用内执行 `cloud.getWXContext()`，以 `OPENID`/`APPID` 建立或解析用户身份。不得在 `exports.main` 外缓存调用上下文。[微信官方：Cloud.getWXContext](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/reference-sdk-api/utils/Cloud.getWXContext.html)
- 数据库中的业务 `userId` 是服务端生成的内部标识；OpenID 只保存在拒绝客户端直读的 `users` collection 中，不返回给小程序。

## 2. `wx.cloud` 初始化与调用

- 原生小程序在 `App.onLaunch` 中执行一次 `wx.cloud.init({ env })`；EnvID 由配置文件注入，仓库不提交真实 EnvID。[微信官方：Cloud.init](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/reference-sdk-api/Cloud.init.html)
- 小程序业务请求统一使用 `wx.cloud.callFunction`，不直接读写敏感 collection。这样所有 ownership、额度、配对和删除规则都由云函数执行。[微信官方：Cloud.callFunction](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/reference-sdk-api/functions/Cloud.callFunction.html)

## 3. Cloud Functions

- CloudBase 云函数是无服务器、无状态、可弹性扩缩的服务，可由 SDK、HTTP 或定时触发。[CloudBase 官方：云函数](https://docs.cloudbase.net/cloud-function/introduce)
- 项目使用一个 `tokenm-api` Node.js 云函数，承载小程序 action、Desktop HTTP 路由和维护 action；核心逻辑按模块拆分并依赖注入 repository/sender，避免生产逻辑被测试 mock 替代。
- 云函数实例可能复用，不能把某次调用的 OPENID、请求或 credential 保存在模块级可变变量里；身份必须在每次 handler 调用时重新解析。[CloudBase 官方：函数调用概述](https://docs.cloudbase.net/api-reference/webv3/functions)

## 4. Desktop 的 HTTP 访问

- CloudBase 可把云函数绑定为标准 HTTP 接口。生产推荐绑定已备案、带有效 TLS 证书的自定义域名；默认域名适合开发/测试且可能有有效期、频率或稳定性限制。[CloudBase 官方：通过 HTTP 访问云函数](https://docs.cloudbase.net/service/access-cloud-function)；[腾讯云官方：HTTP 访问服务](https://cloud.tencent.com/document/product/876/122894)
- HTTP 网关会把 `path`、`httpMethod`、`headers`、`body`、`isBase64Encoded` 等传给云函数。Desktop 只使用 HTTPS；仅自动化测试允许 loopback HTTP。
- Desktop endpoint 是服务 origin + 固定路径，不是每用户 webhook。朋友正常配对只输入 6 位 code；服务 origin 应由部署者预配置，未预配置时才显示高级地址字段。

## 5. `wx.requestSubscribeMessage`

- API 从基础库 2.4.4 起支持。2.8.2 起必须在用户点击或支付回调之后调起，不能在 `onLoad/onShow` 自动调用或循环调用。[微信官方：wx.requestSubscribeMessage](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)
- 当前官方页允许一次最多传 5 个 template ID；本项目固定只传 1 个一次性模板，避免同标题过滤与误导性批量索权。
- 单个 template 的结果为 `accept`、`reject`、`ban` 或 `filter`。只有 `accept` 才能完成一条内部 grant；其他结果必须显示明确状态且不增加额度。
- 错误 `20004` 表示用户关闭订阅消息总开关，`20005` 表示小程序订阅能力被封禁；二者不是网络重试场景。
- `wx.getSetting({ withSubscriptions: true })` 只返回用户勾选过“总是保持以上选择”的订阅状态；可读取 `subscriptionsSetting.mainSwitch` 和 `itemSettings`，但不能据此推导剩余一次性次数。[微信官方：wx.getSetting](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/setting/wx.getSetting.html)

## 6. `subscribeMessage.send`

- 发送接口必须在服务端调用，禁止从小程序前端直接调用。微信云函数可通过 `cloud.openapi.subscribeMessage.send` 调用，无需把 AppSecret 放入客户端。[微信官方：发送订阅消息](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html)
- 必填/关键字段：`touser`、`templateId`、`data`、`page`、`miniprogramState`、`lang`。`page` 只能跳转本小程序页面并可带参数。
- `miniprogramState` 必须显式配置为 `developer`、`trial` 或 `formal`。体验版真实测试使用 `trial`，正式版才使用 `formal`。
- 模板字段长度由类型约束：例如 `thing` 最多 20 个字符，`phrase` 最多 5 个汉字。代码必须按字段类型裁剪且拒绝控制字符；部署者须填写与真实模板匹配的 keyword mapping。
- `errcode = 0` 才视为 provider 接受。`43101`（用户未订阅/次数用尽）、`43107`（能力封禁）、`43108`（同用户并发发送）、`40037`（模板 ID 非法）、`47003`（模板 data 非法）都必须持久化到 delivery；不得无脑扣 quota 或无限重试。

## 7. 一次性订阅与内部额度

- 一次性订阅由用户自主授权，一次有效授权允许后续发送一条对应服务消息，发送时间不受本项目人为窗口限制。[微信官方：小程序订阅消息](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html)
- 微信客户端只返回授权结果，业务服务端无法从普通 `callFunction` 请求中获得不可伪造的“弹窗确实点击 accept”证明。因此内部 quota 是 UX shadow ledger，不是权限边界；服务端通过短期、单次 grant intent、固定模板、OPENID 绑定、幂等键与速率限制约束 mutation，微信发送接口仍是最终权威。
- 配额并发安全通过服务端事务实现。CloudBase 事务具备 ACID，只支持服务端 Node SDK；事务内不调用外部 API。[CloudBase 官方：数据库事务](https://cloud.tencent.com/document/product/876/48442)；[CloudBase 官方：Transaction Operations](https://docs.cloudbase.net/en/database/transaction)

## 8. 体验版行为

- 体验成员可使用体验版但不必成为项目成员；管理员及项目成员可管理体验成员。一个开发版本可被设置为体验版。[微信官方：小程序协同工作和发布](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)
- 发布流程是预览 → 上传代码 →（可设体验版）→ 提交审核 → 发布。上传并不等于审核或发布成功。
- 订阅消息指向体验版时，发送参数必须使用 `miniprogramState: "trial"`；真实授权和锁屏通知需要真机验证，开发者工具模拟结果不能替代真机结果。

## 9. 隐私保护指引

- 涉及处理个人信息的小程序必须在管理后台配置《小程序用户隐私保护指引》；只有声明过的个人信息类型才能调用相应隐私接口/组件。自 2023-10-17 起隐私相关能力默认启用。[微信官方：小程序隐私协议开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html)
- 如使用受保护隐私接口，应通过 `wx.getPrivacySetting`、`open-type="agreePrivacyAuthorization"` 或官方隐私弹窗同步同意状态。体验版测试隐私能力也需要在后台配置体验版隐私指引。
- Token M 不请求头像、昵称、手机号、位置、通讯录或聊天记录。隐私说明仍需披露 OpenID 关联账户、设备绑定、任务元数据、订阅授权状态、保留期限、删除方式和 CloudBase 处理目的。

## 10. 用户数据要求

- 采用目的限制和最小化：默认隐私模式不上传 prompt、完整对话、cwd、源代码或 last assistant response；完整模式也只允许 project、model、summary 等显式字段，不上传完整历史。
- 用户可在设置中清除任务记录、解绑电脑并查看数据与隐私说明。清除后查询立即不可见，后台 cleanup 完成物理删除；解绑须立即使 device credential 失效。
- OpenID、credential hash、security event 等敏感字段不返回客户端，日志只记录短标识/哈希和机器错误码。

## 11. 网络域名

- `wx.request` 等网络 API 只能访问后台配置的域名；生产必须 HTTPS/WSS，不能配置 IP 或 localhost，域名需备案。AppSecret 只能留在后台，`api.weixin.qq.com` 不可作为小程序请求域名。[微信官方：网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)
- 开发者工具的“不校验合法域名/TLS/HTTPS 证书”只能临时调试。提交与真机验收必须关闭该选项。
- 本项目小程序业务只用 `wx.cloud.callFunction`，通常无需为业务 API 再配置 request 域名；Desktop HTTP gateway 仍须使用公网 HTTPS origin。

## 12. 微信开发者工具限制与配置

- `project.config.json` 保存公共项目配置；同名字段由 `project.private.config.json` 优先覆盖，后者适合本地 AppID 等个人配置并应加入 `.gitignore`。[微信官方：项目配置文件](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)
- `miniprogramRoot` 与 `cloudfunctionRoot` 使用相对路径。本项目导入根目录固定为 `wechat-miniapp/`。
- `urlCheck` 在正式验收必须开启；不能因开发者工具跳过校验而宣称真机可用。
- 开发者工具模拟器不能证明订阅弹窗、体验版消息跳转、锁屏通知或服务通知到达；这些项保留为人工真机 gate。

## 13. 上传、体验版与审核前必需项

- 需要真实 AppID、CloudBase EnvID、已创建 collections/indexes、已部署函数、HTTP gateway、真实一次性订阅模板及 keyword mapping、体验成员和管理后台隐私指引。
- 开发者工具上传后，需在小程序管理后台版本管理中选择开发版本设为体验版；提交审核与发布是后续独立动作。[微信官方：小程序协同工作和发布](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)
- 审核前必须核对服务类目与订阅模板内容的匹配、隐私声明、用户数据删除入口、页面可用性、无测试 endpoint/localhost/mock sender、无 AppSecret/credential、体验版真实路径与错误状态。

## 14. 调研边界与待真机验证项

以下不能由本地代码或 mock 证明：真实 AppID/Env 关联、模板审核可用性、CloudBase HTTP gateway 公网可达、`requestSubscribeMessage` 真机弹窗、`subscribeMessage.send` 真正到达、锁屏展示、体验版深链、微信审核结论。它们在 `DEPLOYMENT.md` 与 `SUBMISSION_CHECKLIST.md` 中作为人工 gate，不会被标记为自动验证通过。
