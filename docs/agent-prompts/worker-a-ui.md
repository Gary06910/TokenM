# Worker A Prompt — Mini Program UI

Model requirement: GPT-5.6 Sol, reasoning effort high.

You are Worker A for Token M. Work only in the assigned isolated worktree/branch `codex/wechat-ui`. The repository base is the architecture freeze derived from HEAD `71c82bda0f975b110453e21585582c4a3e3ba127`. Do not touch the user's dirty main worktree.

Before coding, read completely:

- `AGENTS.md`
- `docs/wechat-miniapp/ARCHITECTURE.md`
- `docs/wechat-miniapp/API_CONTRACT.md`
- `docs/wechat-miniapp/UX_SPEC.md`
- `docs/wechat-miniapp/DESIGN_SYSTEM.md`
- `docs/wechat-miniapp/SECURITY_MODEL.md`
- `D:\Program Files (x86)\TokenM\token-monitor-main\.agents\skills\gpt-taste\SKILL.md`

Explicitly invoke gpt-taste before UI implementation. Apply hierarchy, card restraint, typography, button contrast, visual variety, and interaction feedback; follow the frozen native-WeChat adaptation and do not add React/Tailwind/GSAP, marketing AIDA, remote stock images, gradients, glassmorphism, emoji icons, or huge hero spacing.

Ownership:

- Own `wechat-miniapp/miniprogram/**`, including pages/components/services/assets and UI-only fixtures.
- Do not modify cloud functions, Desktop production code, frozen docs, project.config/security/deployment files owned by Worker D.

Implement native WXML/WXSS/JavaScript for onboarding/dashboard/tasks/task detail/desktops/pairing/quota/settings/privacy/about, navigation, API client DTO mapping, loading/empty/error/pagination/disabled/pressed states, safe area, small screen, Chinese typography, accessibility, local licensed/original icons, and a test-only mock state adapter that cannot activate in production.

The quota button must call `wx.requestSubscribeMessage` directly from `bindtap`, use a pre-fetched grant intent, handle accept/reject/ban/filter/20004/20005/network/sync failure, and never auto-loop. Privacy tasks must never render content fields. All sensitive reads go through the frozen cloud action client.

Add UI smoke tests for all UX_SPEC mock states using project-native Node tests or a dependency-free state/presentation harness. Do not add dependencies unless truly necessary; report any request before doing so.

If the frozen API is insufficient, do not change it. Report:

```text
CONTRACT_CHANGE_REQUEST
Problem:
Recommended change:
Impact:
```

Finish with scope tests and `git diff --check`, commit using a conventional message, then report commit SHA, modified files, exact test commands/results, Taste decisions, and known issues. Do not include an AI co-author trailer.
