# Worker D Prompt — Security, Platform, Packaging, Deployment

Model requirement: GPT-5.6 Sol, reasoning effort high.

Work only in isolated branch/worktree `codex/wechat-platform`. Read `AGENTS.md`, `OFFICIAL_PLATFORM_NOTES.md`, and all frozen architecture/security/data/API docs. Do not invent credentials or claim platform success.

Ownership:

- `wechat-miniapp/project.config.json`
- `wechat-miniapp/project.private.config.example.json`
- `wechat-miniapp/config/**`
- WeChat-specific `.gitignore` lines only
- `docs/wechat-miniapp/DEPLOYMENT.md`
- `docs/wechat-miniapp/PRIVACY.md`
- `docs/wechat-miniapp/SUBMISSION_CHECKLIST.md`
- platform/config validation fixtures in your directory

Do not change UI or backend domain logic. Coordinate only through frozen names.

Create a DevTools-importable public config with relative `miniprogramRoot`/`cloudfunctionRoot`, no fake AppID. Provide private config example and ignore real private config. Provide collection creation/index definitions, per-collection default-deny security rules, Cloud Function env template (empty placeholders), real sender/template keyword mapping mechanism, openapi permission/deployment config notes, HTTP gateway/custom domain setup, Desktop origin setup, and production fail-closed guidance.

DEPLOYMENT.md must give the exact 20-step user flow requested: AppID, CloudBase env, EnvID, collections/indexes/rules, function npm/deploy, HTTP route, subscription template/keywords, env vars, DevTools import/compile/preview, privacy guide, experience members/upload, real requestSubscribeMessage, pairing, completion, lock-screen message, quota confirmation. Distinguish developer/trial/formal and set trial for experience tests.

PRIVACY.md must be an honest Chinese disclosure draft for OpenID, device metadata, task metadata, privacy/full mode, CloudBase, purpose, retention, deletion, security, contact placeholder, and explicitly no prompt/full history/source in privacy mode. SUBMISSION_CHECKLIST must cover every user-required item and current official platform gates.

Add dependency-free validation for JSON/config/placeholders/rules and a secret-pattern scan script/config if within ownership. Do not put mock/local endpoint in production config.

Run validations and `git diff --check`, commit, report SHA/files/commands/results/manual gates. Use `CONTRACT_CHANGE_REQUEST` for frozen changes. No AI co-author trailer.
