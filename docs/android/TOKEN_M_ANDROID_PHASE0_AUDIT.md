# Token M Android Phase 0 Audit

审计日期：2026-08-23  
审计范围：当前 Git 工作树、Token M Desktop、微信小程序与 CloudBase 后端、现有 UI、uni-app x / uniCloud / uni-id / uni-push 2.0、Android、荣耀与小米官方接入条件。  
本阶段只新增本审计文档，没有修改产品代码，没有部署、生产写入、真实推送、提交或推送 Git。

## 1. 冻结结论

Android v1 采用独立并行路线：

```text
Token M Desktop existing Stop Hook
        |
        +-- existing CloudBase / WeChat route (保持不变)
        |
        +-- new uniCloud transport
                -> uniCloud 支付宝云
                -> task 持久化
                -> uni-push 2.0
                -> Honor P0 / Xiaomi P1-compatible
                -> Token M Android (uni-app x, VDOM)
```

- Android 工程固定放在 `apps/tokenm-android/`，不创建新仓库。
- Android 与微信在开发阶段隔离；不双写旧 task，不迁移旧 task，不自动切换生产 Desktop target。
- 现有 Stop Hook、loopback forwarder/bridge、Desktop、CloudBase、微信小程序及微信通知链路全部保留。
- Android 新路径不复用旧 `completionEventId`。该旧字段由 `src/shared/codexCompletion.js` 中的摘要算法生成，违反本轮新路径的明确约束。新 route 从现有采集事件提取原始 `sessionId` / `turnId`，以显式、长度受限的 `evt:<sessionId>:<turnId>` 作为稳定 event ID，并在独立 outbox 中持久化；服务端以显式 `(desktopId,eventId)` 唯一约束实现幂等。
- 新路径不实现 payload digest，不以摘要生成 task ID，不以 HMAC 校验 Desktop credential。task 使用随机 ID；冲突直接逐字段比较允许字段；Desktop credential 使用一个服务端环境密钥进行 AES-GCM 加密存储并在认证时解密、常量时间比较。
- 冻结的 `uni-id` / `uni-id-co` 作为厂商身份组件使用。Token M 自有代码不新增摘要算法；厂商组件内部的密码和 token 实现属于依赖边界，不复制到 Token M domain 或 credential 设计中。
- Android 产品不迁移微信 quota、subscription grant、reservation、reconciliation、provider classifier 或 `-501001` 诊断链路。

## 2. Git 与工作树

| 项目 | 当前事实 |
|---|---|
| 仓库 | `D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery` |
| 分支 | `codex/wechat-integration` |
| HEAD | `32ddd91459aa27de7076c0f5227c4001a81dca29` |
| upstream | 相对 `origin/codex/wechat-integration` ahead 1、behind 0 |
| 已有用户改动 | `AGENTS.md` 已修改；本轮必须保留，不覆盖、不暂存、不回退 |
| diff 检查 | Phase 0 开始时 `git diff --check` 通过 |
| 受保护的本地资产 | ignored forensic、verification、recovery、zip 与 `tmp/` 资产均不触碰 |

`docs/wechat-miniapp/HANDOFF_RECOVERY.md` 中记录的旧 HEAD 和 shared fan-out 已过期：当前 production runtime 只有 WeChat enqueue，历史 fan-out 测试也不在当前树中。后续实现必须以当前源代码而非该历史描述为准。

## 3. 当前实际链路

1. Electron 只安装并维护一个 Codex Stop Hook。
2. Hook helper 读取受限 stdin JSON，通过带私有 token 的 loopback HTTP 调用主进程 bridge。
3. `tokenMNotificationRuntime` 目前规范化 completion 后只调用 `wechat.enqueue()`。
4. WeChat route 使用独立 credential、HTTPS client、durable outbox 与 CloudBase `/v1/desktop/*` API。
5. CloudBase 后端以微信 OPENID 建立 owner，持久化 task 后执行订阅消息 quota/claim/send/settlement。

Android route 的最小接点是第 3 步之后的独立 transport；不得再建 Hook，不得重写 collector，也不得修改微信 payload、credential、outbox 或 backend contract。

## 4. 可复用与不可复用边界

可复用：

- 单一 Stop Hook 的安装、迁移、卸载机制。
- loopback forwarder/bridge 的 method、path、token、body-size 边界。
- 原始 completion 事实与 privacy/full 字段裁剪意图。
- main-process-only transport 边界、受限 HTTPS client 模式、私有 credential store 模式。
- durable outbox 的产品语义：先落盘、有限队列、credential suspend、明确终态；Android 使用独立文件和独立实现。
- 微信小程序的页面信息架构、状态表达、文案节奏与设计 token。
- 现有 CloudBase 测试中的 pairing、ownership、privacy、duplicate/conflict 与 provider-unknown 行为作为语义参考。

不可直接复用：

- 旧摘要型 `completionEventId`、确定性 task ID、canonical digest、credential HMAC、pairing code digest。
- OPENID owner、`wx-server-sdk` repository、微信订阅消息 sender。
- quota、subscription grant、reservation、reconciliation、微信 provider classification。
- WXML/WXSS、微信 custom tab bar、`wx.requestSubscribeMessage`。
- 被历史提交删除的 PWA、Cloudflare/Worker 或 managed-notification 路线。

## 5. UI 基线与 Android 调整

现有小程序已形成稳定视觉语言：页面背景 `#07111f`，raised `#0a1727`，surface `#0d1b2b` / `#122238`，border `#20344d` / `#315071`，主/次/meta 文本 `#f2f7ff` / `#b4c2d4` / `#7f91a7`，accent `#3f86ff`，success `#47c99a`，warning `#f0b95b`，danger `#ef7181`。无渐变，少阴影，以背景层级和细边线分区。

Android 保持四个 bottom tabs：`首页 / 任务 / 电脑 / 设置`。页面包括 onboarding、登录/注册、permission onboarding、dashboard、tasks、task detail、desktops、pairing、notification settings、privacy、about。所有 VDOM 长页面显式使用根 `scroll-view`；样式用逻辑 px + flex，触控区域至少 48×48 px，并处理 status bar、system back 和 safe area。

微信专属的“通知额度”“补充次数”“订阅授权”不进入 Android。Android 页面显示两个独立事实：系统通知权限状态与 push registration 状态。`submitted` 只展示为“通知已发送/已提交”，不宣称终端已送达。

## 6. 工具链审计

| 工具/文件 | 状态 | 影响 |
|---|---|---|
| Node.js | `v24.15.0` | 满足仓库 Node >=22.13；可运行本地 domain/integration tests |
| npm | `11.12.1` | 可运行现有 root scripts |
| Git | `2.52.0.windows.1` | 可做只读审计和 diff；本轮不 commit/push |
| Java / javac | `24.0.1` | 已存在，但不能代替 Android SDK/HBuilderX toolchain |
| HBuilderX | 常见安装路径未发现，PATH 未发现 | 无法在本机编译/校验 uni-app x 原生 Android 包 |
| Android SDK / adb | 常见 SDK 路径与 PATH 未发现 | 无法安装 APK、采集 logcat 或运行真机步骤 |
| Gradle | PATH 未发现 | 不单独构建 Android 包；uni-app x 正式构建仍由 HBuilderX 管理 |
| 当前 uni-app x 文件 | 不存在 | Phase 1 新建标准工程 |
| 当前 `uniCloud-alipay` | 不存在 | Phase 2 新建并保持未绑定/未部署状态 |
| 当前 uni-id / uni-push 模块 | 不存在 | 需要通过官方 HBuilderX 插件/模块流程引入；不手写冒充官方模块 |

本机缺失项不阻止 UI、domain、schema、adapter、Desktop transport、测试与文档实现；只阻止原生编译、自定义基座、签名包和真机 E2E。

## 7. 2026 官方事实核对

访问日期均为 2026-08-23。

| 主题 | 官方事实 | 实现决定 | 仍需外部验证 |
|---|---|---|---|
| uni-app x 工程 | 项目标志为 `manifest.json` 中的 `uni-app-x`；页面为 `.uvue`；支付宝云目录为 `uniCloud-alipay`。[DCloud 项目结构](https://doc.dcloud.net.cn/uni-app-x/project.html) | 建立独立标准工程，VDOM 保持默认，不迁 Vapor | HBuilderX 实际导入与编译 |
| VDOM 滚动/导航 | VDOM App 页面默认不滚动，需显式 `scroll-view`；页面必须在 `pages.json` 注册，tab 页与非 tab 页使用不同导航 API。[页面](https://doc.dcloud.net.cn/uni-app-x/page.html)、[pages.json](https://doc.dcloud.net.cn/uni-app-x/collocation/pagesjson.html) | 四 tab 全注册；冷启动 click 等首页 ready 后导航 | 冷启动 callback 与页面栈真机时序 |
| 支付宝云绑定 | 项目通过 `uniCloud-alipay` 在 HBuilderX 中“关联云服务空间或项目”。[服务空间](https://doc.dcloud.net.cn/uniCloud/concepts/space) | repo 只声明目标 SpaceID `env-00jy6pbiul92`，不写 secret、不执行关联/上传 | DCloud 登录与目标空间权限 |
| Client API | uni-app x Android 支持 `uniCloud.callFunction`；复杂客户端业务官方偏向 Cloud Object。[callFunction](https://doc.dcloud.net.cn/uni-app-x/api/unicloud/function.html)、[Cloud Object](https://doc.dcloud.net.cn/uniCloud/cloud-obj.html) | mobile 使用 `tokenm-co` Cloud Object；Desktop 精确 REST 使用 URL 化普通云函数 | 支付宝云集成响应/子路径行为 |
| Desktop HTTP | URL 化云函数提供 method、path、headers、body 等集成请求信息。[URL 化](https://doc.dcloud.net.cn/uniCloud/http) | 单一 `tokenm-desktop-http` 分派四条 frozen-shape route | 仅在隔离开发空间做集成验证 |
| uni-id | `uni-id-co` 提供用户名密码注册/登录与 `setPushCid`；客户端 token 自动管理。[uni-id-co](https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-object) | 不自建密码系统；business ownership 只取认证 uid | 官方模块导入、captcha 与真实 session |
| Push client | uni-app x 仅支持 uni-push 2.0；`getPushClientId` 和 `onPushMessage` 会初始化 SDK；listener 多次注册会重复回调。[uni-push client](https://doc.dcloud.net.cn/uni-app-x/api/uni-push.html) | privacy consent 后才初始化；App 级单 listener；CID 交给 `setPushCid` | 重装、弱网、杀进程、OEM payload |
| Android 13+ | API 33+ 新安装的普通通知默认未授权，需声明并在恰当上下文请求 `POST_NOTIFICATIONS`。[Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission) | 登录和用途说明后，由用户 CTA 触发一次系统请求 | allow/deny/swipe-away/系统设置返回 |
| DCloud permission timing | HBuilderX 5.23+ 可用 `dcloud_push_auto_request_permission=false` 阻止框架自动弹窗，且不影响 CID；`onPushMessage.requestPermission` 默认 false。[uni-push client](https://doc.dcloud.net.cn/uni-app-x/api/uni-push.html) | 将 5.23 设为最低构建版本，业务控制弹窗时机 | merged manifest 真机检查 |
| Push server | `sendMessage` 可按 `user_id` 且 `check_token:true` 发送；provider 接受不等于设备已显示。[uniCloud push API](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html) | 一个 owner 一次 send；task 先保存；`submitted` 不等于 delivered | 真机系统通知才是 E2E 证据 |
| payload | 厂商离线 payload 应为短 Object，建议小于 800 字符。[uniCloud push API](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html) | 只发送 `{type:"task",taskId}` 与安全标题/正文；详情重新拉取 | Honor/Xiaomi click 数据形状 |
| 数据唯一约束 | 支持复合唯一索引；支付宝云索引项有 255-byte 限制。[数据库索引](https://doc.dcloud.net.cn/uniCloud/db-index.html) | `(desktopId,eventId)` 建复合唯一索引，不索引 summary | 目标空间实际数据库类型/索引语法 |
| 事务 | 支持显式事务；事务应短且 provider 调用放在事务外。[数据库事务](https://doc.dcloud.net.cn/uniCloud/cf-database.html#start-transaction) | task/delivery 创建与 delivery claim 原子化，push 在 commit 后调用 | 隔离开发空间的并发冲突行为 |
| 厂商通道 | 完整 Android 离线推送需包名、签名和自定义基座/正式包。[uni-push 开通](https://uniapp.dcloud.net.cn/uni-push/open.html)、[uni-push 2.0](https://uniapp.dcloud.net.cn/unipush-v2) | repo 仅准备配置面；不填假 AppID/secret/fingerprint | 正式签名包与真实设备 |
| 隐私合规 | 使用个推及厂商 SDK 前需在隐私说明中披露其处理信息类别。[uni-app x 合规](https://doc.dcloud.net.cn/uni-app-x/tutorial/compliance.html) | 同意前不初始化；文档列出 SDK 与最小数据目的 | 发布前法律/渠道最终文本审核 |
| Honor 分类 | 未获自分类权益或未带正确 `importance` 时，荣耀默认按资讯营销处理；服务通讯为 `NORMAL`、资讯营销为 `LOW`。[荣耀消息分类](https://developer.honor.com/cn/docs/11002/guides/notification-class) | Token M 可按用户主动任务进度申请“工作事项提醒”，但不能预判审核；公开 DCloud 文档未给出荣耀完整 options 外层 key/path，代码不得猜 | 自分类审核、当前 DCloud 样例/工单、锁屏/声音/震动真机证据 |
| Xiaomi 2026 | 2026-07-01 后新接入私信需模板；2026-08-01 后新 Channel 按新分类规则。任务进程可申请私信，但需审核。[小米分类新规](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2321)、[私信模板](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2314) | v1 只规划一个任务进程 Channel；私信同时携带批准的 channel/template，不传 task 详情 | Channel/模板审核及 HyperOS 真机 |
| Xiaomi 上架边界 | 小米官方要求应用完成公开上架，或企业内部应用走非公开上架，长期 sideload 不能作为离线 Push 发布方案。[未上架应用通知](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2057) | 代码保持 Xiaomi-compatible，但不能把本地 sideload 当作 Xiaomi E2E 条件 | 公开或企业非公开上架后的正式包 |

## 8. 新数据模型

业务集合使用统一 `tokenm-` 前缀，避免与 official collection 混淆：

- `tokenm-users`：owner 业务设置、notificationsEnabled、privacyConsentAt、historyClearedAt。
- `tokenm-desktops`：owner、name、status、encrypted credential、lastActivityAt。
- `tokenm-pairing-sessions`：owner、6 位 server-only code、10 分钟 TTL、单次消费、attemptCount/maxAttempts。
- `tokenm-tasks`：随机 task ID、显式 desktopId/eventId、允许的 task 字段、delivery 状态引用。
- `tokenm-mobile-devices`：最小 UI/管理镜像，不复制 CID；official CID 映射留在 `uni-id-device`。
- `tokenm-push-deliveries`：`pending/sending/submitted/failed/unknown/skipped_disabled/skipped_no_target`，attemptCount 最大 1。
- `tokenm-security-events`：不含 credential、code、token、payload 正文的安全事件。
- `tokenm-rate-limits`：短周期显式 scope/subject 计数，不使用摘要 key。

官方集合由 official uni-id/uni-push 模块创建和维护，包括 `uni-id-users`、`uni-id-device` 及它们当前实际依赖的 opendb collections。不得在 Token M 代码中复制 official CID mapping。

## 9. 后端边界

- `tokenm-co`：只供登录 Android client 调用；`_before` 从 uni-id token 得到 uid，所有查询和 mutation 强制 owner 条件。
- `tokenm-desktop-http`：URL 化普通云函数，保持 `/v1/desktop/pair|status|events|unpair-self` method/path/body/status shape。
- `common/tokenm-core`：两入口共享唯一 domain/application/repository；没有第二套 backend。
- Desktop pair 返回一次 `tm_uc_d1.<desktopId>.<secret>`；server 存储 AES-GCM ciphertext/iv/tag，key 只读环境变量。
- pair code 允许短期明文，仅 server-side、10 分钟、单次使用、最多尝试、有限全局/owner rate limit、不进日志。
- Desktop builder 以 `evt:<sessionId>:<turnId>` 形成显式 event ID；不读取 legacy 摘要 eventId。task 首次写入以 random `_id` 和 unique `(desktopId,eventId)` 完成；唯一冲突后读取已有记录并逐个比较 allowlisted 字段，返回 `duplicate` 或 `event_conflict`。
- task 与 delivery 先持久化；只有原子 `pending -> sending, attemptCount=1` 的执行者可调用 provider。明确受理为 `submitted`，明确拒绝为 `failed`，结果不确定为 `unknown`，不自动重发。
- push target 固定 `user_id=ownerId, check_token=true`；客户端或 Desktop 不能传 arbitrary CID。

## 10. 冻结文件级实施方案

```text
apps/tokenm-android/
  App.uvue
  main.uts
  pages.json
  manifest.json
  AndroidManifest.xml
  uni.scss
  components/
    tm-header/tm-header.uvue
    ui-state/ui-state.uvue
    status-marker/status-marker.uvue
    notice-banner/notice-banner.uvue
  pages/
    onboarding/index.uvue
    auth/login.uvue
    auth/register.uvue
    permission/index.uvue
    dashboard/index.uvue
    tasks/index.uvue
    task-detail/index.uvue
    desktops/index.uvue
    pairing/index.uvue
    notifications/index.uvue
    settings/index.uvue
    privacy/index.uvue
    about/index.uvue
  services/
    api.uts
    auth.uts
    presentation.uts
    push.uts
    session.uts
  types/api.uts
  fixtures/mock-states.uts
  static/icons/
  nativeResources/android/res/
  uniCloud-alipay/
    cloudfunctions/
      common/tokenm-core/
      tokenm-co/
      tokenm-desktop-http/
    database/
  tests/

src/electron/
  androidClient.js                 (新增)
  androidPayload.js                (新增)
  androidOutbox.js                 (新增)
  androidNotificationRuntime.js    (新增)
  tokenMNotificationRuntime.js     (最小组合修改)

src/shared/credentialStore.js      (新增固定私有 android credential path)
src/electron/main.js               (新增隔离 settings/IPC，保留微信字段)
src/electron/preload.js            (新增窄 Android IPC)
src/renderer/*                     (新增独立 Android 配对/status UI)
.env.example                       (新增公开 uniCloud HTTPS origin placeholder)
tests/electron/android*.test.js    (新增)
tests/electron/tokenMNotificationRuntime.test.js (双 route 隔离)

docs/android/
  TOKEN_M_ANDROID_PHASE0_AUDIT.md
  ARCHITECTURE.md
  DATA_MODEL.md
  API_CONTRACT.md
  PUSH_MODEL.md
  HONOR_SETUP.md
  XIAOMI_SETUP.md
  MANUAL_PREREQUISITES.md
  E2E_TEST_PLAN.md
  MIGRATION.md
```

不修改的 legacy：

- `docs/wechat-miniapp/**`
- `wechat-miniapp/miniprogram/**`
- `wechat-miniapp/cloudfunctions/tokenm-api/**`
- `src/electron/codexStopHook.js`
- `src/electron/codexHookForwarder.js`
- `src/electron/codexHookBridge.js`
- `src/shared/codexCompletion.js`
- 微信 credential/settings/outbox/API contract 及全部微信 provider/quota/reconciliation 文件

## 11. 验证分层

本地可重复验证：

- domain validation、ownership、pairing、AES-GCM credential、revoke、rate limit。
- duplicate/event conflict、随机 task ID、task persistence、delivery claim、submitted/failed/unknown、attemptCount 最大 1。
- Desktop client/payload/outbox/credential redaction、单 Hook 双 route 隔离。
- Android presentation、privacy projection、auth/permission/push state、allowlisted task click route。
- database schema/index 静态契约、API contract、root relevant regression、lint、`git diff --check`。

仅隔离开发空间可验证：

- official uni-id register/login/captcha/token/ownership。
- `setPushCid` 与 `uni-id-device` 多设备映射。
- 支付宝云真实索引、事务冲突、URL 化 path/status/header。
- uni-push 服务端受理与 error classification。

仅正式签名包 + 真机可验证：

- Android 13+ 权限四种路径。
- Honor 后台、锁屏、进程被回收后的系统通知及 click-to-task。
- Xiaomi/HyperOS 私信 channel/category/template 行为。
- 前台、后台、锁屏、最近任务划走、系统回收后的 payload 和 back stack。

## 12. 人工前置条件

后续代码可先完成；下列值缺失时只在 Phase 9 阻止 build/deploy/E2E：

- DCloud account 与 HBuilderX 登录。
- DCloud AppID。
- 正式 Android package name。
- release JKS/keystore、alias 与厂商要求的签名指纹。
- uni-push 2.0 开通，并将 AppID 与目标支付宝云空间关联。
- 目标空间 `env-00jy6pbiul92` 的开发/部署权限及隔离验证方案。
- official uni-id / uni-id-co / uni-push modules 的 HBuilderX 导入。
- `TOKEN_M_DESKTOP_CREDENTIAL_KEY`：32-byte 随机 AES key 的约定编码，放 uniCloud secret/environment configuration，绝不提交或打印。
- Honor 开发者认证、应用登记、Push 权益/credentials、通知自分类审核。
- Xiaomi 开发者认证、应用登记、Push AppId/AppKey/AppSecret、私信 channel/category/template 审核。
- 一台目标 Honor 真机；Xiaomi 真机用于 P1 compatibility 证据。

## 13. Phase 0 风险登记

1. 当前机器没有 HBuilderX、Android SDK 或 adb，因此不能在本轮本机证明 `.uvue` 编译或 APK 行为。
2. repo 没有 official uni-id modules；不能手写假模块。代码阶段会提供明确 integration seam，导入 official modules 是人工构建前置。
3. 目标支付宝云空间创建日期/数据库实现未知；schema 同时避免超长索引和 provider-specific TTL 假设，真实索引/事务仍需隔离空间验证。
4. 新 uni-id owner 与旧微信 OPENID owner 没有可信自动映射；本轮不迁移历史、不猜测合并。
5. Honor/Xiaomi 的包名、签名、credentials 和通知分类均未提供；任何 `sendMessage` 受理都不能作为 OEM 离线到达证据。
6. 旧 handoff 文档与当前 fan-out 实现不一致；后续测试必须证明单 Hook 下两 route 相互隔离。
7. 新 Android 事件不能沿用旧摘要 eventId。必须在 outbox 落盘前以显式 `sessionId + turnId` 建立独立、非摘要、稳定 event ID，防止 Desktop retry 触发第二次 push。
8. DCloud 当前公开资料没有给出荣耀 `options.android` 的完整外层 key/path。Phase 6 只能准备模块和人工配置面，不能猜字段；需以接入时的 DCloud 控制台样例或官方支持答复冻结实际 mapping。
