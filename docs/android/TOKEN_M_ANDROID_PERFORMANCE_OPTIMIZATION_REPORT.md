# TOKEN_M_ANDROID_PERFORMANCE_OPTIMIZATION_REPORT

STATUS: TOKEN_M_ANDROID_PERFORMANCE_OPTIMIZED_READY_FOR_CLOUD_BUILD

MODEL: GPT-6 Astra

BASELINE: TOKEN_M_PHASE2_BASE_UNIPUSH_RUNTIME_PASS

BASELINE_PRESERVED: YES — source contracts and automated regression checks; the user's prior real-device acceptance remains the baseline. New APK runtime acceptance is pending.

USER_REPORTED_SYMPTOM: 首页 ↔ 任务、电脑、设置切换慢；页面最终正确，但等待明显。

Date: 2026-09-09. Repository: D:\Program Files (x86)\TokenM\token-monitor-wechat-delivery.

## Evidence and navigation architecture

The pre-edit [baseline](TOKEN_M_ANDROID_PERF_BASELINE.md) records the verified functional paths and pre-existing working-tree changes. The pre-edit [forensic report](TOKEN_M_ANDROID_PERFORMANCE_FORENSIC.md) contains the full per-page call graph, wider lifecycle audit, ranked causes, and before inventory.

NAVIGATION_ARCHITECTURE: the existing custom four-column navigation still uses uni.reLaunch, with no native tabBar in pages.json. Each switch creates a new page instance. This patch reuses bounded service-level snapshots across that recreation; it does not replace the router or change back/deep-link behavior. The tiny navigation wrapper also records a user-tap timestamp. [DCloud navigation documentation](https://doc.dcloud.net.cn/uni-app-x/api/navigator.html).

PAGE_LIFECYCLE_AUDIT: Home, Desktops and Settings use onShow. Tasks now uses onShow instead of onLoad so returning from a detail page revalidates data too. All four restore existing data synchronously, then invoke an async loader through a synchronous lifecycle callback. onReady marks shell readiness. App.onLaunch/onShow, onboarding, permission and notification activation retain their established initialization paths. Detailed audit of task detail, inline desktop management, pairing, notifications, privacy, auth, permission, watchers and computed values is in the forensic report.

## Root causes

| Cause | File / function | Behavior and latency mechanism | Confidence |
| --- | --- | --- | --- |
| RC1 | components/tm-tab-bar/tm-tab-bar.uvue::switchTab; four page initializers | reLaunch discarded local refs; every recreated content area started loading, even after a successful prior visit | High, direct source evidence |
| RC2 | services/client-runtime.uts::ensureProtectedClientRoute / runBootstrapClientRuntime; dashboard/settings::runLoad | Page reads waited for privacy, local CID acquisition, uni-id setPushCid and business mobile registration; in-flight bootstrap dedup did not help consecutive visits | High, direct source evidence |
| RC3 | services/tokenm-service.uts::getDashboard / listTasks; tasks::runLoadFirst | Home serialized three independent reads; Tasks read desktops once for filters and again for names; Settings repeated Home's settings read | High, direct source evidence |
| RC4 | tasks/desktops::refresh / error handling | Empty successful lists and revoked-only lists were treated as no prior data, producing loading/error replacement during refresh | High, direct source evidence |

The header and bottom navigation were already outside the network loading gate. This was primarily a meaningful-content delay, not proof that the shell itself waited for JavaScript promises. Actual page creation/rendering cost remains unmeasured.

## Selected optimizations

OPT1: Four typed in-memory snapshots retain only existing display data: Home, default task first page, desktops and the remote notification boolean. Page setup/onShow restores real previous content before remote consent and data checks complete. Successful empty lists are reusable content.

OPT2: prepareClientPage performs local UID/expiry and OS permission checks, then the server consent read. It does not start or await CID/Push registration. Every new protected page read still goes through that consent check; tokenm-co still verifies tokens and server-derived ownership. Consent is not given a time-based validity shortcut. Overlapping consent requests share one promise.

OPT3: Home's three independent business reads run together with concrete typed callbacks returning void. The generated Kotlin uses UTSPromise.all<Unit>, avoiding the project's documented heterogeneous-array release issue. Task data and desktop-name reads also run together. The desktop list has one shared freshness/in-flight path, and Settings reuses the boolean returned by Home. [DCloud UTS Promise API](https://doc.dcloud.net.cn/uni-app-x/uts/buildin-object-api/promise.html).

OPT4: Resource-specific invalidation follows existing mutations. Settings writes defeat older reads; task clear defeats old filtered/paginated responses; account/expiry changes defeat all old responses. Push receipt/click only expires task-derived snapshots, preserving the established notification listener and routing behavior.

No prefetch, new polling, new dependency, data database, virtual list, UI redesign, native Tab migration or backend aggregation was added. The existing visible-pairing status/countdown timers remain unchanged.

## Network request inventory

STATIC_CALL_GRAPH_ESTIMATE: Home initial load → Tasks → Desktops → Settings → Tasks. Same user, current consent, successful requests settle before the next tap; no separate application foreground cycle. The fast-cycle estimate assumes reuse occurs inside the 5-second data and 15-second settings freshness windows. Home starts with no business cache.

| Request | Before | After, short cycle | Required / dedup result |
| --- | ---: | ---: | --- |
| getPrivacyConsent | 5 | 5 | Retained server-backed route check; concurrent calls only are deduplicated |
| getPushClientId, local callback | 5 | 0 | Not a cloud request; removed from page path |
| uni-id-co.setPushCid | 5 | 0 | Remains App/explicit activation work |
| registerMobileDevice | 5 | 0 | Remains App/explicit activation work |
| getDashboard | 2 | 1 | Home seeds remote notification setting |
| listTasks | 3 | 2 | Home limit 5; first Tasks limit 20; second Tasks reuses |
| listDesktops | 6 | 1 | Shared by Home, names, filters and desktop page |
| business bootstrap API | 0 | 0 | Permission page only, outside this cycle |
| tokenm-co total | 21 | 9 | Read/write contracts unchanged |
| all cloud calls | 26 | 9 | 17 fewer calls in the stated short-cycle scenario |

NETWORK_REQUEST_INVENTORY_BEFORE: 26 calls with previously activated Push, 16 without Push activation. This is a source-derived estimate, not production telemetry.

NETWORK_REQUEST_INVENTORY_AFTER: 9 short-cycle calls, also exercised in the UTS algorithm test harness. If each visit occurs after relevant freshness windows expire, the same successful cycle is approximately 14 calls: 5 consent, 2 dashboard, 3 tasks, 4 desktops. App foreground registration, failures/retries, mutations, manual refresh and other pages add their own calls. No fixed reduction is promised for every usage pattern.

BLOCKING_AWAITS_BEFORE: Home content follows runtime consent/CID/setPushCid/register and three serial reads; Tasks follows runtime and three reads; Desktops and Settings follow runtime and one read each. The shell itself is outside those gates.

BLOCKING_AWAITS_AFTER: Warm restored content has no remote await dependency. Cold content still requires consent followed by its own read(s); Home/Tasks independent business reads run concurrently. OS notification permission lookup is local. Manual refresh preserves content and awaits completion only for its refresh indicator.

CACHE_BEFORE: per-page refs only; no cross-reLaunch data reuse. bootstrapInFlight only shared simultaneously pending runtime work.

## Cache design and consistency

| CACHE_KEY | DATA | UPDATED_AT | STALE_AFTER | INVALIDATION / refresh |
| --- | --- | --- | --- | --- |
| current owner / dashboard | existing summary, recent 5 tasks and desktop preview | successful read time | 5 seconds | desktop/settings mutation, task clear; Push expires; Home pull refresh expires |
| current owner / tasks default first page | all content / all desktops / all statuses / limit 20; items + cursor | successful read time | 5 seconds | task clear, desktop mutation; Push expires; pull refresh expires |
| current owner / desktops | current list and display/status fields | successful read time | 5 seconds | pair/rename/unbind clears; explicit refresh expires |
| current owner / settings | notificationsEnabled boolean only | successful read or safe Home seed | 15 seconds | update success seeds exact server result; older reads are rejected |

Other task filters and later pages are read on demand, with existing per-page state retained during refresh. No arbitrary filter-key map grows in memory. Permission, registration readiness and account profile are not stored in the business snapshots. A snapshot read is deduplicated while pending; successful empty arrays and false booleans are valid values. Expired data stays available for rendering. A Push event during an in-flight read leaves its result stale so the next entry revalidates it.

CACHE_OWNER_ISOLATION: PASS in automated tests. Cache access checks the current official local account profile and token expiry. Owner changes clear all four slots; login/register/logout/deletion also clear snapshots. A session generation rejects old-account replies, including a same-owner logout/re-entry. Task filter controls clear before a retained page can show another account's names. No CID, token, password or desktop credential is stored in these snapshots.

CACHE_INVALIDATION: pair/rename/unbind clear desktop/task/Home views; notification update invalidates old settings/Home reads and immediately seeds the returned boolean; clearTaskHistory invalidates task/Home data at the start and after each completed cleanup pass; account deletion/logout clear user snapshots. Privacy acceptance updates runtime consent; privacy rejection clears snapshots and follows the existing consent recovery route. Receiving Push only expires task/Home freshness, with no extra network request.

BACKGROUND_REFRESH: stale content remains visible while page consent/data reads complete. Transient failures show the existing refresh-error banner; an initial failure shows the existing error component. Server authentication/consent rejection clears cache and redirects instead of being treated as ordinary offline staleness. Framework cloud errors are type-checked before accessing their fields, so internally discarded-response errors are not cast to UniCloudError.

DUPLICATE_REQUEST_PREVENTION: one promise per snapshot; one simultaneous consent promise per session; desktop data used for task filters is read from the same returned snapshot; Home seeds Settings; page loading guards suppress repeated refresh actions; Tasks uses request versions for filter/pagination order. Mutation revisions prevent old reads restoring outdated data.

PUSH_INITIALIZATION_ON_TAB_SWITCH: BEFORE every eligible page bootstrap; AFTER none on normal column switches. App foreground and explicit notification CTA/retry retain initialization. Confirmed consent revocation may invoke the existing stop/device-disable recovery path in the background. Server Push behavior is unchanged.

AUTH_BOOTSTRAP_ON_TAB_SWITCH: BEFORE local session check bundled with full privacy/Push bootstrap; AFTER local UID/expiry plus server consent read only. No token verification or ownership check was removed. Pending App bootstrap completion can update Home/Settings fact labels without blocking their content.

## Page results

HOME_PAGE: restores summary and recent rows immediately when available; performs three independent reads together when stale; seeds Settings; preserves current shell and navigation.

TASKS_PAGE: restores default first-page rows and cursor; refreshes onShow, including return from detail; shares desktop names/options; retains empty results during offline refresh; rejects outdated filter, pagination and pre-clear responses. Pagination size and stable keys remain unchanged.

DESKTOPS_PAGE: restores active/revoked data; uses one list read when stale; explicit mutations refresh only dependent resources; revoked-only and empty views remain valid.

SETTINGS_PAGE: restores remote notification boolean plus current local account/runtime facts; background validation does not hide loaded content; successful toggles update the cache immediately. No new notification permission prompt is introduced.

## Files changed

Existing application files, compared directly as text against the pre-edit copies:

- apps/tokenm-android/components/tm-tab-bar/tm-tab-bar.uvue
- apps/tokenm-android/pages/dashboard/index.uvue
- apps/tokenm-android/pages/tasks/index.uvue
- apps/tokenm-android/pages/desktops/index.uvue
- apps/tokenm-android/pages/settings/index.uvue
- apps/tokenm-android/services/client-runtime.uts
- apps/tokenm-android/services/privacy-consent.uts
- apps/tokenm-android/services/tokenm-service.uts
- apps/tokenm-android/services/account-service.uts
- apps/tokenm-android/services/push-runtime.uts
- apps/tokenm-android/services/presentation.uts

Added:

- apps/tokenm-android/services/page-cache.uts
- apps/tokenm-android/services/navigation-perf.uts
- tests/android/performance.test.js
- docs/android/TOKEN_M_ANDROID_PERF_BASELINE.md
- docs/android/TOKEN_M_ANDROID_PERFORMANCE_FORENSIC.md
- docs/android/TOKEN_M_ANDROID_PERFORMANCE_OPTIMIZATION_REPORT.md

HBuilderX also regenerated the ignored apps/tokenm-android/unpackage build/resource output. Task-local baseline copies and validation logs are in tmp/android-perf-baseline-20260909 and tmp/android-perf-*.log. Those files contain no new credential material. No files or directories were deleted.

## Measurement and validation

PERFORMANCE_INSTRUMENTATION: navigation-perf.uts uses Date.now. T0 is the actual custom-column/shortcut call; T1 is onReady; T2 is cached state committed through nextTick and shell readiness; T3 is refreshed content committed through nextTick. Logs contain only page route, metric and milliseconds. They are lifecycle/render-commit proxies, not an assertion of physical display timing. Navigations not issued through that wrapper do not invent a T0. Superseded navigations and repeated stages do not log duplicate timing.

- NAVIGATION_TO_SHELL_MS: UNMEASURED_ON_DEVICE
- NAVIGATION_TO_CACHED_CONTENT_MS: UNMEASURED_ON_DEVICE
- NAVIGATION_TO_FRESH_CONTENT_MS: UNMEASURED_ON_DEVICE
- DEVICE_TIMING: UNMEASURED_ON_DEVICE

STATIC_EXPECTED_IMPROVEMENT: no cloud wait before restored warm content; fewer serialized cold read stages; reduced redundant round trips. The router still recreates pages, and this task makes no measured claim about native recreation/rendering time or actual handset speed.

FUNCTIONAL_TESTS / REGRESSION_TESTS: 143/143 passed using `node --test "tests/android/*.test.js" "tests/electron/android*.test.js" tests/electron/tokenMNotificationTarget.test.js`. This includes 19 new behavioral tests executing the actual UTS algorithms with type syntax removed and controlled cloud/OS adapters. They cover cache state, freshness, coalescing, offline behavior, accounts, expiry/logout, mutations, old replies, consent, filters, manual refresh, Push expiration and timing state. They are not phone or real-cloud measurements. Existing Android/Desktop auth, ownership, pairing, delivery and provider tests also passed. Repository lint and git diff --check passed.

The unrelated whole-repository test entry point was not run: it includes explicitly prohibited fingerprint tests and a legacy quick-check case. The focused Android/Desktop unit/integration/contract suite and repository lint were run directly without changing those unrelated tests.

HBUILDERX_COMPILE: PASS — installed 5.24.2026081301 reports uni-app x 5.24 / VDOM and project compilation success.

APPRESOURCE_GENERATION: PASS — official local `publish app-android --type appResource` exported apps/tokenm-android/unpackage/resources/app-android. Generated Kotlin contains the final cache and task-revision paths and uniform UTSPromise.all<Unit> calls. This validates the HBuilderX source compiler/resource export, not a release APK's cloud Kotlin build or device behavior. Final console evidence: tmp/android-perf-compile-final.log. No Native SDK or standalone Gradle path was used.

## Frozen boundaries and handoff

```text
PHASE1_DATA_PATH: PRESERVED
PHASE2_PUSH_PATH: PRESERVED
PUSH_SERVER_CODE_CHANGED: NO
AUTH_SEMANTICS_CHANGED: NO
DATABASE_SCHEMA_CHANGED: NO
BACKEND_CHANGED: NO
BACKEND_FILES_CHANGED: NONE
ANDROID_SOURCE_CHANGED: YES
CLOUD_BUILD_REQUIRED: YES
CLOUD_BUILD_SUBMITTED: NO
ADB_USED: NO
NATIVE_SDK_USED: NO
HASH_USAGE: NONE
SHA256: NONE
SMOKE: NONE
AGENTS_MD: UNTOUCHED BY THIS TASK (already modified at takeover)
WECHAT/CLOUDBASE: UNTOUCHED
COMMIT: NO
PUSH_GIT: NO
RUNTIME_ACCEPTANCE_REQUIRED: YES
```

AppID __UNI__46C9063, package com.gary.tokenm, VDOM renderer, signing configuration and Alipay space identity were not changed.

## Minimal runtime acceptance

1. In HBuilderX, perform App-Android/iOS Cloud Build using the existing identity/signing configuration.
2. Install the new APK and log in.
3. Repeat 首页 → 任务 → 首页；首页 → 电脑 → 首页；首页 → 设置 → 首页；任务 → 电脑 → 设置 → 任务.
4. Check immediate shell, absence of whole-content waiting on warm entry, correct cached data, and eventual task/desktop/settings refresh. Compare first entry with second entry.
5. Complete one real Codex task; confirm it appears in Android Tasks and the Honor system Push notification still arrives.

No ADB step is required. Runtime performance acceptance remains the user's next step.
