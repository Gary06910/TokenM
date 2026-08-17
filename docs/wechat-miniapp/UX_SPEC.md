# Token M 微信小程序 UX Spec

状态：`FROZEN v1`  
产品定位：Codex 任务完成通知与任务记录助手。不是营销 Landing Page。

## 1. 信息架构

底部主导航 3 项：`首页`、`任务`、`设置`。二级页面：`绑定电脑`、`配对码`、`通知额度`、`任务详情`、`数据与隐私`、`关于 Token M`。

首次启动由 bootstrap 自动建立账户。没有电脑时首页呈 onboarding；绑定后同一路由切换 dashboard，避免多余欢迎页跳转。

## 2. 全局状态约定

每个读取页面必须有：

- Loading：结构 skeleton，不用全屏 spinner 覆盖已有数据。
- Empty：一句事实 + 一个下一步 CTA，不用 emoji/插画占据半屏。
- Error：可理解文案、机器错误不直出、就地“重试”。已有缓存可保留并标记“更新失败”。
- Offline/backend error：不清空现有列表；显示顶端 compact banner。
- Disabled：颜色和语义同时表达，按钮仍需可读；说明恢复路径。
- Pressed：120–160ms opacity/scale feedback；不做长位移动画。

所有 destructive action 使用二次确认，文案说明结果；不使用模糊“确定吗”。

## 3. Onboarding / First Run

内容严格简洁：

- 品牌：`Token M`
- 标题：`Codex 完成时，让微信告诉你。`
- 说明：`绑定 Token M Desktop 后，任务记录会保存在你的账户；有通知额度时，再发送微信提醒。`
- 主 CTA：`绑定电脑`
- 次 CTA：`开启任务通知`（未绑定时进入额度说明，不伪装已开启）
- 低强调隐私入口：`默认使用隐私模式 · 了解详情`

不使用 Hero 图片、营销统计、用户评价或超大留白。

## 4. Dashboard

从上到下：

1. Compact header：Token M、连接/错误状态、设置入口。
2. Quota focus row：大数字 `8 次` + `正常/即将用完/已耗尽`；主 CTA `补充 1 次`。
3. 今日摘要：`今日完成 3 个任务`，与 active desktop 数同一行呈现，不做四宫格 KPI。
4. 电脑 section：最多显示 2 台，状态点、名称、最后上报；更多进入电脑列表。
5. 最近任务：最多 5 条，整行可点；时间、电脑、project（有才显示）、delivery status。

Quota 状态：

- >=4：蓝/中性，`通知额度充足`。
- 1–3：amber compact notice，`额度即将用完`。
- 0：显著但不报警式红色，`任务仍会保存，但不会发送微信提醒`。

## 5. Tasks

List row：状态 marker、主标题（project 或 `隐私任务`）、desktop、相对时间/绝对日期、通知状态。Privacy row 不显示 summary preview。

分页：首次 20 条；接近底部加载下一页。Loading-next 只占列表尾部；失败显示“加载更多失败，重试”，不替换已有列表。无更多数据显示低强调 footer。

Empty：`还没有完成记录` + `在已绑定电脑上完成一次 Codex 任务后，它会出现在这里。`

## 6. Task detail

顶部只显示状态和完成时间，不做巨大标题。

Full mode：电脑、项目、模型、耗时（有值才显示）、result/summary、notification status。长 summary 可换行、选择复制，但 600 字上限；不横向滚动。

Privacy mode：固定 privacy panel：`该任务使用隐私模式，未上传任务内容。` 下方仍可显示完成时间、电脑和通知状态；project/model/summary 不渲染 placeholder 值。

通知状态映射：

- sent：`微信提醒已发送`
- skipped_no_quota：`未发送 · 通知额度为 0`
- skipped_disabled：`未发送 · 任务通知已关闭`
- failed：`发送失败 · 未消耗额度`
- unknown：`发送结果待确认 · 额度暂时保留`
- pending：`正在处理`

## 7. Computers / Pairing

电脑列表显示 name、active/revoked、最后在线、最后上报。Active 支持 rename/unbind；revoked 默认不列出或置于“已解绑”折叠区。

Pairing 页面：

- 6 位 code 使用等宽数字、三位分组视觉但复制值无空格，例如 `824 193`。
- 倒计时 `09:42 后失效`，到期后 code 降低对比并禁用复制。
- 操作：`复制配对码`、`刷新配对码`、`返回电脑列表`。
- 三步说明：打开 Desktop 设置 → 微信通知 → 输入 6 位配对码。
- 新 code 会令旧 code 失效，刷新前给轻量确认。
- Pairing 成功后页面 onShow/短轮询（最长 10 分钟、退后台停止）刷新列表并显示成功，不建立长连接。

错误不区分“不存在/过期/已用”；统一：`配对码无效或已过期，请在小程序刷新后重试。`

## 8. Notification quota

页面主数字 `8 次`，旁边状态。说明原文：

`每发送一次 Codex 完成微信提醒，将消耗 1 次通知额度。任务记录不依赖通知额度。`

主按钮：`补充 1 次通知`。按钮 click handler 直接调用 `wx.requestSubscribeMessage`；不得 onLoad 自动调用、循环申请或模拟点击。

结果 UX：

- accept + server sync：`已补充 1 次通知`
- accept + sync failed：`微信授权已完成，但额度同步失败。请刷新页面；不要重复点击。`
- reject：`你没有同意本次通知，不会增加额度。`
- main switch off / 20004：`微信的订阅消息总开关已关闭` + `打开微信设置`
- ban / 20005：`当前小程序暂时无法申请订阅消息`，禁用重复点击
- filter/invalid template：`通知模板配置有误`，标记配置问题
- network fail：`未完成授权，请检查网络后重试`

`wx.getSetting({withSubscriptions:true})` 只用于显示主开关/长期选择，不声称它等于 remaining quota。

## 9. Settings

- `任务通知` switch：关闭只影响 future message delivery，task 仍保存。
- `隐私模式说明`：解释 Desktop 默认仅上传完成事件；完整模式需在 Desktop 主动开启。
- `数据与隐私`：数据清单、用途、保留、CloudBase、清除记录、删除账户入口。
- `清除任务记录`：确认文案 `清除后无法恢复；已绑定电脑不受影响。`
- `解绑电脑`：链接至电脑列表，不做“一键全解绑”误触。
- `About Token M`：产品用途、版本、非微信官方产品声明、联系信息配置入口。

## 10. Privacy copy

Privacy mode：`仅上传完成事件、电脑标识、匿名会话标识和时间；不上传 prompt、完整对话、工作目录、源代码或 Codex 最终回复。`

Full mode：`可上传项目名称、模型和最多 600 字的任务结果摘要；仍不上传完整聊天记录或源代码。请只在你接受这些内容进入云端时开启。`

不得写“完全匿名”“绝不收集任何信息”或“微信保证送达”。

## 11. Accessibility 与中文排版

- 触控区至少 88rpx（约 44px）；相邻危险/普通操作间隔至少 16rpx。
- 正文至少 28rpx，辅助文字至少 24rpx；支持系统字体缩放后不截断关键 CTA。
- 状态不只依赖颜色，必须有文字；对比度目标普通文本 >=4.5:1。
- 中文标点不悬挂；标题最多 2 行，list title 单行省略、detail 可换行。
- Safe area 使用 `env(safe-area-inset-bottom)`；小屏 320px 宽无横向滚动。
- icon 配有可理解 label；不以 emoji 代替功能图标。

## 12. Mock UI states

Fixtures 必须覆盖：first run、bound/no-task、task list、privacy task、full task、quota 0、quota 2、quota 8、pair active/expired、subscription rejected/main switch off、backend error、pagination error。每个 fixture 可由 service adapter 注入，但 production build 默认不得启用 mock。
