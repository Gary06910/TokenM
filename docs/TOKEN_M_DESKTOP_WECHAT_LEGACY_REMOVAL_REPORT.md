# TOKEN_M_DESKTOP_WECHAT_LEGACY_REMOVAL_REPORT

日期：2026-09-10。当前工作树与 Windows 验证包已移除旧微信通知链路。未安装或覆盖用户正在运行的 Desktop。

STATUS: TOKEN_M_DESKTOP_ANDROID_ONLY_UPSTREAM_AUDIT_PARTIAL

Legacy removal 已完成；PARTIAL 对应上游接入阻断：无共同 Git 祖先、发布 feed 仍指向原作者。详见 [架构审计](TOKEN_M_DESKTOP_UPSTREAM_INTEGRATION_AUDIT.md) 和 [更新指南](TOKEN_M_UPSTREAM_UPDATE_GUIDE.md)。不把设计完成写成已经执行了历史接入或上游升级。

| 字段 | 结果 |
| --- | --- |
| CURRENT_NOTIFICATION_TARGET | ANDROID_ONLY |
| WECHAT_UI_REMOVED | YES |
| WECHAT_TARGET_SELECTOR_REMOVED | YES |
| WECHAT_CLOUDBASE_CONFIG_REMOVED | YES，当前默认值、环境变量入口、UI、凭证映射已移除 |
| WECHAT_PAIRING_REMOVED | YES |
| WECHAT_SEND_PATH_REMOVED | YES，四个独立微信模块已逐文件删除 |
| WECHAT_RUNTIME_NETWORK_CALLS | 0，旧配置存在的本地 runtime 测试仍只走 Android |
| ACTIVE_RUNTIME_WECHAT_REFERENCES | 0，src 全树扫描与负向测试通过 |
| ANDROID_PAIRING | PRESERVED |
| ANDROID_EVENT_SUBMISSION | PRESERVED |
| PRIVACY_MODE / COMPLETE_MODE | PRESERVED / PRESERVED |
| ANDROID_CREDENTIAL | PRESERVED |
| ANDROID_UNPAIR | PRESERVED |
| BACKEND_CHANGED | NO |
| ANDROID_APP_CHANGED | NO |
| CLOUD_ACTIONS | NONE |
| REAL_PUSH | NONE |
| COMMIT / PUSH / TAG | NONE |
| UPSTREAM_MERGE / REBASE / PULL | NONE |

## 本轮修改

| FILES_CHANGED | 改动 |
| --- | --- |
| src/electron/tokenMNotificationRuntime.js | 直接启动 Android；删除 provider selector、微信构造/状态/方法/分支；保持 lifecycle lane、Codex bridge 和 Android 调用 |
| src/electron/main.js | 删除旧默认值和 IPC；加载仅允许当前 tokenM 设置键；已有 Android 默认值和规范化保持 |
| src/electron/preload.js | 删除微信与 setNotificationTarget 暴露；保留 Android IPC |
| src/shared/credentialStore.js | 删除旧 credential 映射，保留 Android namespace；不删除旧磁盘文档字段 |
| src/electron/renderer/app.js | 删除微信 DOM references、事件处理、目标选择；摘要直接显示 Android 绑定状态 |
| src/electron/renderer/index.html | 删除选择器及整个微信区块；Android 内容、hook 与隐私/完整模式保留 |
| src/electron/renderer/i18n.js | 删除各语言微信/target 文案；通知描述直接指向 Android；去掉过时 Phase 1 描述 |
| src/electron/renderer/styles.css | 删除微信/target 样式；补 Android 隐藏规则，解决已绑定仍显示配对区、hook 按钮隐藏无效的问题 |
| .env.example / README.md | 移除当前微信配置及接入流程，说明 Android 当前链路和历史资产边界 |
| tests/electron/androidSettings.test.js | Android-only UI、凭证重载、旧凭证保留且不暴露 |
| tests/electron/tokenMNotificationTarget.test.js | 旧 target=wechat 设置仍只提交 Android；重复完成保留同一个 eventId，mock 返回 duplicate |
| tests/electron/tokenMIntegrationContract.test.js | 实际 preload IPC 参数/状态订阅行为；src 无旧引用 |
| tests/helpers/tokenmRendererAcceptance.cjs | 隔离 Electron 实际 renderer/preload 验收、模拟配对/两种内容模式/禁用/解绑、截图 |
| docs/LEGACY_WECHAT_INVENTORY.md | 修改前 forensic inventory |
| docs/LEGACY_WECHAT_REMAINING_REFERENCES.md | 全仓剩余引用分类 |
| docs/TOKEN_M_UPSTREAM_DELTA_MAP.md | 上游参照到当前的逐文件差异 |
| docs/TOKEN_M_DESKTOP_UPSTREAM_INTEGRATION_AUDIT.md | 来源、模块、冲突、数据生存和 gate |
| docs/TOKEN_M_UPSTREAM_UPDATE_GUIDE.md | 首次接入前提与后续十二步 merge 流程 |

逐文件删除：src/electron/wechatClient.js、wechatNotificationRuntime.js、wechatOutbox.js、wechatPayload.js，以及 tests/electron/wechatClient.test.js、wechatCredential.test.js、wechatOutbox.test.js、wechatPayload.test.js、wechatSettings.test.js。未执行递归/批量删除，也未删除相邻备份、历史 Git、小程序、云资产或用户配置。

本轮开始前 main/preload/renderer/runtime/credentialStore 已有未提交 Android 改动，apps、docs/android、四个 Android Desktop 模块及其测试尚未跟踪。AGENTS.md、eslint.config.js、tests/shared/codexUsageRegression.test.js 已脏，本轮没有编辑它们。不能将最终 git status 的所有差异都归为本轮新增。

## 保护边界

四个 Android HTTP 路径保持：POST /v1/desktop/pair、GET /v1/desktop/status、POST /v1/desktop/events、POST /v1/desktop/unpair-self。client、payload、outbox、Android runtime 的核心实现未作本轮语义修改。

Codex Stop → loopback bridge → android.enqueue → 显式 eventId → privacy/full allowlist → private credential → uniCloud 保持。现有 Windows hook command 身份识别属于 Android 仍在使用的共享核心，不是微信功能，予以保留。

旧 tokenM 设置不进入活动设置；普通新保存只序列化当前设置。私有 store 中不认识的历史字段仍保留，旧 outbox 文件不打开、不重放、不删除。没有 destructive data migration。

Android production endpoint `https://env-00jy6pbiul92.dev-hz.cloudbasefunction.cn/tokenm-desktop-http` 保持；其中 cloudbasefunction.cn 是现有 HTTP 托管主机名，不能误判为应删除的旧微信 endpoint。

## TESTS / BUILD / runtime acceptance

| 验证 | 结果 |
| --- | --- |
| npm run verify | PASS；lint + 3,528 tests：3,523 pass、0 fail、5 skipped |
| 凭证历史字段补充断言后的定向测试 | PASS；androidSettings + tokenMIntegrationContract + tokenMNotificationTarget：5/5 |
| 新增/修改测试脚本 ESLint | PASS |
| git diff --check | PASS |
| npm run dist:win:dir -- --config.directories.output=dist/android-only-final-20260910 | PASS；Windows x64 unpacked validation package |
| app.asar 读取核对 | PASS；12 个 Android/集成/UI/credential 源文件逐字节匹配当前工作树；微信 Desktop 模块不存在。没有生成附加校验值 |
| 实际 Electron renderer/preload 隔离验收 | PASS；面板展开、仅 Android、mock 配对、状态摘要、full/privacy、禁用、解绑 |
| 完整生产 Desktop 启动 / 真实配对 / 真实 Push | 未执行；未替换正在运行的应用，未触发生产通知 |

验收脚本使用独立 userData 和 mock IPC，拦截 HTTP/HTTPS；主进程通知 runtime 由真实 loopback 本地集成测试覆盖。Windows 沙箱最初无法加载 Electron 页面，之后隔离脚本获自动审批在沙箱外成功运行。没有将这个结果当作生产 cloud 或 Android 系统通知验证。

验证包：`dist/android-only-final-20260910/win-unpacked/Token M.exe`。

界面证据（模拟工作站与模拟 endpoint）：

![Android-only completion settings](../dist/android-only-ui-final-20260910/android-notification-settings.png)

最终 Git 架构建议：origin=TokenM、upstream=原作者、稳定 downstream main + 一条临时 update branch，长期采用 MERGE。当前不能宣称 UPSTREAM_READY：须先在后续授权中完成 ancestry bridge 审查及 Token M 独立更新通道，再执行正式升级与用户新真实任务验收。
