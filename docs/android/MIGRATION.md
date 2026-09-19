# Android migration and cutover

## Current state

Development is parallel, not dual-written:

```text
Legacy:
Codex -> To Know Desktop -> CloudBase -> WeChat Mini Program

New path:
Codex -> To Know Desktop -> uniCloud -> uni-push 2.0 -> Android
```

The Stop Hook, completion normalization, Desktop core runtime, CloudBase functions, WeChat notification accounting, Mini Program, and existing WeChat credentials remain unchanged. Android code uses separate API settings, outbox storage, credential namespace, and destination selection.

## Data policy

- Existing WeChat tasks remain in CloudBase.
- Android does not import legacy task history.
- New Android test tasks belong only to the approved uniCloud space.
- There is no ongoing CloudBase-to-uniCloud replication.
- A user who moves to Android re-pairs each Desktop and begins with a new Android task history.

## Before production cutover

All of the following must be true:

1. `TOKEN_M_ANDROID_P0_E2E_PASS` is established on a release-signed Honor device.
2. Account, privacy, permission, pairing, task persistence, provider status, background notification, and tap-to-task evidence are complete.
3. Production cloud configuration and data operations have explicit user approval.
4. The Android API origin is the intended stable HTTPS endpoint.
5. Desktop Android pairing succeeds with a newly issued `tm_uc_d1` credential.
6. The user understands that WeChat history stays in WeChat/CloudBase.

## Cutover action

The user explicitly selects the Android notification destination in To Know Desktop. The selector permits one destination, so a single completion is not sent to both mobile backends. Existing WeChat credentials may remain stored for a user-directed rollback, but they are not used while Android is selected.

Do not perform this action automatically during deployment, pairing, Android login, or app installation.

## Rollback

If Android production delivery is unacceptable, the user can explicitly select the legacy WeChat destination again. Do not copy Android tasks back to CloudBase, replay prior completion events, or resend uncertain notifications. Diagnose the Android path independently while preserving both histories in their original backends.

## Retirement decision

Removing CloudBase/WeChat code, credentials, documentation, or production resources is a separate future project. It requires explicit scope, data-retention decisions, and user authorization. Android v1 does not authorize that removal.
