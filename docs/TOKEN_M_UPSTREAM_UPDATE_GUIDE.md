STATUS: SUPERSEDED

SUPERSEDED_BY: TOKEN_M_DESKTOP_INDEPENDENT_PRODUCT_MIGRATION

Token M has transitioned to an independently maintained product.
Upstream releases are no longer used as the production update channel.
This document is retained only for historical / source ancestry reference.

# Token M Desktop Upstream Update Procedure

适用仓库：Gary06910/TokenM，长期策略为 **MERGE**。本轮仅设计，未执行本文件中的 remote/branch/merge/commit/tag/push 命令。

## 首次接入前提

当前本地历史与原作者无共同祖先。不要直接 pull、rebase 或把新版压缩包覆盖当前目录。先保存和审阅现有未提交变更，通过明确路径暂存、由维护者建立稳定 commit；不要 git add . / -A、stash、reset --hard 或 clean。

以下 remote 配置需要维护者确认后才执行一次：

```powershell
git remote add upstream https://github.com/Javis603/token-monitor.git
git fetch upstream --no-tags
```

上游 tag 与下游 tag 放在不同命名空间，避免将来 v0.x.0 撞名：

```powershell
git fetch upstream 'refs/tags/*:refs/tags/upstream/*'
```

推荐一次性建立经审计的历史桥接：原作者 v0.45.0（42511d0）是可用参照，但本地初始快照比它多了 25 个文件差异。必须先逐项复核 delta map 中的初始差异，并确认该发布是愿意承认的基础。此操作保留当前 Token M 树和已有历史，仅增加上游基础为第二父提交；它不导入新版功能。

在干净、已经保存的稳定基线上，用独立 worktree：

```powershell
git worktree add -b update/upstream-ancestry '..\tokenm-upstream-ancestry' HEAD
git -C '..\tokenm-upstream-ancestry' merge --no-commit --no-ff --allow-unrelated-histories -s ours refs/tags/upstream/v0.45.0
git -C '..\tokenm-upstream-ancestry' diff --cached --exit-code
git -C '..\tokenm-upstream-ancestry' status
```

这一步只能针对已审计的旧参照使用 `-s ours`，绝不能针对最新 main 使用，否则会掩盖尚未导入的上游功能。通过审查后由维护者提交，说明 copied-history bridge 与初始快照差异；验证 merge-base 能识别该基础。不同意承认该基础时停止桥接，改为单独的新下游分支从已验证 upstream baseline 一次性重放经审计补丁，不能自动猜测祖先。

不要在稳定目录进行这一步。未完成的 merge 可在隔离目录用 `git merge --abort` 退出；保留 worktree 供检查，不要求删除目录。

## 每次更新的 12 步

下面以 v0.54.0 为**本次审计时的示例**。以后先选择具体 release，不盲目合并当时最新 main。仅在首次 ancestry 已建立后使用。

1. 确认工作区：`git status --short`、`git branch --show-current`、`git worktree list`。必须从已验收的干净稳定 commit 开始。
2. 获取原作者更新：`git fetch upstream --no-tags`，再执行上述 namespaced tags fetch。
3. 查看 [原作者 release notes](https://github.com/Javis603/token-monitor/releases)、仓库 `.github/RELEASE_NOTES_FORMAT.md`；记录选定版本、依赖与平台变化。
4. 查看 diff：`git log --oneline HEAD..refs/tags/upstream/v0.54.0`，`git diff --stat HEAD...refs/tags/upstream/v0.54.0`；重点审查 main、renderer、credentialStore、collector、preload、package/build。
5. 创建临时分支和目录：`git worktree add -b update/upstream-v0.54.0 '..\tokenm-update-v0.54.0' HEAD`。该路径和分支不存在时才使用。
6. 在隔离 worktree 合并：`git -C '..\tokenm-update-v0.54.0' merge --no-commit --no-ff refs/tags/upstream/v0.54.0`。
7. 解决冲突：按 delta map 逐文件复核。用 `git diff --name-only --diff-filter=U` 定位；只对已审阅的明确文件 `git add -- '具体文件'`。保留 Android API、隐私策略、凭证 namespace、事件 ID、同步 shutdown 和 userData pin。没有“整文件选 ours/theirs”默认规则。
8. 原应用验证：在隔离 worktree 运行 `npm ci`、`npm run verify`；按 Node 22.13+ 要求。阅读依赖和 package scripts 后再安装/构建，不新增自动源代码补丁或校验机制。
9. Token M 契约：执行下方测试命令与离屏 Electron 验收；模拟凭证重新加载、pair/status/unpair、隐私/full、重复事件。自动测试不能使用生产 credential 或生产 endpoint。
10. 构建：`npm run dist:win:dir -- --config.directories.output=dist/upstream-v0.54.0-validation`。选择尚不存在的输出目录；其他平台按现有 scripts 构建。检查 app.asar 含 Android 模块、不含旧微信模块。发布前验证 Token M 专属更新通道和签名配置。
11. Runtime acceptance：启动隔离用户目录中的候选应用，检查正常仪表盘、设置、状态与 hook；用隔离数据副本检查 update/reinstall survival。全部本地 gate 通过后，用户完成一个新的真实 Codex task 验收 Android；禁止合成生产事件、历史重放或直接 provider 请求。
12. Promote baseline：维护者确认结果后提交 merge；将下游稳定 main 快进到已验收候选，发布到已验证的 Token M feed。保留上一个稳定 commit 和安装包以便恢复。提交、推送、tag、发布均由后续明确授权执行。

失败时停留在 update worktree，稳定分支不变。merge 尚未提交可 `git merge --abort`；已经提交则保留候选分支供复盘，不能对稳定目录 reset --hard。需要清理目录时遵守用户的逐文件删除限制。

## 本地契约命令

```powershell
node --test tests/electron/android*.test.js tests/electron/tokenM*.test.js tests/electron/codexHook*.test.js tests/electron/codexStopHook.test.js tests/shared/credentialStore.test.js
.\node_modules\.bin\electron.cmd tests/helpers/tokenmRendererAcceptance.cjs 'D:\Program Files (x86)\TokenM\tokenm-update-v0.54.0\dist\renderer-acceptance'
```

第二条必须改成当前 update worktree 下的绝对新输出路径。脚本只 mock IPC，阻断 HTTP/HTTPS，隔离 Electron userData；它验证实际 renderer 和 preload，主进程 runtime 由 loopback/HTTP contract tests 覆盖。不可把这个结果写成已经完成生产 pairing 或 Push 验收。

## Release 与数据 gate

- 当前 build.publish 仍指向原作者；在完成 Token M 独立更新源前，禁止把“跟随上游更新”理解为点击原作者二进制升级。默认自动更新关闭不等于手动更新安全。
- `%APPDATA%\Token Monitor\credentials.json` 与 settings.json、Android outbox 应保持原路径和 namespace。不要放入源码、build 或 Git。
- 完成通知入口、四路 API、eventId、allowlist、duplicate、状态订阅和关闭行为必须全部通过审计报告的十个 gate。
- Codex hook 登记了绝对 executable/helper 路径；换源码目录、安装目录、移动 forwarder 后，要重新登记并按 Codex 要求确认信任。凭证保留不能证明 hook 路径仍有效。
- 本轮没有执行真正升级。v0.54.0 只是已检索到的发布版本，不代表已经合入 Token M。
