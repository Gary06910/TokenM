# TASK_MANAGEMENT_AND_BACKGROUND_UX_PLAN

2026-09-13，修改前只读审计完成。

基线：用户提供 Phase 1/2 PASS、Honor 前台/普通后台/锁屏 PASS、切页卡顿已解决；主动划掉仍为 KNOWN LIMITATION。现有 Git 修改（含 AGENTS.md）全部保留。

审计：Tasks 使用内容/电脑/通知筛选和游标分页；Detail 调用 getTask；Home 的 todayTasks 和 recentTasks 都来自可见记录。四个 PageSnapshot 已有 revision/session 屏障，导航使用 reLaunch，品牌页为纯本地 OS/storage。pages.json 已注册保护页。Settings 保护入口错误地位于账户前。旧 clearTaskHistory 物理删除 100 行并写账户时间水位，须替换。events 在 desktopId + eventId 唯一身份冲突时直接返回，不进入通知流程；正文比较须识别已最小化 tombstone。notification claim/result 字段禁止改动。

1. 单条长按 ActionSheet 后确认；清除全部明确当前账户所有记录，与筛选无关。成功后才修改缓存，失败保留界面。
2. userDeletedAtMs(long) tombstone，清空 project/model/summary/durationMs/sessionId；保留事件身份、时间和全部通知尝试字段。删除不触发通知。已删除重复事件按保留身份返回 duplicate，不再比较已清空正文。
3. repository 提供任务可见条件（字段 absent/null），在数据库查询前排除。clear 使用一次 owner + visible + createdAtMs <= 服务端开始时间的 where.update；无客户端逐条请求，无队列，无全局永久隐藏。旧隐私页入口复用相同操作。
4. 今日计数统一为今日可见完成记录。使用数据库 count，避免原 500 行读取上限造成计数截断。删除后更新 Tasks/Home 快照并推进现有 revision，拒绝删除前在途响应。
5. Settings 顺序：标题、账户、后台通知保护、通知、隐私、应用。品牌选择 Honor/Xiaomi，本机保存选择和各品牌独立确认；通知和标准电池优化仍真实检测。无品牌探测、无云调用、无 SDK。
6. 官方资料：Xiaomi 14T KA-507608 自启动；Xiaomi 15 KA-538010 电池无限制；POCO X7 KA-524441 后台锁；REDMI Pad Pro KA-517262 联网目标；Honor zh-cn00406916 后台管理。机型路径作为示例，不保证各 ROM 一致。Honor 历史 USER_RUNTIME_VALIDATED；Xiaomi OFFICIAL_GUIDANCE_IMPLEMENTED_RUNTIME_PENDING。
7. 验证：删除所有权/正文最小化/状态保存/重复事件不推送/清除并发时间/新事件/缓存竞态/品牌隔离/真实 OS 状态/设置位置；npm run verify；官方 HBuilderX Android 编译与 AppResource 导出。仅部署必要 core/co/schema，依赖需要时同步未改逻辑的 desktop-http。

冻结：Push provider、CID、eligibility、Desktop、Auth、配对、缓存架构、manifest/signing、隐私版本、AGENTS.md、WeChat/CloudBase。NO ADB / Cloud Build submission / native SDK / content fingerprints / commit / push / tag / file deletion。生产任务规模没有经过账户数据读取，不能声称已测；条件更新不受客户端分页大小影响。targetCount=2 仅继承只读源码解释，未验证生产设备清单，不阻塞本轮。
