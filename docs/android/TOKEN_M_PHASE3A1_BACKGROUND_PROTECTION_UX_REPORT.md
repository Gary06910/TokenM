# TOKEN_M_PHASE3A1_BACKGROUND_PROTECTION_UX_REPORT

Date: 2026-09-13

STATUS: TOKEN_M_PHASE3A1_BACKGROUND_PROTECTION_READY_FOR_CLOUD_BUILD

BASELINE: TOKEN_M_ANDROID_PHASE2_PERFORMANCE_OPTIMIZED_BASELINE

PHASE3_MANUAL_RESULT (user supplied, prior APK):
- foreground PASS
- background PASS
- locked PASS
- recents swipe-away FAIL — accepted known limitation, not this feature's failure gate

Manual freeze: TOKEN_M_PHASE3_MANUAL_BACKGROUND_PROTECTION_PASS.

HONOR_VENDOR_PUSH: BLOCKED_BY_ACCOUNT_TYPE / BLOCKED_BY_EXTERNAL_ACCOUNT_ELIGIBILITY. No SDK, vendor configuration or alternative provider work performed.

FOREGROUND_SERVICE: NOT_IMPLEMENTED

BACKGROUND_POLLING: NOT_IMPLEMENTED

## CAPABILITY_MATRIX

Direct request capability and implemented action are distinguished. Dedicated vendor settings destinations are not inferred from generic App Details access.

| CAPABILITY | CAN_DETECT | CAN_REQUEST | CAN_OPEN_SETTINGS | Used in this feature |
|---|---|---|---|---|
| Android notification permission | YES | YES on Android 13+ | YES | Local read + user opens authorization settings |
| Battery optimization exemption | YES API 23+ | YES conditionally; not implemented | YES API 23+ | Standard optimization list; user chooses exemption |
| Honor autostart | NO | NO | NO dedicated public route | Generic App Details + instructions |
| Honor associated launch | NO | NO | NO dedicated public route | Same numbered instructions |
| Honor background activity | NO | NO | NO dedicated public route | Same numbered instructions |
| Recents task lock | NO | NO | NO | Manual recents instructions |
| Honor background network settings | NO | NO | NO dedicated public route | Generic system settings + instructions |

Notification uses uni.getAppAuthorizeSetting / uni.openAppAuthorizeSetting. Battery uses UTSAndroid.getUniActivity, Android PowerManager.isIgnoringBatteryOptimizations with SDK >=23 guard, and Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS. App Details uses ACTION_APPLICATION_DETAILS_SETTINGS + current package URI; general settings uses ACTION_SETTINGS. No private Honor component names.

Standard battery-list navigation needs no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission. Direct exemption requests have eligibility restrictions and are unnecessary for this implementation. This feature does not claim direct-request eligibility. References: [Android Doze guidance](https://developer.android.com/training/monitoring-device-state/doze-standby), [PowerManager API](https://developer.android.com/reference/android/os/PowerManager#isIgnoringBatteryOptimizations(java.lang.String)), [Settings actions](https://developer.android.com/reference/android/provider/Settings#ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), [DCloud Android interop](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-for-android), [DCloud authorization settings](https://doc.dcloud.net.cn/uni-app-x/api/open-app-authorize-setting.html).

## BACKGROUND_PROTECTION_PAGE / SETTINGS_ENTRY

BACKGROUND_PROTECTION_PAGE: IMPLEMENTED, /pages/background-protection/index. Five light-theme cards: system notification, battery optimization, Honor launch management, recents protection, background network. Existing tm-header/status-marker/notice-banner and blue buttons reused. No Home redesign or additional Home card.

SETTINGS_ENTRY: IMPLEMENTED. One local entry above the remote content/loading/error block, so remote loading does not hide the guide. Existing Settings snapshots and refresh logic remain intact. Entry reads OS + local flags onShow, without additional cloud calls.

SYSTEM_VERIFIED:
- Notification: authorized / denied / unknown. Display 系统检测：已开启 / 未开启; unknown never passes.
- Battery: exempt / optimized / unknown / unsupported. API <23 displays 当前 Android 版本无此标准优化项, not a claimed exemption.
- Local OS reads repeat on page onShow and explicit recheck; opening a system screen never marks completion.

USER_CONFIRMED: Honor launch controls, recents lock, background network. Each says 已手动确认（未自动检测） or 请确认（无法自动检测）. Each supports undo. No server eligibility gate uses these values.

Summary: negative or unknown system states => 需检查; positive/applicable system states with incomplete manual items => 建议配置; positive system states and all manual confirmations => 已完成基本设置. The page and entry explicitly identify the mixed sources. Read failure => 需检查; write failure displays an error without claiming successful confirmation.

NOTIFICATION_PERMISSION: existing Push permission/CID path unchanged. New page offers system settings directly, not the cloud-capable runtime CTA. Banner/lockscreen display options remain user checks, not inferred from app-level authorization.

BATTERY_OPTIMIZATION: implemented standard read + user-selected system list. No launch-time request, direct permission dialog, loop or automatic redirect. UI explains this check is separate from vendor background activity and may increase battery consumption.

HONOR_AUTOSTART_GUIDE: system Settings search 应用启动管理 → Token M → disable 自动管理 → enable 允许自启动 / 允许关联启动 / 允许后台活动. Confirmation covers all three explicitly.

HONOR_BACKGROUND_ACTIVITY_GUIDE: included in step 3; no automatic read claim.

RECENTS_LOCK_GUIDE: open recents; where supported, slide the app card downward and look for a lock; return to confirm. No attempt to programmatically open or manipulate recents.

BACKGROUND_NETWORK_GUIDE: sleep network setting, allow application network, exemption from smart data saver if enabled. System-version differences stated. Sources: [Honor launch, recents and battery guide](https://www.honor.com/cn/support/content/zh-cn00458250/), [Honor notification/sleep network guide](https://www.honor.com/cn/support/content/zh-cn15844368/).

KNOWN_LIMITATION: visible at bottom and in recents step: “请不要主动关闭 Token M：从最近任务中划掉后，当前版本不保证实时通知，可能无法及时收到提醒。” Prior Honor success is identified as existing handset testing, not universal reliability. Consumer copy omits corporate accounts, vendor approval and uni-push internals as required; this report records the basic uni-push channel internally.

## LOCAL_STORAGE_FIELDS

All installation-scoped boolean UX flags, local only:

| Key | Typed field |
|---|---|
| tokenm.background-protection.honor-launch-user-confirmed.v1 | honorLaunchGuideConfirmed |
| tokenm.background-protection.recents-lock-user-confirmed.v1 | recentsLockGuideConfirmed |
| tokenm.background-protection.network-user-confirmed.v1 | backgroundNetworkGuideConfirmed |

OS states are not persisted. Existing logout clears named session/Push keys and owner-scoped memory cache; it does not clear these flags. Re-login therefore preserves installation preferences while OS state is re-read. Uninstall/clear app storage can remove confirmations. No sensitive collection or SDK added.

## Frozen boundaries

```text
CLOUD_CALLS_ADDED: NONE
PUSH_SERVER_CHANGED: NO
TOKENM_CORE_CHANGED: NO
TOKENM_DESKTOP_HTTP_CHANGED: NO
TOKENM_CO_CHANGED: NO
CID_FLOW_CHANGED: NO
PERFORMANCE_CACHE_CHANGED: NO
PRIVACY_VERSION_CHANGED: NO
PRIVACY_VERSION_CHANGE_REQUIRED: NO
PRODUCTION_DEVICE_DATA_CHANGED: NO
MANIFEST_CHANGED: NO (both manifest.json and AndroidManifest.xml)
```

The new page and helper dependency closure contain no cloud/client-runtime/Push imports. Its onShow executes only local reads. Existing App.onShow bootstrap may still perform its pre-existing work on returning from system settings; it was not removed or expanded. “No added cloud calls” is not a claim that the whole App has no existing resume network behavior.

Direct byte equality against 582 pre-edit files confirms only two existing Android source files changed: Settings page and pages.json. Existing tests/android/clientStructure.test.js adjusts the route count from 13 to 14. All other baseline files, including server, CID, App lifecycle, cache, privacy, desktop and AGENTS.md, are byte-identical to the start of this turn. Pre-existing Git modifications remain untouched. Evidence: tmp/phase3a1/baseline-paths.json and boundary-check.json. No content fingerprints used for this comparison.

## TARGET_COUNT_AUDIT

TARGET_COUNT_AUDIT: READ_ONLY_SOURCE_AUDIT_COMPLETE; LIVE_TARGET_INVENTORY_NOT_VERIFIED.

SECOND_TARGET_STATUS: UNPROVEN.

Read resolveNotificationTargets and both collection schemas. The resolver joins owner-scoped active/ready/authorized Android business devices to matching uni-id-device records, checks session expiry, and deduplicates equal provider targets. This explains the selection mechanism; it cannot establish which current physical installations produced the supplied targetCount=2.

HBuilderX CLI help exposes schema management and function execution, not an authenticated row projection for this current owner. No current-owner production record result was available through the inspected route. No function was deployed or run to manufacture an inventory; no credentials or CID were displayed. This independent audit remains incomplete and does not block the local UX build.

| Allowed inventory field | Current evidence |
|---|---|
| record id | UNAVAILABLE |
| device id | UNAVAILABLE |
| active | UNPROVEN |
| current | UNPROVEN |
| created time | UNAVAILABLE |
| updated time | UNAVAILABLE |
| last seen | UNAVAILABLE |
| CID_PRESENT | UNPROVEN |

These are availability markers, not invented device rows. tokenm-mobile-devices does not itself store a CID. A later authenticated inventory must project only allowed fields and CID_PRESENT, join by current owner/device, and avoid inferring “current” from recency alone. No stale-device cleanup recommendation is asserted without records; no delete/revoke/active change performed.

## ANDROID_FILES_CHANGED

- apps/tokenm-android/pages/settings/index.uvue (minimal entry and local summary)
- apps/tokenm-android/pages.json (one route)
- apps/tokenm-android/pages/background-protection/index.uvue (new)
- apps/tokenm-android/services/background-protection.uts (new local Android helper)
- apps/tokenm-android/services/background-protection-state.uts (new local confirmation logic)

Other deliverables: tests/android/backgroundProtection.test.js, route-count assertion in tests/android/clientStructure.test.js, pre-implementation plan and this report. HBuilderX regenerated its own ignored unpackage outputs; no generated Kotlin was manually edited.

## TESTS / Build evidence

TESTS: PASS.

- Focused new UX + existing structure/performance: 35 PASS, 0 FAIL. Tests execute actual UTS logic after type stripping, with mocked local OS/storage. Includes OS failure/unsupported paths, denied notification, revoked exemption, persistence across module reload, undo, malformed storage, storage failures, explicit-click-only navigation, page resume reads, and cloud-access trap. These are behavior tests, not handset proof.
- npm run verify: lint PASS; 3521 tests, 3516 PASS, 0 FAIL, 5 SKIP. Log: tmp/phase3a1/verify.log. Includes existing Android Phase 1/Phase 2/performance tests.
- git diff --check: PASS. Baseline byte comparison: PASS; allowed changes only.
- Source/generated Kotlin inspection: new page route, concrete state types, SDK guard and standard Android actions present; no new Promise chain or generic abstraction.

HBUILDERX_COMPILE: PASS — HBuilderX 5.24.2026081301, uni-app x VDOM; official publish app-android --type appResource reported application compile success at 12:23:03.402.

APPRESOURCE_GENERATION: PASS — export success at 12:23:03.507; apps/tokenm-android/unpackage/resources/app-android.

Additional native-helper compile: PASS — official compile app-android --file services/background-protection.uts reported success at 12:23:44.953. No UTS-to-Kotlin errors reported. This is separate from the pending complete Cloud release APK build.

Initial CLI startup could not connect; normal desktop launch resolved it. No automatic approval rejection occurred. No app data reset or file deletion was used.

Visual/device limitation: source and generated VDOM inspected; new APK visual layout, system destinations, physical OS state and notification acceptance remain UNMEASURED_ON_DEVICE. No simulated screenshot is represented as handset proof.

```text
CLOUD_BUILD_REQUIRED: YES
CLOUD_BUILD_SUBMITTED: NO
ADB_USED: NO
NATIVE_SDK_USED: NO
HASH_USAGE: NONE
SHA256: NONE
WECHAT_CLOUDBASE: UNTOUCHED
AGENTS_MD: UNTOUCHED (pre-existing changes preserved)
COMMIT: NO
PUSH_GIT: NO
RUNTIME_ACCEPTANCE_REQUIRED: YES
```

## NEXT_USER_ACTION

1. HBuilderX → App-Android/iOS-云打包 using existing app identity and signing configuration.
2. Install new APK. Open 设置 → 后台通知保护.
3. Check notification status and battery optimization against system Settings; confirm the Honor instructions, test save/undo/reopen, and verify local state after logout/login.
4. Complete/confirm launch management, recents protection and network settings.
5. For each scenario, create a new real Codex task: P3-A3 foreground, P3-B3 ordinary background, P3-C3 locked. Each requires system notification YES; submitted/providerCode 0 alone is not handset PASS.
6. Record P3-D3 recents swipe-away separately; NO is an accepted known limitation.
7. If B3 or C3 changes from the prior PASS to FAIL: STOP, report BACKGROUND_PROTECTION_REGRESSION, and do not expand the feature.

## FINAL_CONCLUSION

The manual background-protection process is now an in-app five-step guide. Notification authorization and standard battery exemption are system-read states; Honor launch/network/recents controls remain clearly labeled user confirmations. No keepalive complexity, new cloud requests, SDK or manifest permissions were added. Source boundaries and regression tests preserve Phase 1, Phase 2 and performance implementation. The user can now Cloud Build for new-APK acceptance. Existing manual handset success is preserved as prior evidence; new-build runtime acceptance and the independent live second-target inventory remain outstanding.
