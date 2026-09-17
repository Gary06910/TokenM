# TOKEN_M_DESKTOP_UPSTREAM_INTEGRATION_AUDIT

审计日期：2026-09-10。对象：当前 `token-monitor-wechat-delivery` 工作树，包括已提交改动及本轮开始前的 Android 未提交改动。未修改 Android 源码、后端、AGENTS.md、remote 或现有 Git 历史。

STATUS: TOKEN_M_DESKTOP_ANDROID_ONLY_UPSTREAM_AUDIT_PARTIAL

Legacy removal 和本地验证已完成；尚不能宣称已经具备可直接 merge 的上游关系。首次建立祖先关系、独立更新发布通道，需要以后单独实施。

## ORIGINAL_AUTHOR_REPOSITORY

| 字段 | 当前证据 |
| --- | --- |
| ORIGINAL_AUTHOR_REPOSITORY | https://github.com/Javis603/token-monitor |
| REMOTE NAME | 尚未配置为本地命名 remote；本轮通过 URL fetch |
| CURRENT_ORIGIN | https://github.com/Gary06910/TokenM.git |
| CURRENT_UPSTREAM | 未配置 |
| UPSTREAM_REMOTE_PRESENT | NO |
| RECOMMENDED_UPSTREAM | https://github.com/Javis603/token-monitor.git |
| OTHER_REMOTE | legacy-local → 相邻 token-monitor-main 仓库 |
| UPSTREAM_DEFAULT_BRANCH | main；由 ls-remote --symref HEAD 验证 |
| CURRENT_BRANCH | codex/wechat-integration |
| CURRENT_UPSTREAM_VERSION | 0.54.0；main 在 2026-09-09 仍有后续提交 |
| CURRENT_LOCAL_BASE | 0.45.0；本地根提交 3c3c205，当前已提交基线 32ddd91 |
| CURRENT_REPOSITORY_RELATIONSHIP | COPIED source snapshot + independent downstream Git history |
| UPSTREAM_MERGE_BASE | NOT_IDENTIFIED：git merge-base HEAD FETCH_HEAD 无共同祖先，退出 1 |
| UPSTREAM_FETCH | YES，--no-tags，URL fetch 到 FETCH_HEAD |
| UPSTREAM_MERGE / REBASE / PULL | NO / NO / NO |

来源证据包括 package.json.repository、homepage、作者、发布 owner/repo，及与原作者 v0.45.0 源码的实际比较。本地历史只有从 `chore: establish local source baseline` 开始的一条下游历史，不能因 origin 是 GitHub 仓库就称为具有祖先关系的 Git fork。当前 HEAD 被已有 origin/main 引用包含，说明主要 Token M commits 已出现在远端跟踪历史；本轮 Android 改动仍未提交。多人使用情况无法由 Git 元数据证明。

## Diff forensic 方法及边界

比较使用三个层次：

1. 原作者 v0.45.0 发布提交 42511d0 → 本地初始快照 3c3c205：25 个文件、616 行新增、101 行删除。这些差异在 Token M 首个功能提交之前就存在，来源归属不能擅自推断。
2. 本地初始快照 → 已提交 HEAD：208 个文件、14,112 行新增、1,211 行删除，包含整个历史小程序项目、文档和旧通知功能。
3. v0.45.0 → 当前工作树：包含以上两层、本轮前未提交的 Android 集成，以及本轮移除微信后的结果。另列未跟踪文件，避免仅看 git status 或遗漏已经提交的改动。

v0.45.0 是**同版本上游参照**，不是已证明的 merge-base，也不是已证明的精确源码下载时点。直接拿最新 v0.54.0 与当前工作树相减，会把下游尚未接入的上游改动错误归入 Token M 修改，因此不作为所有权归因基线。

逐文件字段见 [TOKEN_M_UPSTREAM_DELTA_MAP](TOKEN_M_UPSTREAM_DELTA_MAP.md)。冻结的 apps/tokenm-android 子树不作为 Desktop core patch；独立历史小程序资产也不计入 Desktop runtime 冲突面。

## TOKEN_M_DELTA_SUMMARY

| 类别 | 文件 / 行为 | 归属及风险 |
| --- | --- | --- |
| TOKEN_M_OWNED_MODULE | androidClient、androidPayload、androidOutbox、androidNotificationRuntime | Android 四路 HTTP、显式 eventId、allowlist、队列、绑定生命周期；独立模块，低冲突 |
| TOKEN_M_OWNED_MODULE | tokenMNotificationRuntime、codexHookBridge、codexHookForwarder、codexStopHook | 本地 loopback 接收、Codex hooks.json、生命周期；低上游文件冲突，但 Codex 外部 hook 契约仍需验收 |
| THIN_INTEGRATION_PATCH | main.js | import、默认设置、运行时初始化、IPC 注册、退出清理、固定 userData 路径 |
| THIN_INTEGRATION_PATCH | preload.js | Android IPC bridge 与状态订阅 |
| UI_PATCH | renderer/app.js、index.html、i18n.js、styles.css | 完成通知面板、动作、语言、样式；同时混有初始快照 UI 差异，冲突风险 HIGH |
| CONFIG / BUILD | package.json、package-lock.json、签名 artifact 配置 | Token M 品牌与打包；发布源仍指向上游，是功能保留风险 |
| CORE_PATCH | shared/collector.js | 子进程 HOME 对齐 Windows os.homedir，保护 Codex 用量扫描；与通知传输不同 |
| 初始快照差异 | clientSourceIpc、clientSourceCache、clientHealthPresentation、usageAttributionRows | 工具源路径查询、未跟踪工具展示、缓存与 rescan；不能归因为 Android 工作 |
| 初始快照差异 | copilotDeviceFlow、copilotLimits、limitCollector、minimaxLimits | await response.json() 保持异常/超时处理边界 |
| 初始快照差异 | sessionDetail.js | 可注入时钟用于时间范围测试 |
| HISTORICAL / DEAD | notificationOutbox.js、shared/codexCompletion.js | 当前 Android 不导入；仅旧泛用 outbox 测试仍引用。无微信网络调用；暂不扩大删除范围 |
| HISTORICAL / DEAD | wechat-miniapp、docs/wechat-miniapp | 独立历史项目和文档，不在 Desktop package files 中；保留 |

FILES_ADDED_BY_TOKEN_M / UPSTREAM_FILES_MODIFIED_BY_TOKEN_M：完整名单在 delta map。HIGH_CONFLICT_FILES：main.js、renderer/app.js、i18n.js、index.html、styles.css、shared/collector.js；credentialStore.js 文本差异小，但错误修改的数据影响高。

## 扩展机制与 integration points

检查了 plugin、hook、extension、EventEmitter、callback、service/command registration、middleware。未发现原作者提供第三方 Desktop 通知插件注册 API。Electron ipcMain/contextBridge 是现有集成机制；Codex Stop hook 是外部工具输入契约。macOS widget extension 属于系统桌面组件，不是 Token M 插件接口。

没有发现 Token M 运行时 monkey patch、按源码行号替换或生成上游源码补丁。codexStopHook 对 hooks.json 做结构化合并及精确命令身份识别，不属于源码字符串补丁。旧 Windows hook command 识别仍服务当前 Android：必须保留，不能因 legacy 字样误删。

| Integration point | CURRENT_INTEGRATION / UPSTREAM_FILE_MODIFIED | CAN_REDUCE_TO_ONE_HOOK | PROPOSED_ARCHITECTURE |
| --- | --- | --- | --- |
| 1 completion | codexHookBridge onCompletion → android.enqueue；main.js 启动 runtime | YES | 独立 runtime 接收明确 Stop 输入，保持回调参数契约 |
| 2 Settings registration | app.js section registry、index.html 面板、i18n、CSS | PARTIAL | 独立 TokenMNotificationSettings，宿主保留 mount + section registration |
| 3 startup | main.js app.whenReady 中 ensure/start/IPC | YES | installTokenMNotifications 注入 app data、fetch、设置访问 |
| 4 shutdown | main.js shutdownSync | YES | 保留同步退出钩子，不延迟退出，不变更队列语义 |
| 5 credential | credentialStore.js CREDENTIAL_SETTING_PATHS | NO | 保留一个固定 namespace 映射，继续用原私有 store |
| 6 preferences | main.js defaults、readSettings、commit/save | PARTIAL | 独立默认值 / 允许设置键；宿主沿用原原子保存事务 |
| 7 serialization | androidPayload.js | YES | 已独立，不经旧 completion normalizer |
| 8 submission | androidClient.js + androidOutbox.js | YES | 已独立，不新增 provider abstraction |
| 9 pairing | preload IPC → runtime.pairAndroid → Android runtime/client | YES | 单独 IPC installer；保留成组四路 API 方法 |
| 10 status refresh | Android runtime + 60 秒 timer + status IPC | YES | 保留当前 runtime 内生命周期 |

## UNAVOIDABLE_CORE_PATCHES

“不可抽离”表示至少需要一个宿主触点，不能理解为当前整个大文件必须永久保留大段 Token M 代码。CURRENT_SIZE 为相对 v0.45.0 的整个文件差异或明确符号范围，不伪装为某个子功能的精确行数。

| PATCH / UPSTREAM_FILE | WHY_REQUIRED / WHY_CANNOT_EXTRACT | CURRENT_SIZE | CAN_REDUCE / RECOMMENDED_FINAL_FORM | RISK |
| --- | --- | --- | --- | --- |
| app lifecycle / main.js | 宿主拥有 Electron ready、退出和 settings 事务；独立模块不能自行获得这些生命周期 | 见 delta map 的 main.js 总量 | YES；启动安装函数 + 同步退出函数 | HIGH |
| settings hosting / renderer/app.js、index.html | 上游无插件挂载接口，需要实际 DOM 和 section entry | 见每文件 numstat；混有初始快照 UI 改动 | YES；独立面板、mount、section 注册，不能消除宿主锚点 | HIGH |
| credential namespace / credentialStore.js | 统一 store 用固定映射提取及默认拒绝向 renderer 暴露敏感值 | tokenMAndroidCredential 一条映射 | NO；维持显式映射，不造第二套 store | MEDIUM |
| app identity / main.js、package.json | userData 必须保持 Token Monitor，品牌与安装/发布身份由宿主决定 | APP_NAME、LEGACY_USER_DATA_PATH、build 字段 | PARTIAL；固定数据身份，分离下游 release config | HIGH |
| Windows scan root / shared/collector.js | 在创建 tokscale 子进程时注入 HOME 才能与源探测一致；UI 或通知层无法修正 | +32/-8，相对本地初始快照 | PARTIAL；先核对新版 upstream 是否已有等价修复，再保留最小 spawn 参数补丁 | HIGH |

初始快照的 await-json 补丁各 +1/-1，sessionDetail +2/-1。它们改变已有 provider/session 核心行为，不能搬入 Android 模块；未来逐项对照上游是否已吸收。不要借通知重构再次移植这些差异。

## TOKEN_M_MODULE_EXTRACTION_PLAN

REFACTOR_NOW: PARTIAL（本轮实施范围为移除旧 runtime 和修正 Android 面板；下述文件搬迁暂缓）。

CURRENT: Electron 原生 CommonJS + 普通 renderer JS/HTML/CSS，无 React 组件系统。

TOKEN_M_MODULE_ROOT: 建议 `src/electron/tokenm/`，沿用现有包文件范围。

TARGET / FILES_TO_MOVE：

- P0：四个 android*.js 与 tokenMNotificationRuntime.js 移入 tokenm；仅更新相对 import 和测试，不重写协议。
- P0：从 app.js 抽出 TokenMNotificationSettings 控制器及面板样式。当前不是 React，不新增框架。
- P1：把 main.js 的通知 IPC 注册与默认设置整理为独立函数，注入既有 commitSettings/fetch/userData。
- P1：Codex hook 三文件一起整理；移动 forwarder 会改变已登记的绝对路径，必须连同旧安装命令识别与用户信任验收处理，不能当无语义移动。
- P2：只有实际上游冲突证明有收益时才拆分语言片段；不创建 PluginManager / EventBusFramework。

FILES_TO_KEEP_UPSTREAM: main.js、preload.js、renderer/app.js/index.html、credentialStore.js、package/release config 中少量宿主注册点。

HOOKS_REQUIRED: startup/install、shutdown、settings mount、preload exposure、credential namespace 五类边界。EXPECTED_UPSTREAM_PATCH_COUNT: 约 5 个运行时集成边界，实际至少 6 个源文件，加独立语言/构建改动；不是承诺只剩 5 个文件。

EXPECTED_CONFLICT_SURFACE_REDUCTION: HIGH，主要来自把 renderer 行为从大 app.js 移出，而非机械移动本来就独立的 client 文件。

DO_NOW: 删除已审计的微信专属模块/测试；Android-only runtime；移除 target；保留当前四个 Android 模块；补行为契约与局部样式。

DEFER: 文件搬迁、Codex helper 路径变动、大面板抽离、首次历史接入、更新发布源。工作树已有大量未提交基线，此时叠加搬迁会降低审计清晰度；应在一次明确受控变更中进行。

## Git 与 release architecture

RECOMMENDED_REMOTE_MODEL: origin = Gary06910/TokenM；upstream = Javis603/token-monitor。legacy-local 暂保留，仅历史来源。

RECOMMENDED_SYNC_STRATEGY: MERGE。

RATIONALE: 这是已发布 commits 的长期 downstream，反复 rebase 会改写可追溯的 Token M 历史。临时 update 分支上的 merge 能保留上游来源和冲突解决记录。没有证据支持把本轮全部现有 commits rebase 到未知起点。

BRANCH MODEL: origin/main 为通过验收的 Token M downstream；upstream/main 只作 remote-tracking；每次一条临时 update 分支，不增加 vendor-base 常驻分支。

FIRST-INTEGRATION BLOCKER: 当前无共同祖先。普通 `merge upstream/main` 不能直接使用。未来先在隔离 worktree，把**经人工复核的 v0.45.0 参照**建立一次明确的 ancestry bridge，再升级。具体双亲 merge 方案、25 个初始差异保护和退出方式见更新指南。禁止在本轮执行，禁止用未经审计的最新 upstream 做 ours 合并来虚假宣布所有上游变更已包含。

UPDATE-CHANNEL BLOCKER: package.json build.publish 仍为 Javis603/token-monitor；main.js 使用 electron-updater.checkForUpdates/downloadUpdate/quitAndInstall。原作者二进制会替换 Token M 代码，即使 userData 幸存也会丢失功能。automaticAppUpdates 当前默认 false，但手动更新入口仍在。发布新稳定版前，必须配置并验证独立 Token M release feed、签名、artifact 名与 version strategy；本轮不擅自设置一个未验证可工作的私有仓库 feed。

## 原作者发布结构

DEFAULT_BRANCH: main。RELEASE_BRANCH: 未发现独立 release branch；远端为 main 和功能/修复分支。

TAG_STYLE: v0.x.0（已看到 v0.50.0 至 v0.54.0，含 annotated tag 的 peeled commit）。VERSION_SOURCE: package.json，并与 lock/version 发布提交协调。

RELEASE_NOTES_LOCATION: GitHub Releases、.github/RELEASE_TEMPLATE.md、.github/RELEASE_NOTES_FORMAT.md。RELEASE_WORKFLOW: .github/workflows/release.yml，在 v* tag push 后运行 Windows/macOS/Linux 构建；不是提交到 main 就直接安装到用户机器。

RELEASE_CADENCE: 近期 v0.48.0（8/26）、v0.49.0（8/28）、v0.50.0（8/30）、v0.51.0（8/31）、v0.52.0（9/2）、v0.53.0/v0.54.0（9/4），更新频繁，不构成未来时间承诺。以后优先审计稳定 release tag，main 只用于观察。

## TOKEN_M_DATA_UPDATE_SURVIVAL

DESKTOP_CREDENTIAL_STORAGE: `CredentialStore` → userData/credentials.json → credentials.tokenM.androidCredential。

CODE_LOCATION: src/shared/credentialStore.js；main.js ensureCredentialStore/readSettings/saveSettings；androidNotificationRuntime.pair/unpairSelf。

USER_DATA_LOCATION: Windows `%APPDATA%\Token Monitor`（通常 `C:\Users\Gary\AppData\Roaming\Token Monitor`）；代码由 app.getPath('appData') 推导。未打开或输出实际用户 credential 文件。

INSIDE_SOURCE_TREE: NO。INSIDE_INSTALLATION_TREE: NO。CURRENTLY_INSIDE_INSTALL_TREE: NO。

SURVIVES_SOURCE_UPDATE / SURVIVES_UPSTREAM_MERGE: YES，文件位置与源码独立；这是代码路径审计结论。

SURVIVES_APPLICATION_UPDATE: DEPENDS，保持上述 userData identity 且安装器不清理该目录时 YES；当前数据路径 pin 正确。不能将一次临时目录的重载测试描述为已执行真实应用升级。

SURVIVES_REINSTALL: DEPENDS，保留用户目录时恢复；清理用户数据、换 Windows 账号/机器、手动删目录均不保证。

PAIRING_STATE: 凭证在 private store；desktop ID/name、enabled 在 settings.json。SETTINGS / PRIVACY_MODE: userData/settings.json 中 tokenMAndroid*。OUTBOX: 同目录 token-m-android-outbox-<desktopId>.json，按绑定身份隔离。

安全属性：现有 store 是**文件权限保护的本地明文 JSON**，不是 OS Credential Manager、不是加密存储；POSIX 0600，Windows 依赖用户目录 ACL。保持原方案，无新增凭证明文 repository config，无输出真实 credential。读取、保存和 renderer 脱敏继续走原子事务和允许列表。

旧凭证 namespace 已从运行时映射移除；CredentialStore 保留不认识的磁盘文档字段，不清空旧 credential 文档。设置加载仅接受当前 tokenM 默认键，旧通知设置不进入活动设置、UI 或新保存内容；没有执行磁盘删除迁移。普通后续保存会序列化当前设置，不能承诺历史 settings 键永久原样保留。

ACTION_REQUIRED: 保持 appData/Token Monitor pin、credential namespace、outbox 命名和 settings 键；升级前用隔离副本重载；发布 feed 改为已验证 Token M 通道；安装路径改变后重新确认 Codex hook 的绝对 executable/helper 路径及信任状态。

UPDATE_SURVIVAL_DEFECT: 未发现 credential 存入源码/安装树。已发现更新通道可覆盖功能，以及移动源码或换安装路径可能使旧绝对 hook 路径失效，两者需独立 gate，不能与“凭证文件仍在”混为一谈。

## TOKEN_M_INTEGRATION_CONTRACT_TESTS / UPDATE_GATE

| Gate / 契约 | 本轮覆盖 | 未来通过条件 |
| --- | --- | --- |
| 1 原程序 build | dist:win:dir | 目标平台构建成功；其他平台按发布目标运行 |
| 2 原程序基本行为 | npm run verify | 用量、设置、托盘、窗口、Hub 测试通过；真实操作另验 |
| 3 设置面板 | tokenmRendererAcceptance.cjs | 实际 Electron DOM 可展开、Android 状态可见 |
| 4 Android only | tokenMIntegrationContract + renderer | 无微信控件、无 selector、无微信源代码引用 |
| 5 credential | androidSettings + credentialStore tests | 新 store 实例重载凭证，settings/renderer 不泄漏 |
| 6 pair/status/unpair | androidClient + androidNotificationRuntime | 四个冻结 HTTP route、鉴权和绑定状态契约通过 |
| 7 completion/module/eventId | tokenMNotificationTarget + codexHookBridge/Forwarder/StopHook | 真实 loopback Stop 到 Android mock；evt:session:turn 保持 |
| 8 privacy/full/allowlist | androidPayload + renderer acceptance | 两种模式与内容允许列表保持；未知敏感字段拒绝 |
| 9 duplicate semantics | androidOutbox + tokenMNotificationTarget | 队列去重、重启、重试同 ID、服务端 duplicate 响应保持 |
| 10 endpoint/event submit/real acceptance ready | androidClient + runtime tests | URL path root 保持；所有自动测试 mock；最后等待用户新真实任务 |

本轮没有新增源码快照、行号断言或校验值机制。负向 runtime 字符串检测是“微信不应再出现”的产品约束；真正的正向 gate 以 IPC 调用、loopback 事件、队列和渲染行为为主。

测试证明 Desktop 契约保持，不替代真实生产 provider 接受。冻结后端的 at-most-once Push 不在本轮重新实现。Desktop 成功发送后再次收到同一完成事件可能再次提交**同一个 eventId**，服务端 duplicate 保证任务/Push 不重复；不能错误宣称永久客户端只发一次。
