# Worker B Prompt — CloudBase Backend

Model requirement: GPT-5.6 Sol, reasoning effort high.

Work only in isolated branch/worktree `codex/wechat-backend`. Read `AGENTS.md` and every frozen file in `docs/wechat-miniapp/` before coding. Treat API/DATA/SECURITY contracts as immutable.

Ownership: only `wechat-miniapp/cloudfunctions/tokenm-api/**`. Do not modify Mini Program UI, Desktop, packaging/deployment docs, or frozen contracts.

Build the real production CloudBase Node.js function, not a demo. Structure the function into small domain modules with injected clock/random/repository/sender so pure tests exercise the same production use cases. The production entry must initialize `wx-server-sdk` with `DYNAMIC_CURRENT_ENV`, read `getWXContext()` inside each miniapp invocation, route HTTP gateway events, use CloudBase database transactions, and call the real `cloud.openapi.subscribeMessage.send`. Mock sender is test-injected only; missing production config fails closed.

Implement: bootstrap, dashboard, task queries/cursor/ownership, desktops list/rename/unbind, CSPRNG six-digit pairing with HMAC pepper/TTL/rate limit/single use, credential issue/hash/auth/revoke, exact event schema/privacy allowlist/canonical digest, deterministic task/delivery idempotency, task-first persistence, notification setting, quota grant intent/finalize, atomic reservation/finalize/release, at-most-once provider claim, provider error classification, unknown reconciliation state, history/account deletion, bounded cleanup, structured redacted security events.

Provider configuration must support real template ID/keyword mapping/miniprogram state/lang and enforce official keyword limits. Do not store AppSecret or manually fetch access_token; use cloud openapi permission in `config.json`.

Implement backend unit tests in your owned directory for PAIR-01..04, AUTH-01..02, EVENT-01..04, QUOTA-01..05, PRIVACY-01..02 server half, OWNERSHIP-01..02, DELETE-01. Tests must include concurrent event quota=1 and same eventId x3. Do not weaken production code for mocks.

Contract issue procedure: report `CONTRACT_CHANGE_REQUEST` instead of altering frozen semantics.

Run exact scope tests and `git diff --check`, commit conventionally, and report SHA/files/commands/pass counts/known limitations. No AI co-author trailer.
