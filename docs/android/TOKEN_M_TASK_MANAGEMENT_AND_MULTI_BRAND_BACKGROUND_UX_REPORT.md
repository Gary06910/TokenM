# TOKEN_M_TASK_MANAGEMENT_AND_MULTI_BRAND_BACKGROUND_UX_REPORT

2026-09-13

```text
STATUS: TOKEN_M_TASK_MANAGEMENT_AND_MULTI_BRAND_BACKGROUND_UX_READY_FOR_CLOUD_BUILD

BASELINE:
  PHASE_1: USER_REPORTED_PASS
  PHASE_2: USER_REPORTED_PASS
  HONOR_FOREGROUND_BACKGROUND_LOCKSCREEN: USER_RUNTIME_VALIDATED_BASELINE
  RECENTS_SWIPE_AWAY: KNOWN_LIMITATION
  HONOR_VENDOR_PUSH: BLOCKED_BY_ACCOUNT_TYPE
  TAB_SWITCH_PERFORMANCE: USER_VERIFIED_RESOLVED_BASELINE

TASK_MANAGEMENT:
SINGLE_DELETE_INTERACTION: LONG_PRESS
WHY_SELECTED: 原生 longpress + ActionSheet + Modal，结构简单，无第三方手势依赖
CLEAR_ALL: 任务页顶部次要操作；明确当前账户全部任务记录，二次确认
DELETE_SEMANTICS: TOMBSTONE
TASK_TOMBSTONE_FIELD: userDeletedAtMs (long)
DEDUP_PRESERVED: YES
AT_MOST_ONCE_PRESERVED: YES
DELETED_TASK_CONTENT_MINIMIZATION: project/model/summary/durationMs=null; sessionId=''
LIST_TASKS_EXCLUDES_DELETED: PASS
GET_TASK_DELETED_BEHAVIOR: task_not_found；详情显示“任务不存在或已删除”
HOME_RECENT_EXCLUDES_DELETED: PASS
TODAY_COUNT_SEMANTICS: CURRENT_OWNER_TODAY_VISIBLE_COMPLETION_RECORDS
CLEAR_ALL_SCOPE: CURRENT_OWNER_ALL_VISIBLE_TASKS
NEW_EVENT_AFTER_CLEAR: VISIBLE
CROSS_USER_DELETE_PROTECTION: PASS
TASK_CACHE_INVALIDATION: PASS
BACKGROUND_REFRESH_RESURRECTION: NO
TASK_EMPTY_STATE: 暂无任务记录；完成新的 Codex 任务后，记录会显示在这里。

SETTINGS_LAYOUT:
BACKGROUND_PROTECTION_POSITION: AFTER_ACCOUNT
BRAND_SELECTOR: ActionSheet；用户始终可手动切换；本机记住上次选择
SUPPORTED_BRANDS: Honor, Xiaomi
HONOR_GUIDE: 启动管理、关闭自动管理、自启动、关联启动、后台活动、电池优化、联网、最近任务保护
HONOR_GUIDE_STATUS: USER_RUNTIME_VALIDATED
XIAOMI_GUIDE: 通知、后台自启动、无限制电池策略、后台联网、后台应用锁定
XIAOMI_GUIDE_STATUS: OFFICIAL_GUIDANCE_IMPLEMENTED_RUNTIME_PENDING
AUTO_MANUFACTURER_DETECTION: NO
MANUAL_OVERRIDE: YES
SYSTEM_VERIFIED_STATES: 系统通知权限；Android标准电池优化（支持时）
USER_CONFIRMED_STATES: 各品牌整组手动指引完成状态
LOCAL_STORAGE_FIELDS:
  tokenm.background-protection.brand.v1
  tokenm.background-protection.honor-guide-user-confirmed.v2
  tokenm.background-protection.xiaomi-guide-user-confirmed.v1
BRAND_CONFIRMATION_ISOLATION: PASS
CLOUD_CALLS_ADDED_BY_GUIDE: NONE
VENDOR_PUSH_SDK_ADDED: NONE
FOREGROUND_SERVICE: NONE
BACKGROUND_POLLING: NONE

DATABASE_SCHEMA_CHANGED: YES
PRODUCTION_BACKEND_DEPLOYMENT: PASS; named upload + download/readback equality
PUSH_SERVER_CHANGED: NO
CID_FLOW_CHANGED: NO
DESKTOP_CHANGED: NO
PERFORMANCE_CACHE_ARCHITECTURE_CHANGED: NO
PRIVACY_VERSION_CHANGED: NO
PRIVACY_VERSION_CHANGE_REQUIRED: NO
TESTS: PASS
HBUILDERX_COMPILE: PASS
APPRESOURCE_GENERATION: PASS
CLOUD_BUILD_REQUIRED: YES
CLOUD_BUILD_SUBMITTED: NO
ADB_USED: NO
NATIVE_SDK_USED: NO
HASH_USAGE: NONE
SHA256: NONE
SMOKE: NONE
WECHAT_CLOUDBASE: UNTOUCHED
AGENTS_MD: UNTOUCHED_BY_THIS_TASK
COMMIT: NO
PUSH_GIT: NO
TAG: NO
RUNTIME_ACCEPTANCE_REQUIRED: YES
```

这里的功能 PASS 来自本地行为测试、源码核对及部署回读，不是新 APK 真机验收。Honor 的运行验证状态引用用户提供的既有基线；本轮未重新测量手机通知。Xiaomi 尚未真机验证。

## 任务记录的安全语义

修改前已建立 `TASK_MANAGEMENT_AND_BACKGROUND_UX_PLAN.md`。审计发现旧 `clearTaskHistory` 会物理删除最多 100 条记录，再写账户时间水位隐藏剩余记录。本轮将它改为转调 `clearTasks`，隐私页与任务页因此使用同一安全清除操作。账户注销流程保持原样。

删除只更新任务行，不移除 canonical identity。保留 `_id`、ownerId、desktopId、eventId、event、schemaVersion、privacyMode、occurredAt、createdAtMs，以及全部 notification 状态、目标数量、尝试时间、结果时间和 provider 诊断字段。正文和会话展示数据最小化，不创建归档库或新事件指纹。

普通事件继续按原始字段判断重复/冲突。tombstone 的正文已清空，重复判断改用保留的 desktopId + eventId + event；返回原 taskId 的 duplicate，绝不再次进入通知发送流程。通知 claim/result、目标选择、sendMessage、CID、provider 模块均未修改。活动中的原有通知尝试可以按原流程完成；删除不会重置或新增尝试。

`deleteTask({taskId})` 和 `clearTasks({confirmation:'CLEAR'})` 经现有 uni-id `checkToken` 认证，owner 来自服务端上下文。输入不接受 ownerId。单删跨用户返回 task_not_found；重复删除同一用户的 tombstone 可安全幂等成功。

数据库查询在分页前排除 userDeletedAtMs 已设置的记录，absent/null 视为可见。保留旧账户历史水位的读取语义，避免旧版已隐藏记录重新出现，但新清除不再写水位。dashboard/bootstrap 使用数据库 count，避免原始 500 行读取上限截断可见计数。首页文案改为“今日完成记录 X 条”，明确统计可见历史，删除同步减少。

清除采用一次服务端 `where(ownerId + absent/null + createdAtMs <= clearedAtMs).update(patch)`。时间边界在服务端操作开始时固定，无客户端 N 次删除、后台队列或永久隐藏开关。更新覆盖执行时匹配的已存在记录，未来创建时间不匹配；完成后新事件正常可见。生产账户规模没有另行读取或宣称已测；该操作不受客户端列表页大小限制。官方批量条件更新依据见下方资料。

成功响应后才更新 UI/cache，失败保留现有列表。复用 PageSnapshot 原有 clear/seed/expire 与 revision/session 屏障，未修改 page-cache.uts 或性能架构；迟到的旧请求不能重新 seed。Home 的最近任务与计数同步修改；快照随后过期，使下一次读取可获取新事件。全部清除后筛选恢复“全部”，显示标准空状态。详情已删除错误有明确文本，不强制跳转或崩溃。

## 多品牌页面与资料

设置顺序为标题、账户卡片、后台通知保护、通知、隐私、应用。保护入口复用现有设置行样式，不作为顶部 hero。品牌步骤采用 `BackgroundGuide` / `BackgroundGuideStep` 简单结构。

没有读取 manufacturer，默认 Honor，用户可随时切换 Xiaomi。选择与确认仅写本机 storage。Honor 的旧分项确认不会被当作新增完整指引的完成证明，新整组确认使用 v2 key；旧 key 未删除。两品牌确认隔离。系统权限与标准电池优化继续使用既有公开 OS API；未知/不支持状态不伪装成已验证。

官方资料核对日期：2026-09-13。页面用核心设置目标配合已确认的机型路径，并明确不同系统版本名称可能不同：

- [荣耀后台应用重启说明](https://www.honor.com/cn/support/content/zh-cn00406916/)：启动管理、后台活动、电池优化及后台保护。
- [荣耀自动启动说明](https://www.honor.com/cn/support/content/zh-cn00414587/)：手动管理下的自启动、关联启动、后台活动。
- [Xiaomi 14T 后台自启动](https://www.mi.com/uk/support/faq/details/KA-507608/)：Settings → Apps → Permissions → Background autostart。
- [Xiaomi 15 后台联网与电池策略](https://www.mi.com/uk/support/faq/details/KA-538010/)：Settings → Battery → 对应应用 → No restrictions。
- [POCO X7 后台应用锁](https://www.mi.com/global/support/faq/details/KA-524441/)：Security → Settings → Boost speed → Lock apps；用于避免一键清理，不承诺主动关闭后存活。
- [REDMI Pad Pro 5G 数据使用](https://www.mi.com/global/support/faq/details/KA-517262/)：联网管理覆盖移动数据、Wi-Fi 和后台数据；页面将该路径标为部分版本入口。
- [HyperOS 自启动权限说明](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1624)：用户自行管理自启动权限。
- [DCloud 云函数数据库 API](https://doc.dcloud.net.cn/uniCloud/cf-database?id=start-transaction)：条件查询、count、字段条件与批量 update。

保护页自身及新增依赖没有 cloud/client-runtime/Push 调用。App 原有生命周期网络行为没有扩大。品牌确认从未上传或作为 Push eligibility 条件。无 Honor/Xiaomi 厂商 SDK、Foreground Service、WorkManager、AlarmManager 或保活连接。

## 文件范围

ANDROID_FILES_CHANGED（相对 apps/tokenm-android）：

- pages/tasks/index.uvue
- pages/task-detail/index.uvue
- pages/dashboard/index.uvue
- pages/settings/index.uvue
- pages/background-protection/index.uvue
- pages/privacy/index.uvue
- services/task-management.uts（新增）
- services/background-guides.uts（新增）
- services/background-protection-state.uts
- services/account-service.uts（只替换任务清除调用）

BACKEND_FILES_CHANGED（相对 apps/tokenm-android/uniCloud-alipay）：

- cloudfunctions/common/tokenm-core/application.js
- cloudfunctions/common/tokenm-core/repository-contract.js
- cloudfunctions/common/tokenm-core/repository-memory.js
- cloudfunctions/common/tokenm-core/repository-unicloud.js
- cloudfunctions/tokenm-co/index.obj.js
- database/tokenm-tasks.schema.json

测试：更新 tests/android 下 apiContract、backend、backgroundProtection、clientIntegration、performance、pushDelivery；新增 taskHistoryRepository.test.js。旧清除行为和旧入口位置断言随新需求更新。

pages.json、background-protection.uts 标准 OS helper、manifest.json、AndroidManifest.xml、page-cache.uts、导航、Auth、Push、Desktop、task 唯一索引及 AGENTS.md 均与本轮修改前逐文件字节一致。HBuilderX 自行生成 ignored unpackage 产物，未手改生成 Kotlin。开始时已有的 Git 修改均保留。

## 测试、编译与部署证据

- `npm run verify`：lint PASS；3530 tests，3525 PASS，0 FAIL，5 既有 SKIP。日志：tmp/task-management/verify.log。
- 最终清除空状态小改后，缓存/交互/数据库定向测试 25 PASS。日志：tmp/task-management/final-focused.log。
- 云端回读后 Android 全套 142 PASS，0 FAIL。日志：tmp/task-management/post-deploy-tests.log。
- 覆盖单删确认与取消、失败保留、跨 owner 拒绝、完整内容清空、列表/详情/首页不可见、旧事件重提不新增任务/Push、全部通知状态保留、单次服务端更新、未来事件、清除后新任务、缓存迟到响应、详情错误、品牌持久化/隔离、真实 OS 状态和无云调用。MemoryRepository/VM/mock OS 是测试环境，不是手机遥测。
- `git diff --check`：PASS。冻结文件逐字节比较，无摘要计算。
- HBuilderX 5.24.2026081301、uni-app x VDOM：20:54:13.415 编译成功；20:54:13.584 AppResource 导出成功。日志：tmp/task-management/appresource-final.log。
- 官方单文件 UTS→Kotlin 附加校验：20:55:51.777 PASS。临时文件拼接实际 models、PageSnapshot、applyTaskHistoryDeletion 和品牌状态/步骤代码；仅账户读取替换为无网络 stub，未覆盖完整云调用或页面模板。日志：tmp/task-management/kotlin-validation.log。完整 App 模板由前述 AppResource 编译检查。

生产部署目标为现有支付宝云 `tokenm-prod`：

1. tokenm-tasks.schema.json：upload --force SUCCESS。
2. tokenm-core：upload --force SUCCESS；HBuilderX 自动更新依赖该公共模块的云函数。
3. tokenm-co：upload --force SUCCESS。
4. 下载回读 core/co/schema：JS 字节一致，JSON 结构一致。
5. 下载回查 tokenm-desktop-http：HTTP entry/contract/package 与本轮原始内容字节一致。没有单独修改或上传它的 Push 逻辑；它只受公共模块依赖自动同步影响。

部署日志位于 tmp/task-management/deploy-*.log，回读日志位于 readback-*.log。未调用生产 deleteTask/clearTasks 制造测试数据，未重提旧事件，未删除 CID 或修改生产设备。targetCount=2 的生产清单仍未核实，不阻塞本轮。

早先 HBuilderX 启动/CLI 连接无响应，后已恢复。一次帮助命令被自动审批以“工作区额度不足”拒绝；用户要求继续后执行恢复，全部必要编译与部署现已完成。没有绕过拒绝或修改 HBuilderX 配置。

## 云打包与用户验收

AppResource：`apps/tokenm-android/unpackage/resources/app-android`。

保持 AppID `__UNI__46C9063`、包名 `com.gary.tokenm`、VDOM 和原 release signing。由用户自行 Cloud Build；本轮未提交。

新 APK 安装后：

1. 长按任务，取消一次确认，确认记录仍在；再次长按并确认删除，确认立即消失。
2. 重新进入任务页并刷新，确认不恢复；完成一个新的真实 Codex task，确认正常出现。
3. 有筛选时点击清除全部，确认清除整个账户历史、显示空状态；再完成新任务，确认出现。
4. 设置中确认保护入口位于账户下方；切换 Honor/Xiaomi，检查步骤变化，退出重进确认选择保留。
5. 分别确认/撤销两品牌指引，确认状态不串用；系统通知与电池状态仍来自本机真实设置。
6. 一个新的真实 Codex task 验证 Tasks、前台通知、普通后台及锁屏。主动划掉仍允许 FAIL，属于当前已知限制。Xiaomi 运行验收仍待用户设备证明。
