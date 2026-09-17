# TOKEN_M_PHASE3_NOTIFICATION_RELIABILITY_ACCEPTANCE_PLAN

STATUS: TOKEN_M_PHASE3_NOTIFICATION_ACCEPTANCE_READY
BASELINE_NAME: TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE
DATE: 2026-09-09
TEST_SCOPE: BASE UNI-PUSH 2.0 RELIABILITY BY ANDROID RUNTIME STATE
HONOR_VENDOR_PUSH: OFF
XIAOMI_VENDOR_PUSH: OFF
ANDROID_SOURCE_CHANGE: NO
BACKEND_CHANGE: NO
CLOUD_BUILD_REQUIRED: NO

本方案用于用户直接使用当前已经确认的 APK 做一次真实 Honor Android 手机验收。它只测试当前已经跑通的基础 uni-push 2.0 在不同 App/process 状态下能可靠到达什么程度，不实现任何新功能，不启用厂商 Push，不重新打包 APK。

## 1. 本阶段要回答的问题

需要把以下两层结果分开记录：

1. Server -> DCloud provider：uniCloud 是否接受本次通知提交。
2. DCloud -> Honor device：系统通知是否真实出现在手机上。

notificationStatus = submitted 且 notificationProviderCode = 0，只能证明 provider 接受提交，不等于设备显示通知。Phase 3 的目标是分别测量：

- App active / 前台
- App background / 普通后台
- screen locked / 锁屏
- recent-tasks swipe-away / 最近任务划掉
- recent-tasks swipe-away + screen locked / 划掉后锁屏
- long background / 较长后台（可选）

不要从测试开始前预设“必须加入 Honor vendor Push”。先测出当前基础通道的真实边界。

## 2. 执行前固定条件

每一轮场景开始前，先用正常手机操作确认：

- 使用当前 APK，不安装新包、不替换 package、不改变 AppID。
- Honor 手机上 Token M 已登录，当前隐私确认有效。
- Android 系统通知权限已开启，Token M 的任务通知设置已开启。
- Token M 的通知页面显示通知服务注册完成或等价的 ready 状态。
- Token M Desktop 已正常连接到同一账户，电脑端可以正常完成并上报 Codex task。
- 手机和电脑网络正常；测试期间不要主动切换账号、退出登录、解绑电脑或关闭任务通知。
- 不启用任何 Honor、Xiaomi 或其他厂商 Push；不修改 manifest、签名、厂商配置或依赖。

通知页面的说明性文案不能替代真实结果。真实结果以手机通知栏/锁屏中实际出现的 Token M 通知、Android Tasks 中实际出现的任务，以及 uniCloud task record 中的安全诊断字段为准。

如果前置条件不满足：

- 先记录为 PRECONDITION_NOT_READY。
- 不要在该状态下把事件结果解释为 Honor 离线能力。
- 不要重放已经完成的旧 task/event。
- 修复或恢复前置条件后，重新开始下一个场景，并为下一个场景创建新的真实 Codex task。

## 3. 新事件唯一性协议

系统使用 desktopId + eventId 去重，并且是 at-most-once。为避免把重复事件误认为新的通知能力：

1. P3-A 到 P3-F 每一个场景都必须在 Codex Desktop 中创建一个新的真实 Codex task。
2. 每个场景只允许该 task 产生一个真实的完成事件。
3. 使用 Desktop 的正常任务创建和完成流程；eventId 由现有生产链路产生。
4. 禁止重复旧 event、重试历史 event、手工把 failed 改成 pending、伪造 production task 或直接调用 Push provider。
5. 某个场景失败后，不通过重试同一个事件补测；只记录该场景，下一场景使用新的真实 task。
6. uniCloud 控制台只用于读取该新 task 的结果，不通过控制台修改任务状态或补发通知。

每个场景的 NEW_EVENT_CREATED 必须记录为 YES。若事件已经完成但观察过程发生操作失误，也不能重复该事件；该行应标记 INVALID 或 INCONCLUSIVE，并在下一行使用新事件。

## 4. 每次测试的统一记录方法

### 4.1 事件前

- 记录 TEST_ID、APP_STATE、SCREEN_STATE 和实际 WAIT_TIME。
- 确认 Token M 已处于本场景要求的状态。
- 在电脑上创建新的短 Codex task。
- 让该 task 正常完成一次。

### 4.2 事件后

- 在本场景的观察状态下，先观察系统通知是否实际出现。
- 在确认通知结果前不要主动重新打开 Token M；允许使用手机正常的通知栏下拉动作观察通知。
- 锁屏场景不要求屏幕自动亮起。只要通知在锁屏上出现，或解锁后通知栏中保留该通知，都记录系统通知实际到达；在 NOTES 中注明出现位置。
- 完成观察后，打开 Token M 的 Tasks 页面，记录 ANDROID_TASK_VISIBLE_AFTER_OPEN = YES/NO。
- 如需等待任务列表刷新，只使用 Android UI 的正常刷新/进入页面动作；不要创建第二个事件。
- 在 uniCloud 控制台找到该次新完成记录时，只查看安全通知诊断字段。可用发生时间、电脑和场景辅助定位；若控制台需要 task ID，可临时用于定位，但不要写入验收表。

### 4.3 只记录这些 Cloud 字段

notificationStatus
notificationReason
notificationTargetCount
notificationProviderStage
notificationProviderCode
notificationProviderMessage
notificationAttemptedAtMs
notificationSubmittedAtMs

如果某字段在控制台当前视图不可见，记录 UNAVAILABLE_IN_CONSOLE，不要推测或从其他字段拼接。不要记录 CID、credential、token、payload、task 正文、prompt、reply、summary 或其他 secret。

notificationStatus = submitted 表示 provider 已接受请求；notificationSubmittedAtMs 只表示提交被接受的时间。它们都不能单独证明 Android 系统通知已经显示。

## 5. 测试矩阵

| TEST_ID | APP_STATE | SCREEN_STATE | 建议状态保持时间 | 每场景事件 |
| --- | --- | --- | --- | --- |
| P3-A | FOREGROUND | UNLOCKED | 立即执行 | 一个新的真实完成事件 |
| P3-B | BACKGROUND | UNLOCKED | 2–5 分钟 | 一个新的真实完成事件 |
| P3-C | BACKGROUND | LOCKED | 1–2 分钟 | 一个新的真实完成事件 |
| P3-D | RECENTS_SWIPE_AWAY | UNLOCKED | 1–2 分钟 | 一个新的真实完成事件 |
| P3-E | RECENTS_SWIPE_AWAY | LOCKED | 2–5 分钟 | 一个新的真实完成事件 |
| P3-F | LONG_BACKGROUND | UNLOCKED | 15–30 分钟，可选 | 一个新的真实完成事件 |

P3-F 是 OPTIONAL，不阻塞 Phase 3 初判。建议按 P3-A、P3-B、P3-C、P3-D、P3-E 的顺序执行，以便先得到前台 control，再逐步增加后台限制。

## 6. 逐场景操作步骤

### P3-A：App 前台（baseline control）

1. 打开 Token M 并保持在前台、解锁状态。
2. 不切换到系统设置，不锁屏，不划掉 App。
3. 在电脑上创建并完成一个新的短 Codex task，只完成一次。
4. 观察 Token M 系统通知是否出现。
5. 在确认通知结果后打开/查看 Android Tasks，确认新任务是否可见。
6. 在 uniCloud 控制台读取这一次 task 的安全通知诊断字段。

预期 control：

- notificationStatus = submitted
- notificationProviderCode = 0
- ANDROID_SYSTEM_NOTIFICATION = YES
- ANDROID_TASK_VISIBLE_AFTER_OPEN = YES

该场景用于确认本轮没有破坏已通过的前台基础链路。

### P3-B：普通后台

1. 打开 Token M 一次，确认登录、隐私、系统通知和通知服务注册均为 ready。
2. 返回 Android 桌面，不从最近任务中划掉 Token M。
3. 保持普通后台约 2–5 分钟。
4. 在电脑上创建并完成一个新的短 Codex task，只完成一次。
5. 在观察通知前不要主动重新打开 Token M；查看通知栏中是否出现 Token M 通知。
6. 观察结束后打开 Token M 的 Tasks 页面，记录任务是否可见。
7. 读取对应 Cloud task 的安全诊断字段。

核心字段：

SYSTEM_NOTIFICATION = YES/NO

不要把“稍后打开 App 能看到任务”当成“系统通知到达”。

### P3-C：锁屏

1. 确认 Token M 正常登录并且通知准备完成。
2. 返回 Android 桌面。
3. 使用手机正常锁屏。
4. 锁屏保持约 1–2 分钟。
5. 在电脑上创建并完成一个新的短 Codex task，只完成一次。
6. 先观察锁屏是否有 Token M 通知；不要要求屏幕必须自动亮起。
7. 观察时间结束后解锁，检查通知栏中是否存在该通知。
8. 打开 Token M 的 Tasks 页面并读取 Cloud task 诊断字段。

记录通知实际出现的位置，例如 LOCKSCREEN、NOTIFICATION_SHADE_AFTER_UNLOCK 或 NONE；主表仍只填 YES/NO。

### P3-D：最近任务划掉 App

1. 正常打开 Token M 一次，并确认通知准备完成。
2. 返回 Android 桌面。
3. 打开 Android 最近任务界面，将 Token M 划掉。
4. 不重新启动 Token M，保持约 1–2 分钟。
5. 在电脑上创建并完成一个新的短 Codex task，只完成一次。
6. 不主动重新打开 Token M，先观察通知栏是否实际出现通知。
7. 观察结束后再打开 Token M 的 Tasks 页面。
8. 读取这一次新 task 的 Cloud diagnostics。

这是本阶段判断基础通道 offline boundary 的关键场景。

### P3-E：最近任务划掉 App + 锁屏

1. 打开 Token M 并确认通知准备完成。
2. 返回 Android 桌面。
3. 从最近任务中将 Token M 划掉。
4. 使用手机正常锁屏。
5. 保持划掉加锁屏状态约 2–5 分钟。
6. 在电脑上创建并完成一个新的短 Codex task，只完成一次。
7. 先观察锁屏和通知栏；不要要求屏幕自动亮起。
8. 解锁后再打开 Token M，确认 Tasks 页面和 Cloud task 结果。

该场景与 P3-D 分开记录；两者不能复用同一个 task/event。

### P3-F：较长后台（OPTIONAL）

1. 打开 Token M 一次，确认通知准备完成。
2. 返回桌面，不划掉 App，保持普通后台 15–30 分钟。
3. 使用一个新的真实 Codex task 完成一次事件。
4. 按 P3-B 的方式记录系统通知、任务可见性和 Cloud diagnostics。

若设备或时间不方便，可标记 OPTIONAL_NOT_RUN，不影响 P3-A 到 P3-E 的初判。

## 7. RECENTS_SWIPE_AWAY 与 FORCE_STOP 的语义边界

RECENTS_SWIPE_AWAY：

- 从 Android 最近任务界面移除 Token M。
- 是本阶段的核心 offline boundary 测试。
- 不等同于 Android 系统阻止 App 的所有后台行为。

ANDROID_SETTINGS_FORCE_STOP：

- 进入 Android Settings -> Apps -> Token M -> Force stop。
- 会触发 Android 更强的停止语义，与最近任务划掉不是同一种状态。
- 只作为 OPTIONAL / SEPARATE SEMANTICS 单独报告。
- 不把 Force stop 结果作为本轮“必须支持 Vendor Push”的硬指标。

如果后续执行 Force stop，APP_STATE 单独写 FORCE_STOP，不要把它合并到 RECENTS_SWIPE_AWAY 行，也不要复用该行的结果。

## 8. 统一验收记录表

每个场景填写一行。表中不填 CID、credential、token、payload、task 正文或 task ID。

| TEST_ID | APP_STATE | SCREEN_STATE | WAIT_TIME | NEW_EVENT_CREATED | ANDROID_SYSTEM_NOTIFICATION | ANDROID_TASK_VISIBLE_AFTER_OPEN | notificationStatus | notificationReason | notificationTargetCount | notificationProviderStage | notificationProviderCode | notificationProviderMessage | notificationAttemptedAtMs | notificationSubmittedAtMs | NOTES |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P3-A |  |  |  | YES | YES/NO | YES/NO |  |  |  |  |  |  |  |  |  |
| P3-B |  |  |  | YES | YES/NO | YES/NO |  |  |  |  |  |  |  |  |  |
| P3-C |  |  |  | YES | YES/NO | YES/NO |  |  |  |  |  |  |  |  |  |
| P3-D |  |  |  | YES | YES/NO | YES/NO |  |  |  |  |  |  |  |  |  |
| P3-E |  |  |  | YES | YES/NO | YES/NO |  |  |  |  |  |  |  |  |  |
| P3-F |  |  |  | YES / OPTIONAL_NOT_RUN | YES/NO/N/A | YES/NO/N/A |  |  |  |  |  |  |  |  |  |

WAIT_TIME 填场景在完成事件前保持的约数；NOTES 填通知出现表面、是否需要解锁后查看、网络异常或其他观察事实，不填任务正文和敏感数据。

## 9. 诊断判断树

~~~text
新完成事件
  |
  +-- notificationStatus = skipped_*
  |     |
  |     +-- 检查 notificationReason
  |           notifications_disabled / privacy_consent_required
  |             / no_eligible_device / cid_unavailable
  |           => eligibility 或账户/设备准备问题
  |           => 不是 Honor vendor offline Push 证据
  |
  +-- notificationStatus = failed
  |     |
  |     +-- 读取 providerStage / providerCode / providerMessage
  |           => provider 或 server 处理失败
  |           => 不是 Honor 离线展示失败
  |           => 不重放本事件；后续需针对新的具体 provider 错误单独处理
  |
  +-- notificationStatus = submitted
  |     |
  |     +-- notificationProviderCode = 0
  |           |
  |           +-- ANDROID_SYSTEM_NOTIFICATION = YES
  |           |     => Server -> DCloud -> Honor system notification PASS
  |           |
  |           +-- ANDROID_SYSTEM_NOTIFICATION = NO
  |                 => backend 正常，DCloud 已接受提交
  |                 => 边界进入 DCloud -> Honor device/offline delivery
  |                 => 这是未来评估 Honor vendor Push 的主要证据
  |
  +-- notificationStatus = pending / not_requested
        => 结果未完成或未进入可判定提交状态
        => 记录为 INCONCLUSIVE，不能解释为 Honor 离线失败
        => 不修改状态，不重复旧事件
~~~

补充规则：

- submitted + provider code 0 + system notification YES 是该状态的完整 PASS。
- submitted + provider code 0 + system notification NO 不是 provider failure；它说明服务端提交成功但设备侧未观察到系统通知。
- failed 必须先看 providerStage、providerCode、providerMessage。尤其不要只看“手机没收到”就把 failed 叫作 Honor offline failure。
- skipped_* 必须先看 notificationReason 和前置条件；targetCount 为 0 时不能拿来判断厂商离线能力。
- 若 task 在 Android Tasks 不可见，但系统通知已出现，分别记录通知 PASS、任务可见性 FAIL；不要把两个结果混成一个 Push 结论。
- notificationProviderMessage 只记录控制台已经提供的安全、有界消息；如果显示为不可用或被省略，照实填写。

## 10. Phase 3 最终汇总矩阵

provider PASS 的定义是 notificationStatus = submitted 且 notificationProviderCode = 0。SYSTEM NOTIFICATION 只看手机实际观察，不看 provider status。

| STATE | PROVIDER | SYSTEM NOTIFICATION | STATE VERDICT |
| --- | --- | --- | --- |
| Foreground | PASS | PASS | PASS |
| Background 2–5 min | PASS | PASS/FAIL | 待真实结果 |
| Locked | PASS | PASS/FAIL | 待真实结果 |
| Swiped away | PASS | PASS/FAIL | 待真实结果 |
| Swiped + locked | PASS | PASS/FAIL | 待真实结果 |
| Long background | PASS | PASS/FAIL | OPTIONAL |

用户完成填表后，复制同样结构形成最终结果；不要用“猜测”“理论上应该到达”填充 SYSTEM NOTIFICATION。

## 11. 后续决策门槛

### 11.1 基础通道全部通过

如果 P3-A、P3-B、P3-C、P3-D、P3-E 均满足：

- provider PASS
- ANDROID_SYSTEM_NOTIFICATION = YES
- task record 可通过正常 Android UI 看到

则冻结：

BASE_CHANNEL_RELIABILITY_PASS

此时不要为了“正规”而强行加入 Honor vendor Push。后续是否增加厂商通道，只能作为长期可靠性增强的独立产品决定。

### 11.2 仅非活跃状态失败，且 provider 仍通过

如果出现类似：

- Foreground: PASS
- Background: PASS
- Lockscreen: PASS
- Swiped away: FAIL
- 失败事件 notificationStatus = submitted
- 失败事件 notificationProviderCode = 0

或 P3-E 同样失败，则形成强证据：

BASE_CHANNEL_ACCEPTED_BUT_INACTIVE_PROCESS_DELIVERY_UNRELIABLE

此时可以建议后续进入：

PHASE 3B — HONOR VENDOR OFFLINE PUSH

本方案只提出进入条件，不在本轮实现、配置或部署 Honor SDK。

### 11.3 普通后台就失败

如果 App 只是返回桌面 2–5 分钟，且：

- notificationStatus = submitted
- notificationProviderCode = 0
- Android 没有系统通知

则标记：

BASE_CHANNEL_BACKGROUND_DELIVERY_FAIL

不要直接实施 Honor Vendor SDK。下一步应先单独分析基础 uni-push channel、Android 后台限制、Honor 电池策略和 App notification behavior。

### 11.4 provider 或 eligibility 失败

- notificationStatus = failed：标记 PROVIDER_FAILURE_NEEDS_FIX，先解决新的 providerStage/providerCode/providerMessage 问题。
- notificationStatus = skipped_*：标记 ELIGIBILITY_NEEDS_FIX，先解决通知开关、隐私确认、设备注册、系统权限或官方 identity 绑定问题。
- 以上两类都不是 Honor vendor offline Push failure。

## 12. 本轮禁止事项

- ADB、logcat、USB debugging、wireless debugging、dumpsys。
- 任何 Honor、Xiaomi、Huawei、OPPO、Vivo、Meizu 或 FCM 厂商 Push。
- 修改 Android 源码、Push client、CID client、权限、navigation、cache、settings 或页面。
- 修改 push-notification.js、getPushManager 调用、sendMessage request、platform、notification state machine、at-most-once 或 provider diagnostics。
- 修改 tokenm-core、tokenm-desktop-http、tokenm-co、schema，或部署 Cloud backend。
- 重新打包、重新提交 Cloud Build、替换签名、package、AppID 或 manifest 厂商配置。
- 重复旧 event、重试历史 event、手工改状态、伪造 production task、直接调用 provider。
- 把最近任务划掉和 Android Settings Force stop 混为一种状态。
- 在记录中写入 CID、credential、token、payload、task 正文或其他 secret。

## 13. 完成标准与交接

Phase 3 初判在以下条件满足后完成：

- P3-A、P3-B、P3-C、P3-D、P3-E 各有一个新的真实完成事件。
- 每个事件只产生一次，不使用历史 event 重试。
- 每行都有手机系统通知 YES/NO、Android task 可见 YES/NO 和 Cloud diagnostics，或明确标记字段不可见。
- 汇总矩阵已区分 provider PASS 与 system notification PASS/FAIL。
- 按第 11 节门槛得出 BASE_CHANNEL_RELIABILITY_PASS、BASE_CHANNEL_BACKGROUND_DELIVERY_FAIL、PHASE 3B CANDIDATE 或 PROVIDER/ELIGIBILITY NEEDS FIX 之一。
- P3-F 可以作为 OPTIONAL 单独列出，不阻塞初判。

本轮文档完成后停止。下一步由用户使用当前 APK 执行 P3-A 前台、P3-B 普通后台、P3-C 锁屏、P3-D 最近任务划掉、P3-E 划掉加锁屏，并把每个新事件的一行结果带回。除非真实结果暴露新的具体 server bug，否则不修改实现。
