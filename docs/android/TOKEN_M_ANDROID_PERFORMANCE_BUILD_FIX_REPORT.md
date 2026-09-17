# TOKEN_M_ANDROID_PERFORMANCE_BUILD_FIX_REPORT

STATUS: TOKEN_M_ANDROID_PERFORMANCE_BUILD_FIX_READY_FOR_CLOUD_BUILD

BASELINE: TOKEN_M_PHASE2_BASE_UNIPUSH_RUNTIME_PASS

BUILD_FAILURE_TYPE: UTS_TO_KOTLIN_TYPE_ERROR

ROOT_CAUSE_STATUS: CONFIRMED

## UTS_KOTLIN_ERROR_MAPPING

The user-provided release errors match the pre-fix locally generated Kotlin exactly. Generated files were inspected only; all changes were made in UTS source.

| Error | Original generated location | Source file / function / expression | Confirmed cause |
| --- | --- | --- | --- |
| ERROR_1: expected UTSPromise<T>, actual UTSPromise<Unit> | index.kt:1083 | services/page-cache.uts, PageSnapshot<T>.read, `return Promise.reject(new Error('page_session_unavailable'))` | The rejection-only static call lowers to `UTSPromise.reject(...)`, whose result is Unit in the reported Android Kotlin overload. It cannot satisfy the enclosing `UTSPromise<T>` return type. |
| ERROR_2: Any? where Throwable expected | index.kt:1110 | same method, `.catch((error): T => { ...; throw error })` | A Promise rejection reason is Any?, which is not necessarily a Kotlin Throwable. Direct rethrow is invalid. |

ROOT_CAUSE_1: rejection-only branch lacks an explicit Promise<T> construction. This is **not** a missing success-handler return: the existing success callback explicitly declared T and returned value, visible in generated index.kt:1094–1104.

ROOT_CAUSE_2: the catch callback directly rethrows an unconstrained rejection reason.

The cache was added during the performance pass and is absent from the pre-performance source inventory. The wider performance change list and original working-tree state were reviewed before editing. AGENTS.md and unrelated tracked modifications already existed; this fix does not alter them.

## Minimal fix

PAGE_SNAPSHOT_IMPLEMENTATION: existing generic PageSnapshot<T>, four bounded memory snapshots, unchanged TTLs and service/page integration.

SELECTED_FIX: OPTION A — two targeted type repairs in PageSnapshot.read.

1. The no-session branch now returns `new Promise<T>((_resolve, reject) => { reject(new Error('page_session_unavailable')) })`.
2. The rejection callback explicitly accepts `any | null`. After existing access-error handling, an actual Error is rethrown through an explicit Error cast. Other rejection values become `new Error('page_read_failed')`.

WHY_THIS_FIX: preserves the successful chain, original Error/UniCloudError identity and error codes, request deduplication, session/revision checks, timestamps and invalidation. It avoids a broader Promise wrapper rewrite or splitting the generic cache into resource-specific classes.

PROMISE_RETURN_TYPE_AFTER: generated no-session branch explicitly returns `UTSPromise<T>(...)`; the success callback still returns T.

ERROR_HANDLING_AFTER: generated rejection callback accepts `Any?`, checks `error is UTSError`, and throws `error as UTSError` or a new UTSError. Unknown strings/objects/null are never directly thrown. Actual cloud errors retain their subclass and fields.

GENERIC_PAGE_SNAPSHOT: PRESERVED

PERFORMANCE_OPTIMIZATION_PRESERVED: YES

IF_PARTIAL: NOT_APPLICABLE

## Validation

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| OWNER_CACHE_ISOLATION | PASS | Existing owner change, expiry and late response behavioral tests |
| LOGOUT_CACHE_CLEAR | PASS | Existing logout cache test |
| STALE_WHILE_REVALIDATE | PASS | Cached-first, stale refresh and network-failure tests |
| DUPLICATE_REQUEST_DEDUP | PASS | Shared in-flight and navigation-cycle tests |
| Error normalization | PASS | New test covers original Error identity and null/string/object rejection reasons |
| TESTS | 144/144 PASS | Android and Android/Desktop unit/integration/contract suites; 20 performance behavior tests included |
| Repository lint | PASS | npm run lint |
| Whitespace check | PASS | git diff --check |
| HBUILDERX_ANDROID_COMPILE_VALIDATION | PASS, scoped below | Official 5.24 Android app compiler and isolated cache Kotlin compilation |
| APPRESOURCE_GENERATION | PASS | Official publish app-android --type appResource |
| GENERATED_KOTLIN_TYPE_ERRORS | RESOLVED for the two reported sites | Regenerated expressions inspected and isolated cache implementation compiled by official Android single-file compiler |

Commands executed:

```text
node --test "tests/android/*.test.js" "tests/electron/android*.test.js" tests/electron/tokenMNotificationTarget.test.js
npm run lint
git diff --check
HBuilderX cli publish app-android --type appResource --project <tokenm-android>
HBuilderX cli compile app-android --project <tokenm-android> --file <isolated cache validation file>
```

Full application resource compilation/export succeeded at 19:21:22 on 2026-09-09, reporting compiler 5.24 / uni-app x / VDOM. Output: apps/tokenm-android/unpackage/resources/app-android.

### Kotlin validation boundary

The direct official single-file compilation of services/page-cache.uts could not compile its unchanged auth-service.uts dependency: that entry point lacked the application-generated CloudObjUniIdCo at auth-service.uts:7. Auth was not modified to accommodate the single-file entry point.

For a genuine local Kotlin check of the repaired code, a temporary validation file preserved the entire cache implementation and copied the real model type declarations unchanged (apart from removing export keywords). Only the imported account-profile function was replaced with a typed, non-network stub. This file is outside the application source and is never imported by the App. The first fixture attempt used a relative model import; HBuilderX relocates single-file inputs, so the real model declarations were then included directly. The corrected fixture passed official `compile app-android` at 19:23:52. No standalone Gradle project, Native SDK host or generated Kotlin edits were used.

This verifies the cache implementation through the available official Kotlin compiler path. It is not a claim that the full cloud `:app:compileReleaseKotlin` task has run locally. Final whole-APK validation remains the user's Cloud Build. The previous performance report's resource-compile PASS was insufficient to establish release Kotlin correctness; this report makes that distinction explicit.

Logs and fixture:

- tmp/android-perf-build-fix-compile.log — full application resource compilation/export
- tmp/android-perf-build-fix-single-file.log — direct entry-point dependency limitation
- tmp/android-perf-build-fix-isolated-kotlin.log — isolated cache Kotlin compilation success
- tmp/android-perf-build-fix/page-snapshot-compile.uts — temporary validation source
- tmp/android-perf-build-fix-tests.log — 144 passing tests
- tmp/android-perf-build-fix-lint.log — lint result

## Files changed this round

- apps/tokenm-android/services/page-cache.uts — only production source change
- tests/android/performance.test.js — explicit Error constructor in the test environment and rejection normalization regression test
- docs/android/TOKEN_M_ANDROID_PERFORMANCE_BUILD_FIX_REPORT.md — this report

HBuilderX regenerated its own outputs through official commands. No generated file was manually edited. No other performance, page, Auth, pairing, CID, Push client, Desktop or backend implementation was changed.

```text
BACKEND_CHANGED: NO
BACKEND_DEPLOYED: NO
PHASE1_SEMANTICS_CHANGED: NO
PHASE2_PUSH_CHANGED: NO
ANDROID_SOURCE_CHANGED: YES
CLOUD_BUILD_REQUIRED: YES
CLOUD_BUILD_SUBMITTED: NO
NATIVE_SDK_USED: NO
ADB_USED: NO
HASH_USAGE: NONE
SHA256: NONE
SMOKE: NONE
AGENTS_MD: UNTOUCHED
COMMIT: NO
PUSH_GIT: NO
```

FINAL_CONCLUSION: Both reported Kotlin errors were mapped to their actual UTS expressions and minimally repaired. Generic caching and navigation performance behavior remain intact. Relevant tests, application resource compilation/export and isolated cache Kotlin compilation passed. The user can now retry HBuilderX → App-Android/iOS Cloud Build. No Cloud Build was submitted automatically.
