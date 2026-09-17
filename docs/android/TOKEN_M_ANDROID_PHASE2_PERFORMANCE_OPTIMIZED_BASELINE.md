# TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE

BASELINE_NAME: TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE
DATE: 2026-09-09
STATUS: FROZEN_STABLE_BASELINE

本文件冻结当前已经完成真实 Android 使用验证的稳定版本，作为 Phase 3 通知可靠性验收的唯一起点。这里记录的运行时结果来自用户提供的真实手机验收；本轮只做只读检查和文档记录，不以静态检查替代真实设备结论。

## 固定身份

REPOSITORY: D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery
ANDROID_SOURCE: D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery\apps\tokenm-android
APP_ID: __UNI__46C9063
PACKAGE: com.gary.tokenm
FRAMEWORK: uni-app x
RENDERER: VDOM
HBUILDERX: 5.24.2026081301
UNICLOUD_PROVIDER: Alipay
UNICLOUD_SPACE: tokenm-prod
UNICLOUD_SPACE_ID: env-00jy6pbiul92
ANDROID_BUILD_ROUTE: HBuilderX -> App-Android/iOS-云打包 -> DCloud Cloud Build
NATIVE_SDK_ROUTE: OUT OF SCOPE

## 已冻结的真实验收结果

PHASE1: PASS
PHASE2_BASE_UNIPUSH: PASS
HONOR_SYSTEM_NOTIFICATION: PASS
NAVIGATION_PERFORMANCE: USER VERIFIED RESOLVED
HONOR_VENDOR_PUSH: OFF
XIAOMI_VENDOR_PUSH: OFF
KNOWN_BLOCKERS: NONE for foreground/base-channel operation
NEXT_PHASE: PHASE3_NOTIFICATION_RELIABILITY_ACCEPTANCE

| Phase | 已验证项目 | 结果 |
| --- | --- | --- |
| Phase 1 | Android register/login | PASS |
| Phase 1 | Captcha | PASS |
| Phase 1 | Light theme | PASS |
| Phase 1 | Android ↔ Desktop pairing | PASS |
| Phase 1 | Desktop credential | PASS |
| Phase 1 | Desktop event | PASS |
| Phase 1 | tokenm-tasks persistence | PASS |
| Phase 1 | Android task list | PASS |
| Phase 1 | Android task detail | PASS |
| Phase 1 | Desktop list/status | PASS |
| Phase 2 | Android notification permission | PASS |
| Phase 2 | Runtime CID | PASS |
| Phase 2 | CID registration | PASS |
| Phase 2 | Push eligibility | PASS |
| Phase 2 | Push target selection | PASS |
| Phase 2 | at-most-once | PASS |
| Phase 2 | uniCloud getPushManager | PASS |
| Phase 2 | uni-push 2.0 sendMessage | PASS |
| Phase 2 | notificationProviderCode | 0 |
| Phase 2 | notificationStatus | submitted |
| Phase 2 | Honor Android system notification | REAL RUNTIME PASS |
| Performance | 首页 / 任务 / 电脑 / 设置切换 | USER VERIFIED RESOLVED |
| Performance | Android Cloud APK build | PASS |
| Performance | 实际 App 页面显示 | PASS |
| Performance | 当前已知功能 regression | NONE |

上述 Phase 2 结果证明的是基础 uni-push 2.0 channel 在已验证运行状态下能够完成：

Codex task completed -> Token M Desktop -> tokenm-desktop-http -> tokenm-tasks -> Push eligibility -> Push claim -> uniCloud.getPushManager() -> sendMessage() -> provider code 0 -> submitted -> Honor system notification.

这不等同于 Honor vendor offline Push 已通过，也不预先承诺进程被回收或最近任务划掉后的通知到达。

## 性能优化冻结范围

以下文件是本次只读检查确认的当前 Android 性能优化及其直接集成面。它们属于已经冻结的当前版本；本轮没有重新修改、回退或重构：

- apps/tokenm-android/components/tm-tab-bar/tm-tab-bar.uvue
- apps/tokenm-android/pages/dashboard/index.uvue
- apps/tokenm-android/pages/tasks/index.uvue
- apps/tokenm-android/pages/desktops/index.uvue
- apps/tokenm-android/pages/settings/index.uvue
- apps/tokenm-android/services/client-runtime.uts
- apps/tokenm-android/services/privacy-consent.uts
- apps/tokenm-android/services/tokenm-service.uts
- apps/tokenm-android/services/account-service.uts
- apps/tokenm-android/services/push-runtime.uts
- apps/tokenm-android/services/presentation.uts
- apps/tokenm-android/services/page-cache.uts
- apps/tokenm-android/services/navigation-perf.uts
- apps/tokenm-android/pages.json
- apps/tokenm-android/App.uvue
- apps/tokenm-android/main.uts

当前页面与缓存实现的静态边界如下：

- pages.json 使用自定义导航；核心栏目为首页、任务、电脑、设置，详情、配对、通知、权限等页面使用各自的页面路由。
- tm-tab-bar 通过 navigation-perf 的 navigateColumn 进入栏目页面；当前栏目切换行为和用户已验证的性能结果一起冻结。
- page-cache 维护四个有界、仅内存的页面快照：dashboard、tasks、desktops 的 stale-after 为 5 秒，settings 的 stale-after 为 15 秒。
- 快照支持已有内容先显示、后台刷新、同一快照的 in-flight 去重、账户/session 变更清理以及按资源失效；没有新增轮询、数据库缓存或 Native Tab 重构。
- client-runtime 在 App launch/show 和受保护页面进入时核对登录、隐私确认、系统通知权限与业务设备注册；普通栏目切换不重新启动 Push 初始化链路。
- navigation-perf 的时间值是生命周期/render-commit proxy，不是物理像素显示时间；本文件不新增设备时延声明。

## 当前 Push 相关文件与冻结边界

以下文件是本次只读检查确认的当前 Push client、Cloud provider、事件状态和 schema 相关文件：

- apps/tokenm-android/services/push-runtime.uts
- apps/tokenm-android/services/mobile-device.uts
- apps/tokenm-android/services/client-runtime.uts
- apps/tokenm-android/manifest.json
- apps/tokenm-android/AndroidManifest.xml
- apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core/push-notification.js
- apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core/application.js
- apps/tokenm-android/uniCloud-alipay/cloudfunctions/tokenm-co/index.obj.js
- apps/tokenm-android/uniCloud-alipay/cloudfunctions/tokenm-desktop-http/index.js
- apps/tokenm-android/uniCloud-alipay/cloudfunctions/tokenm-desktop-http/http-contract.js
- apps/tokenm-android/uniCloud-alipay/database/tokenm-tasks.schema.json
- apps/tokenm-android/uniCloud-alipay/database/tokenm-mobile-devices.schema.json

当前冻结的 Push contract：

- Android 在用户完成登录、当前隐私确认并主动开启通知后，获取官方 Push client identity，并通过官方身份接口完成绑定；Token M 业务设备记录不保存该 identity。
- Cloud backend 先持久化任务，再做 eligibility、target selection 和 at-most-once claim。
- 只有成功 claim 的请求才调用 uniCloud.getPushManager({ appId: __UNI__46C9063 }).sendMessage()。
- provider code 0 表示 uni-push provider 接受提交；submitted 不代表设备已经显示系统通知。
- 当前只使用基础 uni-push 2.0。Honor、Xiaomi、Huawei、OPPO、Vivo、Meizu、FCM 等厂商通道均不在本基线内。

## 当前 Cloud backend 状态

当前 Cloud backend 根目录为：

apps/tokenm-android/uniCloud-alipay

当前事件入口和逻辑边界为：

- tokenm-desktop-http 接收 Desktop 事件并调用 tokenm-core。
- tokenm-core 对 desktopId + eventId 做去重，先写入 tokenm-tasks。
- application.js 解析通知资格、执行原子 claim，并持久化 submitted、failed 或 skipped 状态及安全 provider diagnostics。
- push-notification.js 只封装当前基础 uni-push 2.0 的 request、getPushManager、sendMessage、超时和有界诊断。
- tokenm-co 提供 Android 端登录会话、任务、设置、设备和配对读取/写入。
- tokenm-tasks 与 tokenm-mobile-devices schema 保持当前状态机和资格字段约束。

本轮对上述 backend、schema 和 Cloud 配置只读检查，没有部署或调用新的生产 Push。

## 本轮冻结声明

ANDROID_SOURCE_CHANGE: NO
BACKEND_CHANGE: NO
PUSH_CODE_CHANGE: NO
DATABASE_CHANGE: NO
ANDROID_CHANGED: NO
SOURCE_CODE_CHANGED: NO
CLOUD_BUILD_REQUIRED: NO
CLOUD_BUILD_SUBMITTED: NO
HONOR_VENDOR_PUSH: OFF
XIAOMI_VENDOR_PUSH: OFF
AGENTS_MD: UNTOUCHED
WECHAT_CLOUDBASE: UNTOUCHED
COMMIT: NO
PUSH_GIT: NO
TAG: NO

本轮未执行任何业务代码修改、性能回退、Cloud backend 部署、厂商 Push 配置、签名/package/AppID 变更或 APK 重打包。现有工作区中在接管前已经存在的 tracked/untracked 状态全部保留；本轮不通过 reset、clean、stash 或批量删除来整理工作区。

## 信息边界

本基线和后续验收计划不记录 CID、credential、token、Push payload、任务正文或其他 secret。验收只记录用户可观察结果和 Cloud task record 中已有的安全通知诊断字段。

## 下一步

下一阶段文档：

docs/android/TOKEN_M_PHASE3_NOTIFICATION_RELIABILITY_ACCEPTANCE_PLAN.md

用户使用当前已经确认的 APK，按 Phase 3 方案依次执行前台、普通后台、锁屏、最近任务划掉、划掉加锁屏测试。每个场景使用一个新的真实 Codex task 和一个新的完成事件。本轮在文档完成后停止，不进入 Honor vendor Push 实现。
