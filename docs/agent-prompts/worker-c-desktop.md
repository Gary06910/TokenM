# Worker C Prompt — Token M Desktop WeChat Integration

Model requirement: GPT-5.6 Sol, reasoning effort high.

Work only in isolated branch/worktree `codex/wechat-desktop`. Read `AGENTS.md`, all frozen docs, and audit the current notification pipeline before editing: `src/shared/codexCompletion.js`, Stop Hook/bridge/forwarder, notification outbox, cloud clients, runtime, credential store, settings IPC/UI, and tests.

Important: the user's main worktree already has uncommitted edits in `codexHookForwarder.js`, `codexStopHook.js`, `tokenMNotificationRuntime.js`, credential-adjacent tests and other files. Your branch starts from the confirmed HEAD, so never assume your version supersedes those edits. Keep shared touch patches minimal and report exact hunks so Lead can merge manually. Never touch or delete `spikes/` or legacy mobile notification route behavior.

Ownership:

- New files: `src/electron/wechat*.js`, `tests/electron/wechat*.test.js`.
- Minimal shared touch only when required: `src/electron/tokenMNotificationRuntime.js`, `main.js`, `preload.js`, notification settings HTML/JS/CSS/i18n, `src/shared/credentialStore.js`, `.env.example`, package build file list/scripts.
- Do not modify `wechat-miniapp/**` backend/UI.

Implement one-Hook fan-out: the existing local bridge normalizes each Stop once; both existing notification route and WeChat transport receive independent durable enqueue operations. WeChat-only configuration must still allow the same Hook/bridge to run. One route failure cannot block the other or Codex completion.

Implement Desktop pairing claim using 6-digit code and preconfigured/advanced CloudBase API origin, validate response credential, atomically save `tokenMWeChatCredential` in existing private store, never expose it to renderer/logs. Add status/rename link if appropriate, unpair-self, enable toggle, default privacy/full explicit mode, exact allowlist payload mapper, existing stable eventId mapping to frozen `codex.task.completed`, HTTPS origin rules, 5s timeout, durable dedupe outbox, bounded exponential full-jitter retry, terminal/credential suspension, short redacted diagnostics.

Full mode may use raw Stop input only for allowed project/model/last assistant summary and must cap/sanitize. Privacy mode must omit/null all content and never include cwd/prompt/conversation/source. Do not install another Codex Hook.

Add tests for privacy/full mapping, pairing response validation, credential redaction, local duplicate enqueue, retry classification, one-Hook fan-out, Android route unaffected, and desktop/backend HTTP mock. Run focused tests and `git diff --check`; commit and report SHA/files/tests/known issues/shared overlap. Use `CONTRACT_CHANGE_REQUEST` if needed. No AI co-author trailer.
