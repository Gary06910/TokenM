# TOKEN_M_PHASE2_PUSH_PLAN

This contract is frozen against the Phase 1 runtime-verified baseline. Pairing,
Desktop credentials, Desktop event validation, task persistence, authenticated
Android task reads, and privacy-mode task redaction are retained.

## CURRENT_CID_FLOW

| Function | File | Input | Output | Failure | Next step |
| --- | --- | --- | --- | --- | --- |
| App bootstrap | `App.uvue`, `main.uts`, `services/client-runtime.uts` | current local uni-id session | authenticated runtime facts | signed-out/expired session leaves Push stopped | login normally |
| Consent gate | `services/client-runtime.uts`, `pages/privacy/index.uvue` | server current privacy version and local user action | `privacyConsent = current` | missing/stale consent leaves Push stopped | accept the current version |
| Permission gate | `pages/notifications/index.uvue`, `services/client-runtime.uts`, `services/push-runtime.uts` | explicit notification CTA | `authorized`, `denied`, or `notDetermined` | denial is recorded and is not treated as delivery | user may restore permission in system settings |
| uni-push initialization | `services/client-runtime.uts`, `services/push-runtime.uts` | signed-in + current consent + explicit activation | one notification channel and one `uni.onPushMessage` listener | runtime remains fail-closed | expose recovery state in settings |
| CID acquisition | `services/mobile-device.uts`, `services/push-runtime.uts` | current installed Android application | runtime `uni.getPushClientId` CID | acquisition failure records business registration `error` | retry only through a later explicit client initialization, never with a fake CID |
| Official CID binding | `services/mobile-device.uts`, official `uni-id-co/module/utils/set-push-cid.js` | runtime CID plus authenticated uni-id context | current owner/device/AppID binding in `uni-id-device` | official call rejects/fails | do not mark business registration ready |
| Business registration | `services/mobile-device.uts`, `tokenm-co/index.obj.js`, `tokenm-core/application.js` | enabled, label, permission, registration state; trusted client info | `(ownerId, deviceId)` upsert in `tokenm-mobile-devices` | invalid ownership/input or stale consent rejects | preserve the prior task data path |

The client cannot submit `ownerId`, `deviceId`, platform, app version, or CID to
the business registration method. Ownership comes from authenticated uni-id
context, client identity comes from trusted cloud context, and the CID remains
in the official identity collection.

## CURRENT_MOBILE_DEVICE_SCHEMA

`tokenm-mobile-devices` retains its existing unique `(ownerId, deviceId)`
constraint and the fields `ownerId`, `deviceId`, `platform`, `deviceLabel`,
`pushRegistrationStatus`, `notificationPermissionState`, `appVersion`,
`status`, `createdAtMs`, `updatedAtMs`, and `lastSeenAtMs`. A registration
refresh updates the same business device record. The collection does not store
the CID.

`uni-id-device` remains the official CID source. The delivery query requires a
matching authenticated `user_id`, trusted `device_id`, Token M AppID, current
`token_expired`, and a non-empty `push_clientid`. No CID value is returned to
Desktop or Android task APIs and no CID value is logged.

## CURRENT_PUSH_MODULE_STATUS

- DCloud AppID: `__UNI__46C9063`.
- Android package: `com.gary.tokenm`.
- uni-push 2.0 base module: present in the existing Android manifest contract.
- Android API: `uni.getPushClientId` and one `uni.onPushMessage` listener.
- Server API: `uniCloud.getPushManager({ appId }).sendMessage(request)` through
  the `uni-cloud-push` cloud-function extension.
- Honor and Xiaomi vendor channels: OFF.
- Production CID and device-display result: runtime gates, not source claims.

## ANDROID_SOURCE_CHANGE_REQUIRED

`NO`. The existing source already contains the permission CTA, current CID
acquisition, official CID binding, authenticated business-device upsert, single
listener, safe click routing, status presentation, and no local-notification
duplication. Phase 2 changes the backend decision and persistence path only.

## FINAL_NOTIFICATION_ELIGIBILITY

One task is eligible only when all facts are current at send-decision time:

1. the persisted task has an authenticated owner;
2. `tokenm-users.notificationsEnabled` is true;
3. the current Token M privacy-consent version is accepted;
4. a business device is active, Android, registration `ready`, and permission
   `authorized`;
5. the same owner/device/AppID has a current, non-empty official CID.

All active eligible devices are selected, deduplicated by CID, and bounded to
500 targets in one provider request. Missing setting/consent is
`skipped_disabled`; missing eligible device/CID is `skipped_no_target`.

## FINAL_PUSH_PAYLOAD

```js
{
  push_clientid: ['<eligible runtime CID>'],
  platform: 'app-android',
  title: 'Token M',
  content: '任务完成', // optional safe suffix: ` · <computer name>`
  payload: { taskId: '<random task id>' },
  force_notification: true
}
```

Only `taskId` is allowed in data. Prompt, reply, cwd, terminal output, source,
conversation, credential, token, task content, and summary are excluded. The
provider notification is the single system-notification path; the Android
listener does not create a second local notification.

## FINAL_DELIVERY_STATE_MACHINE

```text
not_requested
  -> skipped_disabled
  -> skipped_no_target
  -> pending -> submitted
             -> failed
```

`submitted` means only that DCloud accepted the provider request. It is not a
device-display receipt. A provider rejection, exception, or bounded-call
timeout becomes `failed`; there is no automatic retry.

## AT_MOST_ONCE_MECHANISM

The unique `(desktopId, eventId)` constraint prevents duplicate task creation.
After the task is committed, a conditional database update matching task ID
and `notificationStatus: not_requested` atomically claims `pending`. Only the
successful claimant invokes the provider. One request contains every selected
target CID once. Duplicate Desktop events return the stored task/status and do
not enter notification processing.

## FILE_SCOPE

Backend implementation:

- `cloudfunctions/common/tokenm-core/application.js`
- `cloudfunctions/common/tokenm-core/push-notification.js`
- `cloudfunctions/common/tokenm-core/repository-contract.js`
- `cloudfunctions/common/tokenm-core/repository-memory.js`
- `cloudfunctions/common/tokenm-core/repository-unicloud.js`
- `cloudfunctions/common/tokenm-core/index.js`
- `cloudfunctions/tokenm-desktop-http/index.js`
- `cloudfunctions/tokenm-desktop-http/package.json`
- `database/tokenm-tasks.schema.json`

Desktop compatibility:

- `src/electron/androidClient.js`
- relevant Desktop contract tests, so every Phase 2 acknowledgement remains an
  accepted event and is not retained as a false outbox failure.

Android files: none.

## PRODUCTION_DEPLOYMENT_SCOPE

When every pre-send runtime gate is proven, deployment is limited to the
updated `tokenm-tasks` schema and the existing Token M functions/common module
needed by `tokenm-co` and `tokenm-desktop-http`. `uni-id-co`, `uni-captcha`,
Auth secrets, CloudBase, WeChat, vendor SDKs, and Android Cloud Build remain
outside scope.

Before deployment can enable the first automatic real attempt, production must
prove, without exposing the CID value: current owner; active/ready/authorized
business device; current privacy consent; enabled task notifications; and the
same current official device record with a non-empty CID.

## PHASE_2_GATES

| Gate | Pass condition before runtime acceptance |
| --- | --- |
| A — permission | production business-device permission is `authorized` |
| B — real CID | current Token M Android install has a non-empty official CID; value is never printed |
| C — binding | official owner/device/AppID matches the authenticated business-device owner and trusted device ID |
| D — target selection | setting, consent, activity, registration, permission, platform, token expiry, and CID filters pass |
| E — one provider attempt | a newly accepted real Desktop event wins the atomic claim and invokes DCloud once |
| F — state persistence | the task records `submitted` or `failed` without a device-delivery claim |
| G — Android build | `NOT_REQUIRED` while Android source remains unchanged |
| H — runtime acceptance | one normal real Codex completion persists a task and shows one minimal Android system notification |

After the production pre-send facts are proven, deploy the schema before the
updated functions, restart the current Token M Desktop runtime so it accepts
all Phase 2 acknowledgement states, and complete one ordinary short Codex
task. Acceptance requires the task to appear in Android Tasks independently of
Push. The expected notification is `Token M` / `任务完成` with the optional safe
computer-name suffix. No synthetic production task, device tooling, or vendor
offline test is part of this gate. If the provider records `submitted` but the
notification is not displayed, device display remains unproven rather than
being relabelled as delivered.

## FROZEN_EXCLUSIONS

- HONOR_VENDOR: OFF
- XIAOMI_VENDOR: OFF
- REAL_VENDOR_OFFLINE_PUSH: NOT IMPLEMENTED
- HASH_USAGE: NONE
- RETRY_FRAMEWORK: NONE
- DESKTOP_DIRECT_PUSH: NONE
- ANDROID_POLL_TRIGGERED_PUSH: NONE
