# TOKEN_M_ANDROID_PERFORMANCE_FORENSIC

Read-only findings frozen before source edits, 2026-09-09. All request counts are STATIC_CALL_GRAPH_ESTIMATE, not production measurements.

## Navigation and render evidence

pages.json defines 13 ordinary pages and no native tabBar. components/tm-tab-bar/tm-tab-bar.uvue::switchTab calls uni.reLaunch. Dashboard shortcuts and Settings → Desktops also call reLaunch. Each switch closes the old page and creates a new instance. There is no authenticated shell store. Headers, filters and bottom navigation are outside the page loading gate; remote awaits block meaningful content, not the existence of that shell.

Official references: [navigation](https://doc.dcloud.net.cn/uni-app-x/api/navigator.html), [page lifecycle](https://doc.dcloud.net.cn/uni-app-x/page.html), [UTS Promise](https://doc.dcloud.net.cn/uni-app-x/uts/buildin-object-api/promise.html). Retaining reLaunch avoids changing the custom navigation, page stack and Push fallback behavior in this patch. HBuilderX release notes in KOTLIN_RELEASE_COMPATIBILITY.md record a previous heterogeneous Promise.all Kotlin failure; any concurrent work must retain concrete types and handled rejection paths.

## Ranked root causes and minimal patch plan

| Cause | File / function | Current behavior / why it delays content | Expected gain | Risk / selected action |
| --- | --- | --- | --- | --- |
| RC1 | components/tm-tab-bar/tm-tab-bar.uvue::switchTab; four page state initializers | reLaunch discards last-known view; state starts loading; ready follows all remote reads | Warm views can reuse previously returned real data without a remote dependency | Low with session isolation and mutation invalidation; add bounded in-memory view data, keep router |
| RC2 | services/client-runtime.uts::ensureProtectedClientRoute / runBootstrapClientRuntime; dashboard/settings::runLoad | Route waits getPrivacyConsent → getPushClientId → setPushCid → registerMobileDevice; bootstrapInFlight only deduplicates overlapping calls | Remove unrelated Push waits from page reads; avoid repeating registration on every switch | Keep App foreground and explicit CTA registration path; route checks local expiry and server consent independently, never fabricate auth |
| RC3 | services/tokenm-service.uts::getDashboard / listTasks; tasks::runLoadFirst | Dashboard serial getDashboard → listTasks → listDesktops; tasks page listDesktops then adapter listTasks → listDesktops again | Share desktop reads, reuse short-lived settings/read data, run independent read stages concurrently | Low; all existing server auth/ownership contracts remain unchanged |
| RC4 | tasks/desktops::refresh and error handlers | Existing empty data is treated as no prior data; failure removes a valid empty/revoked-only view | Stable content and explicit refresh error even for empty lists | Use successful-load state, not nonempty length |

## PAGE_NAVIGATION_CALL_GRAPH

Common T0 user tap → custom handler → reLaunch → local refs initialized → lifecycle starts async loader → local account UID/tokenExpired check → remote consent → local OS permission → optional CID/uni-id/business registration → business reads → mapping → state ready → meaningful UI. No deep watchers, per-item network calls or component mounted bootstrap were found. main.uts only creates the SSR app. App.onLaunch/onShow call bootstrapClientRuntime without awaiting page rendering.

| Required field | Home | Tasks | Desktops | Settings |
| --- | --- | --- | --- | --- |
| PAGE | dashboard/index | tasks/index | desktops/index | settings/index |
| NAVIGATION_METHOD | reLaunch | reLaunch | reLaunch | reLaunch |
| LIFECYCLE_ENTRY | onShow → refresh → runLoad | onLoad → loadFirst → runLoadFirst | onShow → refresh → runLoad | onShow → refresh → runLoad |
| BLOCKING_AWAIT | bootstrapClientRuntime; getDashboard | ensureProtectedClientRoute; listDesktops; listTasks | ensureProtectedClientRoute; listDesktops | bootstrapClientRuntime; getNotificationSettings |
| NETWORK_CALLS | consent; optional setPushCid/register; dashboard/tasks/desktops | consent; optional setPushCid/register; desktops/tasks/desktops | consent; optional setPushCid/register; desktops | consent; optional setPushCid/register; dashboard |
| SERIAL_CALLS | all above, including local CID callback | all above | all above | all above |
| PARALLEL_CALLS | none within loader | none | none | none |
| DUPLICATE_CALLS | shared consent/registration; desktop names | shared consent/registration; desktops twice | shared consent/registration and desktops | shared consent/registration and dashboard settings |
| FIRST_RENDER_BLOCKED_BY_NETWORK | NO shell; YES meaningful body | NO shell/filters; YES list | NO shell; YES list | NO shell; YES body/local profile |
| PREVIOUS_DATA_REUSED | NO after reLaunch; YES same-instance refresh | NO after reLaunch | NO after reLaunch | NO after reLaunch |
| CACHE_PRESENT | only page ref | only page ref | only page ref | only page ref |
| ON_SHOW_ALWAYS_REFRESHES | YES | NO; onLoad always fetches, back from detail does not refresh | YES | YES |
| LIKELY_LATENCY_SOURCE | initialization then 3 serial reads | initialization then 3 reads, 2 duplicated desktop reads | initialization dominates one read | remote initialization gates even local profile |

## NETWORK_REQUEST_INVENTORY — before

Cycle includes loading Home, then Tasks → Desktops → Settings → Tasks; requests settle before each tap, same authenticated/current-consent user, Push previously activated, successful path. Excludes independent App foreground activity and backend internal DB operations.

| REQUEST | TRIGGER | COUNT_PER_NAV_CYCLE | REQUIRED? | DUPLICATE? | OPTIMIZATION |
| --- | --- | ---: | --- | --- | --- |
| getPrivacyConsent | each route bootstrap | 5 | consent gate required | repeated route initialization | separate page consent check, dedup overlapping reads |
| getPushClientId (local callback) | each eligible bootstrap | 5 | registration needs it | irrelevant to column content | App/CTA lifecycle only |
| uni-id-co.setPushCid | each eligible bootstrap | 5 | registration needs it | repeated on tab changes | no page wait / no page initialization |
| registerMobileDevice | each eligible bootstrap | 5 | registration needs it | repeated on tab changes | retain foreground/CTA path |
| getDashboard | Home and Settings | 2 | summary / remote setting | setting read overlap | reuse settings returned by Home |
| listTasks | Home + Tasks twice | 3 | yes; limits 5 / 20 | repeated same first-page filter | short freshness window + cached first |
| listDesktops | Home 1 + Tasks 2 each + Desktops 1 | 6 | display/name lookup | 5 redundant within short cycle | shared typed read cache and in-flight dedup |
| tokenm-co total | above cloud reads + business registration | 21 | — | — | — |
| all cloud round trips | including uni-id-co | 26 (16 without activated Push) | — | — | — |
| bootstrap (business API) | permission page only | 0 | not in this cycle | none | no new aggregation endpoint |

Cold entry may legitimately wait for remote content; shell is already independent. Warm switches currently repeat the same sequence because data refs are recreated. None of these estimates prove actual milliseconds.

## Wider read audit

Task detail: onLoad awaits route guard then getTask → listDesktops, maps one task. No task-detail mutation. Desktop management is inline in Desktops, no separate detail page; rename/unbind await mutation then runLoad(true), redundantly bootstrapping. Pairing: onLoad guard → createPairingCode; existing bounded-to-visible-page countdown and status polling stop on hide/unload, paired/expired status; do not add polling. Pairing success must invalidate desktop-dependent views.

Permission: onShow loads runtime then business bootstrap; explicit consent update reads current version before update; explicit notification CTA and retry own registration. Notifications: onShow runtime then dashboard settings; explicit toggle, permission and registration retry. Keep those lifecycle semantics. Privacy: onShow reads local profile; clear history and delete account are explicit confirmed operations; any new data cache must be cleared/invalidated by those existing mutation paths.

Auth: official uni-id-co owns session persistence; getCurrentAccountProfile checks UID and token expiry locally. Server tokenm-co._before uses official checkToken for every call and server-derived ownership. Preserve both. Session changes and late responses must not expose another owner's data. New cache must never store a token, CID, desktop credential or secret.

Push: listener start is idempotent, permission CTA guarded, getPushClientId → setPushCid → registerMobileDevice order is necessary. Cloud provider/state-machine path remains frozen. Privacy reads currently have no cache; current version checking must remain server-backed before new protected requests.

Rendering: 20 tasks per list page, Home requests 5, stable taskId/desktopId keys, no client sorting or N+1. Presentation formats dates/status repeatedly but there is no evidence it dominates. No virtual list or format micro-optimization is justified. Consent/permission page computed values are small strings; pairing computed is a six-character code. No deep watch or large shared reactive store exists.

Implementation sequence: freeze baseline → implement cached first and page-only guard → behavioral tests → regression review → shared read dedup/concurrency where justified → HBuilderX compile/AppResource → report. No prefetch, router replacement, new dependency, server edit or build submission is planned.
