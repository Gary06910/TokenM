# TOKEN_M_CURRENT_UI_AUDIT

BASELINE: TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE
MODE: READ_ONLY_SOURCE_AUDIT
RUNTIME: 用户已有基线验收；本轮未观察新 APK，不将源码审计当作真机视觉验收。

App.uvue 使用 flex:1 / min-height:0 / scroll-view；pages.json 13条 custom 路由、浅色背景。uni.scss 已有小型 SCSS tokens，无需新框架。App launch/show、缓存、四栏目 navigateColumn、PageSnapshot、认证/配对服务全部冻结。

共享组件：tm-header 文字返回可靠；tm-tab-bar 为已有几何 view 图形+文字；status-marker 点+文字；ui-state 静态骨架/空态/错误；notice-banner 文本及重试。底部已有 safe-area 与64px命中区域。

PAGE: onboarding

PRIMARY_PURPOSE: 介绍产品并进入账户

CURRENT_LAYOUT: 品牌、说明、登录/注册、隐私链接

PRIMARY_ACTION: 登录

SECONDARY_ACTION: 创建账户、通知说明

VISUAL_HIERARCHY: WEAK

SPACING: 固定 620px 高度让短屏显得空旷

TYPOGRAPHY: 26px 标题，14px 说明

COLOR: 蓝色品牌、浅色背景

CARD_STYLE: 无主卡

BUTTON_STYLE: 主次按钮已有区分

STATUS_PRESENTATION: 已登录自动进入首页

EMPTY_STATE: 不适用

LOADING_STATE: ui-state 骨架

ERROR_STATE: ui-state 重试

NAVIGATION: 原有 onLoad 重定向

ISSUES: 过高的介绍区域

---

PAGE: login

PRIMARY_PURPOSE: 登录现有账户

CURRENT_LAYOUT: 标题、用户名、密码、验证码、CTA

PRIMARY_ACTION: 登录

SECONDARY_ACTION: 创建账户、刷新验证码

VISUAL_HIERARCHY: WEAK

SPACING: 表单 label 12/4，顶部28

TYPOGRAPHY: 标题20，标签12

COLOR: 共享浅色

CARD_STYLE: 未分组

BUTTON_STYLE: 单主 CTA

STATUS_PRESENTATION: 提交禁用和错误 banner

EMPTY_STATE: 不适用

LOADING_STATE: 提交文案、验证码占位

ERROR_STATE: 错误 banner

NAVIGATION: 返回/注册/权限

ISSUES: 风控实现说明冗长

---

PAGE: register

PRIMARY_PURPOSE: 创建账户

CURRENT_LAYOUT: 用户名、双密码、验证码

PRIMARY_ACTION: 创建账户

SECONDARY_ACTION: 登录、刷新验证码

VISUAL_HIERARCHY: WEAK

SPACING: 顶部20，与登录不同

TYPOGRAPHY: 标题20、正文14

COLOR: 共享浅色

CARD_STYLE: 未分组

BUTTON_STYLE: 单主 CTA

STATUS_PRESENTATION: 提交及验证码禁用

EMPTY_STATE: 不适用

LOADING_STATE: 验证码占位

ERROR_STATE: 错误 banner

NAVIGATION: 登录/权限

ISSUES: uni-id-co 技术文案进入普通表单

---

PAGE: dashboard

PRIMARY_PURPOSE: 快速查看任务与通知整体状态

CURRENT_LAYOUT: 四项通知事实、汇总、电脑、最近任务

PRIMARY_ACTION: 查看通知设置

SECONDARY_ACTION: 任务/电脑/绑定

VISUAL_HIERARCHY: WEAK

SPACING: 卡片14，区块20

TYPOGRAPHY: 焦点20，其余14/12

COLOR: 主按钮深字蓝底对比偏弱

CARD_STYLE: 状态卡权重高

BUTTON_STYLE: 状态正常仍醒目 CTA

STATUS_PRESENTATION: 重复登录/隐私/权限/设备

EMPTY_STATE: 有说明与绑定 CTA

LOADING_STATE: 缓存优先、首次骨架

ERROR_STATE: 缓存保留 warning banner

NAVIGATION: 冻结四栏目

ISSUES: 电脑先于任务；常驻初始化清单；未结合通知开关

---

PAGE: tasks

PRIMARY_PURPOSE: 浏览完成任务

CURRENT_LAYOUT: 三组筛选、列表、分页

PRIMARY_ACTION: 查看任务

SECONDARY_ACTION: 筛选/刷新/分页

VISUAL_HIERARCHY: WEAK

SPACING: 筛选常驻首屏、列表108高

TYPOGRAPHY: 标题14，时间12

COLOR: 浅蓝筛选

CARD_STYLE: 分隔列表

BUTTON_STYLE: 筛选 pill 48高

STATUS_PRESENTATION: 以通知状态替代任务完成状态

EMPTY_STATE: 条件空态混同无任务

LOADING_STATE: 首次骨架、分页骨架、缓存保留

ERROR_STATE: banner 和分页重试

NAVIGATION: 任务详情/四栏目

ISSUES: 隐私任务空正文无解释；电脑名与状态同排可能拥挤

---

PAGE: task-detail

PRIMARY_PURPOSE: 查看任务与通知结果

CURRENT_LAYOUT: 时间、通知、混合字段表、摘要

PRIMARY_ACTION: 阅读

SECONDARY_ACTION: 返回

VISUAL_HIERARCHY: WEAK

SPACING: 分组20

TYPOGRAPHY: 正文14，时间12

COLOR: 共享色

CARD_STYLE: 一张混合字段卡

BUTTON_STYLE: 返回文字

STATUS_PRESENTATION: 通知状态重复

EMPTY_STATE: 无任务走原错误/返回

LOADING_STATE: 骨架

ERROR_STATE: 重试与无效链接返回

NAVIGATION: 原 taskId 路由

ISSUES: 缺少任务/通知/隐私分组

---

PAGE: desktops

PRIMARY_PURPOSE: 查看和管理电脑

CURRENT_LAYOUT: 电脑卡、重命名表单、解绑、添加、历史

PRIMARY_ACTION: 添加电脑

SECONDARY_ACTION: 重命名、解除绑定

VISUAL_HIERARCHY: WEAK

SPACING: 卡片12/10

TYPOGRAPHY: 名称15，次级12

COLOR: 解绑红色

CARD_STYLE: 同权重卡

BUTTON_STYLE: 重命名与解绑各占一半

STATUS_PRESENTATION: 最后在线重复展示

EMPTY_STATE: 有说明/配对 CTA

LOADING_STATE: 缓存优先/骨架/下拉

ERROR_STATE: 保留缓存 banner

NAVIGATION: 配对/四栏目；无独立 detail route

ISSUES: 已在卡内管理，不应新建详情路由；长名称风险

---

PAGE: pairing

PRIMARY_PURPOSE: 用六位码连接 Desktop

CURRENT_LAYOUT: 码、倒计时、复制、刷新、步骤

PRIMARY_ACTION: 复制配对码

SECONDARY_ACTION: 刷新、返回电脑

VISUAL_HIERARCHY: WEAK

SPACING: 卡片24，步骤48

TYPOGRAPHY: 码24，提示13

COLOR: 过期整体低透明度

CARD_STYLE: 一张主卡

BUTTON_STYLE: 复制主、刷新次

STATUS_PRESENTATION: 成功 banner 但旧码仍显示

EMPTY_STATE: 不适用

LOADING_STATE: 生成骨架

ERROR_STATE: 重试与状态 banner

NAVIGATION: 返回电脑，定时器按生命周期停止

ISSUES: 成功后旧码/倒计时仍突出；缺少明确离开文案

---

PAGE: settings

PRIMARY_PURPOSE: 管理账户通知和隐私

CURRENT_LAYOUT: 头像、四事实表、通知开关、长说明、入口、退出

PRIMARY_ACTION: 管理通知

SECONDARY_ACTION: 电脑/隐私/关于/退出

VISUAL_HIERARCHY: WEAK

SPACING: 区块20，行64

TYPOGRAPHY: 标题14，元信息12

COLOR: 退出红边

CARD_STYLE: 事实表强于实际设置

BUTTON_STYLE: 退出全宽红边

STATUS_PRESENTATION: 四事实与通知入口重复

EMPTY_STATE: 不适用

LOADING_STATE: 缓存优先/骨架

ERROR_STATE: 缓存保留 banner

NAVIGATION: 原四栏目及子页

ISSUES: 缺少分组；Desktop 技术说明抢屏；箭头字符

---

PAGE: permission

PRIMARY_PURPOSE: 完成登录隐私和通知准备

CURRENT_LAYOUT: 装饰、长说明、三步骤、六事实、CTA

PRIMARY_ACTION: 首项未完成操作

SECONDARY_ACTION: 查看电脑/进入 App

VISUAL_HIERARCHY: WEAK

SPACING: 顶部36；滚动链已修复

TYPOGRAPHY: 标题20、说明14

COLOR: 状态共享色

CARD_STYLE: 步骤和事实重复

BUTTON_STYLE: 多个大按钮

STATUS_PRESENTATION: 真实本地及后端事实分离

EMPTY_STATE: 不可用不冒充零设备

LOADING_STATE: 首次骨架

ERROR_STATE: 云不可用 banner

NAVIGATION: 原登录/配对/电脑/首页

ISSUES: 旧 Phase 1 文案、Push API 细节、正常用户仍初始化提示

---

PAGE: notifications

PRIMARY_PURPOSE: 查看和开关通知

CURRENT_LAYOUT: 权限卡、旧阶段 banner、开关、恢复 CTA、事实表

PRIMARY_ACTION: 开启/恢复通知

SECONDARY_ACTION: 开关/返回

VISUAL_HIERARCHY: INCONSISTENT

SPACING: 卡16，区块20

TYPOGRAPHY: 20/14/12

COLOR: 开关亮蓝

CARD_STYLE: 权限卡加事实表

BUTTON_STYLE: 正常也显示禁用大按钮

STATUS_PRESENTATION: 区分系统权限与设备注册

EMPTY_STATE: 不适用

LOADING_STATE: 首次骨架、重试保留

ERROR_STATE: warning banner

NAVIGATION: 原权限/登录/返回

ISSUES: 错误阶段文案；listener/四事实工程说明

---

PAGE: privacy

PRIMARY_PURPOSE: 说明数据与管理账户数据

CURRENT_LAYOUT: 模式说明、数据表、危险区

PRIMARY_ACTION: 阅读隐私说明

SECONDARY_ACTION: 清除记录/删除账户

VISUAL_HIERARCHY: GOOD

SPACING: 区块20

TYPOGRAPHY: 14正文25行高

COLOR: 危险按钮红边

CARD_STYLE: 数据表

BUTTON_STYLE: 两危险操作略突出

STATUS_PRESENTATION: 登录状态与操作消息

EMPTY_STATE: 未登录提示

LOADING_STATE: working 禁用

ERROR_STATE: message banner

NAVIGATION: 返回/登录/注销

ISSUES: 保留双确认；底部危险区需安静分隔

---

PAGE: about

PRIMARY_PURPOSE: 了解用途和版本

CURRENT_LAYOUT: TM标志、简介、版本与说明

PRIMARY_ACTION: 阅读

SECONDARY_ACTION: 返回

VISUAL_HIERARCHY: GOOD

SPACING: 标志24/文字12

TYPOGRAPHY: 20/14

COLOR: 共享浅色

CARD_STYLE: 一张信息卡

BUTTON_STYLE: 返回文字

STATUS_PRESENTATION: 静态版本

EMPTY_STATE: 不适用

LOADING_STATE: 不适用

ERROR_STATE: 不适用

NAVIGATION: 返回

ISSUES: 送达说明可缩短，品牌统一

---


图标扫描补充：当前应用13路由/5组件无私有glyph；官方uni-id-pages-x-icons中存在未引用的uni-id-icon，uni-scss模块含伪元素，不属于当前页面依赖。Desktop伪元素保持冻结。未删除任何模块。
