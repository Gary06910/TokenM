# TOKEN M ANDROID PERFORMANCE BASELINE

Recorded before performance source edits, 2026-09-09.

CURRENT_BASELINE: TOKEN_M_PHASE2_BASE_UNIPUSH_RUNTIME_PASS

The following is the user's real runtime acceptance, preserved as the baseline, not a new measurement by this task.

| Phase | Verified item | Result |
| --- | --- | --- |
| 1 | Android register/login | PASS |
| 1 | Captcha | PASS |
| 1 | Light theme | PASS |
| 1 | Android ↔ Desktop pairing | PASS |
| 1 | Desktop credential | PASS |
| 1 | Desktop event | PASS |
| 1 | tokenm-tasks persistence | PASS |
| 1 | Android task list and detail | PASS |
| 1 | Desktop list and online status | PASS |
| 2 | Notification permission | PASS |
| 2 | Runtime CID and CID registration | PASS |
| 2 | Push eligibility and target | PASS |
| 2 | uni-push 2.0 provider submission | PASS |
| 2 | notificationProviderCode | 0 |
| 2 | Honor Android system notification | REAL RUNTIME PASS |

Frozen identity: uni-app x, VDOM; HBuilderX 5.24.2026081301; AppID __UNI__46C9063; package com.gary.tokenm; Alipay uniCloud tokenm-prod / env-00jy6pbiul92. Desktop → uniCloud → uni-push 2.0 → Android remains the primary architecture.

## Working tree at takeover

Pre-existing modified files: .env.example, AGENTS.md, eslint.config.js, src/electron/main.js, src/electron/preload.js, src/electron/renderer/app.js, src/electron/renderer/i18n.js, src/electron/renderer/index.html, src/electron/renderer/styles.css, src/electron/tokenMNotificationRuntime.js, src/shared/credentialStore.js.

Pre-existing untracked paths: apps/, docs/android/, tests/android/, src/electron/androidClient.js, src/electron/androidNotificationRuntime.js, src/electron/androidOutbox.js, src/electron/androidPayload.js, tests/electron/androidClient.test.js, tests/electron/androidNotificationRuntime.test.js, tests/electron/androidOutbox.test.js, tests/electron/androidPayload.test.js, tests/electron/androidSettings.test.js, tests/electron/tokenMNotificationTarget.test.js.

AGENTS.md was already modified on arrival; this task must not edit it. The Android source is already untracked, so ordinary git diff alone cannot identify performance edits. Before editing, the services, pages and custom navigation component were copied to tmp/android-perf-baseline-20260909, alongside the original git status and a relative source-file inventory. No commit or tag was created; no fingerprints were generated.

DEVICE_TIMING: UNMEASURED_ON_DEVICE. No baseline APK rebuild, deployment or phone timing is claimed.
