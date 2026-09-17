# TOKEN_M_ANDROID_UI_REFINEMENT_REPORT

STATUS: TOKEN_M_ANDROID_UI_REFINED_READY_FOR_CLOUD_BUILD
MODEL: GPT-6
BASELINE: TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE
BASELINE_PRESERVED: YES

UI实施和Android专项验证已完成。后续经用户授权，已修复范围外用量测试的日期断言；最终全仓verify通过（3534 PASS、0 FAIL、5 SKIP）。Android相关150项、lint、静态边界检查和官方AppResource编译均通过，用户可以自行Cloud Build验收；完整APK release Kotlin和真机结果仍待用户。

DESIGN_DIRECTION:
保留浅色、蓝色和现有五个共享组件，采用安静的生产力工具风格；依靠分组、留白、字号和文字状态完成统一。

CURRENT_UI_ISSUES:
1. 通知/权限页残留“Phase 1 不发送Push”的过时说明。
2. 首页将登录、隐私、权限、设备注册四项事实重复放在首屏。
3. 任务筛选占据首屏；隐私任务内容空白容易被理解为缺失。
4. 设备时间重复，重命名与解绑权重相同。
5. 配对成功后仍显示旧码和倒计时。
6. 设置未分组，技术说明多；输入间距及返回/状态样式缺少统一。

GLOBAL_VISUAL_SYSTEM:
- colors：背景 #f4f7fb，白色surface，次级surface #edf3fa，主文字 #172033，次级 #475569，caption #596b82；accent统一 #2869c9；success/warning/error 保留语义用途。
- typography：系统字体；页面24/32，区块/卡16/24，正文14/22，次级13/20，caption12/18；配对码32/44。
- spacing：页面16，卡16，区块24，标签16/8；保留至少48点击区域。
- radius：小6，按钮/输入10，surface16；导航选中背景12。
- surfaces：浅背景上的白色分组，无新增阴影或大图。
- buttons：主蓝白字、次级中性边线、文字动作、危险动作文字红且边线中性。
- status：复用status-marker，文字承担语义，色点辅助；完成状态和通知状态分开。

NAVIGATION:
BEFORE: 4栏目、64高、几何图形加11px文字、safe-area。
AFTER: 路径/items/switchTab完全保留；12px文字和加粗选中态、浅色背景、更稳定间距。返回继续用“返回”文字。

HOME:
BEFORE: 通知四事实清单、电脑在前、近期任务在后。
AFTER: 真实开关与准备状态摘要、今日完成/已绑定数量、最多3条最近任务、最多3台电脑；通知入口弱化。关闭任务通知不会被权限ready误判为已开启，绑定数不冒充在线数。

TASKS:
BEFORE: 3组常驻筛选、平铺小标题、通知状态作为主要状态。
AFTER: 常用内容筛选保留，电脑/通知筛选本地折叠；白卡明确任务已完成、电脑、时间、通知；隐私模式显示“未同步任务内容”。条件筛选/分页/缓存行为保留。

TASK_DETAIL:
BEFORE: 时间通知重复、混合字段表。
AFTER: 完成标题、电脑与时间、通知状态及说明、任务信息、隐私分组。submitted显示“通知已发送”，说明仍为“推送服务已接受发送请求”，不等同于每条手机必然送达。内部诊断不进入模板。

DESKTOPS:
BEFORE: 重复最后在线、各半宽重命名/解绑。
AFTER: 16px卡片留白、名称层级提升、保留一次最后在线和最近任务时间；解除绑定减弱。原卡片已经包含查看/管理信息，因此没有新增详情路由或接口。

PAIRING:
BEFORE: 24px配对码；成功后旧码仍显示。
AFTER: 32px六位码、明确有效时间；成功后隐藏码与步骤，显示“查看已绑定电脑”。“取消并返回电脑列表”仅沿用离开页面行为，明确提示码仍在原有效期内可用，不冒充服务端撤销。轮询、计时、刷新确认、复制和停止定时器未变。

SETTINGS:
BEFORE: 四事实卡、开关、长说明及入口混排。
AFTER: 账户摘要、通知、隐私、应用分组；开关同时有文字状态；系统权限与通知服务可查，电脑/隐私/关于入口全保留；退出确认未变。普通箭头改为查看/管理文字。

PERMISSION_ONBOARDING:
BEFORE: 装饰+三步骤+六事实重复，正常用户仍提示初始化。
AFTER: 删除重复步骤；保留真实状态清单及backend不可用状态，不将未知显示为零；准备完成时进入App突出；权限请求仍只由原CTA触发。scroll-view及flex约束保留，介绍页移除620px固定最小高度。

LOGIN:
BEFORE: 28px顶部，风控技术长说明。
AFTER: 24px统一品牌/表单间距，验证码短说明。脚本、图片尺寸/格式/事件、密码与登录合约原样。

REGISTER:
BEFORE: 与登录间距不同，uni-id-co/register实现说明。
AFTER: 同一表单语言与间距，说明“输入图片中的字符”；注册逻辑、密码策略、官方验证码流程原样。

LOADING_STATES:
首次使用现有静态骨架；四栏目cached-first和后台刷新不变；刷新失败保留内容与banner；分页局部加载。修复ui-state中两个连续v-else为明确empty条件。
EMPTY_STATES:
尚无任务+完成Codex任务说明；筛选空结果与无任务分开；尚未绑定电脑+配对CTA。
ERROR_STATES:
presentError映射保留；任务/电脑/设置首次错误重试、缓存更新banner和分页重试保留；不显示raw provider/CID等信息。
ICON_STRATEGY:
沿用已存在的view几何图形与文字，未新增图标资源、iconfont或字体。全仓检查发现第三方uni-id-pages-x-icons模块含uni-id-icon，uni-scss有伪元素；当前13页面、main/App与5个共享组件未引用这些图标/样式，最终AppResource中未发现uni-id-icon/iconfont依赖。Desktop CSS伪元素属于冻结范围，不改动。未删除官方模块。
PRIVATE_GLYPH_DEPENDENCY: NONE

PERFORMANCE_ARCHITECTURE_CHANGED: NO
NETWORK_CALL_GRAPH_CHANGED: NO
NAVIGATION_CACHE_CHANGED: NO
PAGE_SNAPSHOT_CHANGED: NO
PUSH_SERVER_CHANGED: NO
PUSH_CLIENT_BEHAVIOR_CHANGED: NO
AUTH_BEHAVIOR_CHANGED: NO
PAIRING_BEHAVIOR_CHANGED: NO
BACKEND_CHANGED: NO
DATABASE_CHANGED: NO

NETWORK_CALL_GRAPH:
- Home：原prepareClientPage/settledRuntimeFacts → getDashboard →既有snapshot。
- Tasks：原ensureProtectedClientRoute → listTasks，复用desktopsSnapshot或既有listDesktops fallback。
- Desktops：原ensureProtectedClientRoute → listDesktops。
- Settings：原prepareClientPage/settledRuntimeFacts → getNotificationSettings。
- warm onShow：restoreCached后发起原有非await页面刷新；未增加bootstrap或任何网络函数。
比较方法：修改前保存69文件原始内容，最终逐字节比较48个冻结文件；19个uvue脚本仅允许任务页新增本地showFilters ref、权限页一处按钮标签字符串，其余规范化换行后完全相等。presentation.uts仅字符串字面量改变，分支/返回结构/隐私清理逻辑相同。Auth、Push、backend/schema、manifest、AppID/package、PageSnapshot和AGENTS全部保持。证据见tmp/ui-refinement/boundary-check.json与before.json；不使用文件指纹。

FILES_CHANGED:
- apps/tokenm-android/App.uvue
- apps/tokenm-android/components/notice-banner/notice-banner.uvue
- apps/tokenm-android/components/status-marker/status-marker.uvue
- apps/tokenm-android/components/tm-header/tm-header.uvue
- apps/tokenm-android/components/tm-tab-bar/tm-tab-bar.uvue
- apps/tokenm-android/components/ui-state/ui-state.uvue
- apps/tokenm-android/pages/about/index.uvue
- apps/tokenm-android/pages/dashboard/index.uvue
- apps/tokenm-android/pages/desktops/index.uvue
- apps/tokenm-android/pages/login/index.uvue
- apps/tokenm-android/pages/notifications/index.uvue
- apps/tokenm-android/pages/onboarding/index.uvue
- apps/tokenm-android/pages/pairing/index.uvue
- apps/tokenm-android/pages/permission/index.uvue
- apps/tokenm-android/pages/privacy/index.uvue
- apps/tokenm-android/pages/register/index.uvue
- apps/tokenm-android/pages/settings/index.uvue
- apps/tokenm-android/pages/task-detail/index.uvue
- apps/tokenm-android/pages/tasks/index.uvue
- apps/tokenm-android/services/presentation.uts
- apps/tokenm-android/uni.scss
- tests/android/clientStructure.test.js：只更新旧阶段文案断言，行为断言保留。
- tests/android/uiRefinement.test.js：新增6项结构回归。
- docs/android/TOKEN_M_CURRENT_UI_AUDIT.md
- docs/android/TOKEN_M_ANDROID_UI_REDESIGN_PLAN.md
- docs/android/TOKEN_M_ANDROID_UI_REFINEMENT_REPORT.md
- docs/android/TOKEN_M_UI_RUNTIME_ACCEPTANCE_CHECKLIST.md
- tmp/ui-refinement：本轮基线、实施辅助脚本和验证日志，不被应用导入。
HBuilderX自行更新unpackage生成物，未手工编辑生成代码。现有其他tracked/untracked变更原样保留。

NEW_COMPONENTS: NONE
REMOVED_COMPONENTS: NONE

TESTS:
- 修改前Android/Android-Desktop：144/144 PASS。
- 修改后同范围加6项UI结构检查：150/150 PASS。
- 既有性能行为测试覆盖账户隔离、缓存清理、stale refresh、去重和延迟响应；全部PASS。
- lint：PASS（npm run verify中的npm run lint）。
- git diff --check：PASS。
- 静态宽度：360/400/480px；页面16边距，筛选按钮上限280px，验证码区域不变，配对码六位加空格在最窄卡片内；长电脑名允许换行。该结论为布局约束检查，非真机截图或字体缩放验收。
- 对比度：白色背景上主文字16.27、次级7.58、caption5.45、accent5.31、语义色最低5.03；均高于4.5。点击区沿用48/64px，状态不只靠颜色。
- 首轮全仓npm run verify（历史结果，已由下方后续验证更新）：3538项，3532 PASS、1 FAIL、5 SKIP。失败tests/shared/codexUsageRegression.test.js:56，预期month=320而实际0；单独重跑同样失败。测试依赖src/shared/collector而不引用Android源码，其文件及采集实现不属于本轮变更。未更改日期、夹具、采集代码或跳过失败以制造全绿。现象与测试内2026-08-17固定日期/当前宿主时钟有关，具体修复未在本轮扩展调查。

NAVIGATION_PERFORMANCE_REGRESSION: NONE
范围：源码调用图与现有缓存行为测试；本轮实际warm-switch时延仍待用户测。

HBUILDERX_COMPILE: PASS
APPRESOURCE_GENERATION: PASS
HBUILDERX_VERSION: 5.24.2026081301（安装ReleaseNote首条和5.24编译日志核对）
验证命令：官方cli publish app-android --type appResource --project apps/tokenm-android。
最终日志：tmp/ui-refinement/hbuilderx-final.log，01:19:46编译/导出成功，uni-app x VDOM。
首轮发现max-width百分比不支持，已改280px并重新完整导出；最终无CSS不支持错误。保留原style-isolation 1.0，不响应编译器建议去升级架构。
输出：apps/tokenm-android/unpackage/resources/app-android。
编译边界：本地官方应用源编译与AppResource导出成功；并未运行完整Cloud release APK Kotlin任务，不能用此项冒充Cloud Build成功。冻结的泛型Promise、异常处理、验证码ArrayBuffer和生命周期脚本未变。

CLOUD_BUILD_REQUIRED: YES
CLOUD_BUILD_SUBMITTED: NO
RUNTIME_UI_ACCEPTANCE: PENDING_USER
PHASE3: NOT_STARTED
HONOR_VENDOR: OFF
XIAOMI_VENDOR: OFF
ADB_USED: NO
HASH_USAGE: NONE
SHA256: NONE
SMOKE: NONE
AGENTS_MD: UNTOUCHED
COMMIT: NO
PUSH_GIT: NO
TAG: NO

FINAL_CONCLUSION:
- UI视觉与文案统一已完成，原有五组件复用，无第三方框架。
- 认证、配对、隐私/危险确认、功能链和Phase1/2生产链源码保持；本轮没有调用生产Push或重放事件。
- 导航缓存和网络调用图保持，专项行为测试无回归。
- HBuilderX应用源编译/AppResource导出通过；用户可以重新Cloud Build进行UI和Push验收。
- 后续授权修复日期断言后，全仓verify已通过；状态更新为READY_FOR_CLOUD_BUILD。
- 真机UI/四栏目切换/新任务通知验收待用户；本轮停止，不进入Phase3。

## 用户授权的失败测试修复

修改 tests/shared/codexUsageRegression.test.js：真实tokscale的--today和--month都使用宿主日历，原测试误认为注入的2026-08-17会控制原生命令月窗口。改为按宿主扫描前后日期检查日/月窗口，允许顺序扫描跨午夜；累计320 token、2条会话、成本和去重幂等断言保留。新增夹具日、月内及跨月的期望值检查。业务采集代码、Android、Push和缓存均未修改。

目标测试4/4 PASS。最终npm run verify：3539项，3534 PASS、0 FAIL、5 SKIP，lint PASS。中间一次验证出现独立Hub随机端口的fetch bad port，完整复跑未再出现，未改Hub或跳过测试。日志：tmp/ui-refinement/calendar-test-fix.log、verify-calendar-fix.log、verify-calendar-final.log。本次仅测试与报告更新，先前HBuilderX编译产物仍对应最终Android源码，无需重新编译。
