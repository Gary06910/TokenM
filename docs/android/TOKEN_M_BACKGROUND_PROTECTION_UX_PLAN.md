# TOKEN_M_BACKGROUND_PROTECTION_UX_PLAN

Frozen before implementation: 2026-09-13. Baseline: TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE. User-reported manual result: foreground/background/locked PASS; recents swipe-away unsupported. These are prior handset results, not new-build acceptance.

## CURRENT_SETTINGS_ARCHITECTURE

Audited dashboard, settings, notifications, permission, privacy, about, all shared components, App lifecycle, manifest/pages, mobile-device, push-runtime, client-runtime, auth storage, page-cache and navigation-perf. Settings restores settingsSnapshot before protected refresh; notification permission currently uses getAppAuthorizeSetting, permission CTA also runs registration. New local page must not import that cloud-capable runtime. App.onShow's existing bootstrap remains unchanged when returning from system Settings; the new page adds no cloud call. Dashboard stays unchanged. Existing account logout removes named session/Push keys, not all installation storage.

## BACKGROUND_PROTECTION_CAPABILITY_MATRIX

CAN_REQUEST means a direct OS permission/exemption request, not opening a settings list. CAN_OPEN_SETTINGS means a documented destination for that exact capability; generic App Details is explicitly separate.

| CAPABILITY | CAN_DETECT | CAN_REQUEST | CAN_OPEN_SETTINGS | Implementation |
|---|---|---|---|---|
| Android notification permission | YES | YES (Android 13+) | YES | Read uni.getAppAuthorizeSetting; this page opens system authorization settings, no registration CTA |
| Battery optimization exemption | YES (API 23+) | YES, conditional eligibility and permission; NOT USED | YES (API 23+) | PowerManager.isIgnoringBatteryOptimizations; standard exemption list |
| Honor autostart | NO | NO | NO (dedicated public route) | Generic public App Details + numbered guide |
| Honor associated launch | NO | NO | NO (dedicated public route) | Same guide |
| Honor background activity | NO | NO | NO (dedicated public route) | Same guide |
| Recents task lock | NO | NO | NO | User opens recents manually |
| Honor background network controls | NO | NO | NO (dedicated public route) | Generic system settings + official guide |

API <23 reports battery not applicable, not exempt. Read failures report unknown. Vendor controls are never SYSTEM_VERIFIED.

## SYSTEM_VERIFIED_STATES / USER_CONFIRMED_STATES

SYSTEM_VERIFIED: notification authorized/denied/unknown; battery exempt/optimized/unsupported/unknown. Re-read on page onShow and explicit refresh. Do not persist OS states.

USER_CONFIRMED: honorLaunchGuideConfirmed (all three switches), recentsLockGuideConfirmed, backgroundNetworkGuideConfirmed. UI says 用户确认 / 已手动确认（未自动检测） and supports undo. Installation-scoped booleans survive logout/login, not synchronized; uninstall/clear app data can clear them. Storage failures show an error without fabricating completion.

## NEW_PAGE_ROUTE / UI_STRUCTURE

/pages/background-protection/index: shared tm-header, light cards, blue user-triggered system-setting buttons, five numbered steps, refresh, explicit verification labels and limitation. Settings gets one independent local entry outside remote loading/error content so the guide remains accessible. Summary: 需检查 for unknown/negative system states; 建议配置 for incomplete manual items; 已完成基本设置 only when notification authorized, battery exempt/not applicable, all manual items confirmed, with explicit mixed-evidence detail. No Home change.

## ANDROID_APIS_USED / MANIFEST_CHANGE_REQUIRED

uni.getAppAuthorizeSetting, uni.openAppAuthorizeSetting, UTSAndroid.getUniActivity, Build.VERSION.SDK_INT, Context.POWER_SERVICE, PowerManager.isIgnoringBatteryOptimizations, Intent, Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, ACTION_APPLICATION_DETAILS_SETTINGS + package URI, ACTION_SETTINGS. Catch unavailable activity/settings handlers, show manual route. No private Honor components.

MANIFEST_CHANGE_REQUIRED: NO. REQUEST_IGNORE_BATTERY_OPTIMIZATIONS not added: direct requests have restricted acceptable uses; standard user-selected settings list fulfills this UX without claiming direct-request eligibility. No SDK/privacy version change.

## LOCAL_STORAGE_FIELDS / NO_CLOUD_CALL_PROOF

tokenm.background-protection.honor-launch-user-confirmed.v1; tokenm.background-protection.recents-lock-user-confirmed.v1; tokenm.background-protection.network-user-confirmed.v1. Only booleans. No owner, CID, account, telemetry or cloud imports. New helper dependency closure is local native API + pure local state. No server eligibility coupling. Existing global resume behavior remains unchanged.

## KNOWN_LIMITATION_COPY

已有荣耀手机实测：完成后台保护后，前台、普通后台和锁屏通知正常。不同机型和系统设置可能影响送达。请不要主动关闭 Token M：从最近任务中划掉后，当前版本不保证实时通知，可能无法及时收到提醒。

Consumer UI omits account eligibility/vendor transport details per product requirement; internal report records basic uni-push and Honor account blocker.

## FILES_TO_CHANGE

New services/background-protection.uts, services/background-protection-state.uts, pages/background-protection/index.uvue; minimal settings/index.uvue + pages.json; focused tests and existing route-count assertion; plan/report. No existing Push/CID/cache/auth/privacy/manifest/server/Desktop/WeChat source changes.

## TEST_PLAN

Execute real UTS state logic in Node test harness: permission/battery values and failures, confirmations persist across reload, undo, malformed values, storage failures, summary distinguishes sources. Execute page onShow with mocked local API and cloud trap. Verify route/entry, no cloud dependencies, no permission requests on mount, OS-return re-read, unchanged logout/cache paths via baseline byte comparisons. Existing Android performance/Phase1/Phase2 tests; repository verify without changing unrelated failures. HBuilderX 5.24.2026081301 official Android source compile/AppResource export; compile native helper via official single-file check if needed. No Cloud Build/ADB/hashes. New APK P3-A3/B3/C3 user acceptance required; D3 known limitation. Any B3/C3 regression => STOP BACKGROUND_PROTECTION_REGRESSION.

Target inventory is read-only, current owner only, with allowed fields and CID_PRESENT boolean; no raw CID. No production record mutations. If authenticated read evidence unavailable => UNPROVEN, not stale/duplicate inference.

## Official sources checked 2026-09-13

- [DCloud UTS Android interop](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-for-android)
- [DCloud system authorization settings](https://doc.dcloud.net.cn/uni-app-x/api/open-app-authorize-setting.html)
- [Android Doze exemptions and acceptable direct request uses](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Android PowerManager](https://developer.android.com/reference/android/os/PowerManager#isIgnoringBatteryOptimizations(java.lang.String))
- [Android public Settings actions](https://developer.android.com/reference/android/provider/Settings#ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
- [Honor launch management, task lock and battery settings](https://www.honor.com/cn/support/content/zh-cn00458250/)
- [Honor notification and sleep network guide](https://www.honor.com/cn/support/content/zh-cn15844368/)
