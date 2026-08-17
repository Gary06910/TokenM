# Token M MVP API and module contract

Status: **frozen v1** (2026-08-17)

All managed-cloud JSON uses UTF-8, `Content-Type: application/json`, `Cache-Control: no-store`, and ISO-8601 UTC timestamps. Unknown object fields are ignored only where explicitly stated; security-sensitive requests reject wrong types, excessive lengths, and unknown enum values. Error bodies have `{ "error": "machine_code", "message": "safe text" }` and never echo credentials.

## 1. Identifiers and credentials

```text
tenantId       = 22-char base64url (128 random bits)
deviceId       = "dev_" + 22-char base64url
installationId = "mob_" + 22-char base64url
challengeId    = "pair_" + 22-char base64url
eventId        = "evt_" + base64url(SHA-256(canonical event identity))

desktop bearer = tm_d1.<tenantId>.<deviceId>.<43-char base64url secret>
mobile bearer  = tm_m1.<tenantId>.<installationId>.<43-char base64url secret>
pair token     = tm_p1.<tenantId>.<challengeId>.<43-char base64url secret>
```

`Authorization: Bearer <credential>` is mandatory unless an endpoint says otherwise. Tenant routing is based on parsed `tenantId`; authorization is completed inside that tenant's Durable Object.

## 2. Managed HTTP API

### `POST /v1/desktop/enroll`

Headers: `x-token-m-enrollment-secret: <private beta capability>`.

Request:

```json
{ "deviceName": "DESKTOP-XXXX" }
```

Response `201` (returned once):

```json
{
  "tenantId": "...",
  "device": { "deviceId": "dev_...", "name": "DESKTOP-XXXX" },
  "credential": "tm_d1....",
  "createdAt": "..."
}
```

The Worker generates tenant/device ids and the credential. Enrollment secret is never returned or stored in the tenant.

### `GET /v1/desktop/status`

Auth: desktop bearer.

Response `200`:

```json
{
  "ok": true,
  "tenantId": "...",
  "device": { "deviceId": "dev_...", "name": "DESKTOP-XXXX", "lastSeenAt": "..." },
  "mobileInstallations": [
    { "installationId": "mob_...", "name": "iPhone", "pushEnabled": true, "lastSeenAt": "..." }
  ],
  "vapidPublicKey": "<base64url uncompressed public key>"
}
```

### `POST /v1/pairings`

Auth: desktop bearer.

Request:

```json
{ "deviceName": "DESKTOP-XXXX" }
```

Response `201`:

```json
{
  "pairingUrl": "https://example.workers.dev/pair#token=tm_p1....",
  "expiresAt": "..."
}
```

TTL is 10 minutes. Creating a new challenge does not revoke already-bound phones.

### `POST /v1/desktop/test`

Auth: desktop bearer. Empty object request. Sends one privacy-safe test notification to every active mobile installation in the authenticated tenant; it never accepts a tenant id or notification body from the caller.

Response `200`:

```json
{ "ok": true, "eventId": "evt_test_...", "delivered": 1, "expired": 0 }
```

Transient provider failures return retryable `503`. Expired 404/410 subscriptions are removed and counted in `expired` without exposing endpoints or subscription keys.

### `DELETE /v1/desktop/mobile/:installationId`

Auth: desktop bearer. Revokes the named installation only inside the authenticated tenant. The path id must match the frozen `mob_...` shape. The operation is idempotent and returns `200 {"ok":true}` whether that id was already absent, preventing cross-tenant existence probing. It never accepts a tenant id from the caller.

### `POST /v1/pairings/redeem`

No bearer. Request body contains the one-time capability:

```json
{ "token": "tm_p1....", "installationName": "iPhone" }
```

Response `201` (credential returned once):

```json
{
  "tenantId": "...",
  "installation": { "installationId": "mob_...", "name": "iPhone" },
  "desktop": { "deviceId": "dev_...", "name": "DESKTOP-XXXX" },
  "credential": "tm_m1....",
  "vapidPublicKey": "..."
}
```

Expired, used, random, or malformed tokens return `400 {"error":"invalid_pairing"}`. A token is marked used atomically before the mobile credential is returned.

### `POST /v1/events`

Auth: desktop bearer.

Request:

```json
{
  "eventId": "evt_...",
  "type": "codex.turn.completed",
  "deviceId": "dev_...",
  "sessionId": "thr_...",
  "turnId": "turn_...",
  "status": "completed",
  "project": "token-m",
  "summary": "Codex task completed",
  "occurredAt": "2026-08-17T10:00:00.000Z",
  "durationMs": 512000
}
```

Limits: body 16 KiB; ids 128 chars; `project` 80; `summary` 120; `durationMs` optional non-negative safe integer. The only MVP type/status pair is `codex.turn.completed`/`completed`. Authenticated device id must equal body device id.

Response `200`:

```json
{ "ok": true, "eventId": "evt_...", "duplicate": false, "delivered": 2, "expired": 0 }
```

If transient push deliveries remain, return `503` with `error: "push_retry_required"` and counts. The event remains stored and the same `eventId` retry targets pending installations only. An already-complete duplicate returns 200 with `duplicate: true`.

### `GET /v1/mobile/status`

Auth: mobile bearer.

Response `200`:

```json
{
  "ok": true,
  "desktop": { "deviceId": "dev_...", "name": "DESKTOP-XXXX" },
  "installation": { "installationId": "mob_...", "name": "iPhone", "pushEnabled": true },
  "vapidPublicKey": "..."
}
```

### `PUT /v1/mobile/subscription`

Auth: mobile bearer.

Request:

```json
{
  "permission": "granted",
  "subscription": {
    "endpoint": "https://push.example/...",
    "expirationTime": null,
    "keys": { "p256dh": "...", "auth": "..." }
  }
}
```

Endpoint must be HTTPS; key encodings and total size are bounded. Response: `200 {"ok":true,"pushEnabled":true}`.

### `POST /v1/mobile/test`

Auth: mobile bearer. Empty object request. Sends only to the calling installation.

Response `200`:

```json
{ "ok": true, "eventId": "evt_test_..." }
```

Transient push failure returns retryable `503`; 404/410 clears the subscription and returns `410 {"error":"subscription_expired"}`.

### `DELETE /v1/mobile`

Auth: mobile bearer. Atomically removes/revokes the calling installation and its PushSubscription. Response: `200 {"ok":true}`. The PWA then calls browser `PushSubscription.unsubscribe()` and clears local IndexedDB state even if the network request cannot be completed, while showing whether remote revocation was confirmed.

## 3. Legacy HTTP API

All existing `/api/*` routes and `TOKEN_MONITOR_SECRET` semantics remain unchanged and continue to route to `HubDO` named `hub`. `/v1/*` never accepts the legacy secret, and `/api/*` never accepts a managed bearer as a substitute.

## 4. Desktop core module contract

Agent C exposes CommonJS modules usable by Electron main and tests. Exact filenames may follow repository conventions, but exports are frozen:

```js
normalizeCodexCompletion(input, context) -> CompletionEvent
completionEventId({ deviceId, sessionId, turnId, type, status }) -> string

createNotificationOutbox({ filePath, send, now, random, logger }) -> {
  enqueue(event), start(), flush(), stop(), snapshot()
}

createCodexHookBridge({ host: '127.0.0.1', port, token, onCompletion, logger }) -> {
  start(), stop(), address()
}

readCodexHookState({ codexHome, commandIdentity }) -> HookState
enableCodexStopHook({ codexHome, command, commandWindows, backup, fs }) -> HookState
disableCodexStopHook({ codexHome, commandIdentity, fs }) -> HookState

createTokenMCloudClient({ baseUrl, credential, fetch, timeoutMs }) -> {
  status(), createPairing(), sendEvent(event)
}
```

`CompletionEvent` is the `/v1/events` request body. `normalizeCodexCompletion` accepts official Stop-hook snake_case input and App Server `turn/completed` input; it does not read transcript files or include assistant text.

`HookState`:

```json
{
  "enabled": true,
  "needsTrust": true,
  "configPath": "C:\\Users\\...\\.codex\\hooks.json",
  "backupPath": "C:\\Users\\...\\.codex\\hooks.json.token-m-backup-...",
  "error": null
}
```

## 5. Electron IPC contract

Preload exposes a `tokenMNotifications` object; it returns redacted DTOs only:

```js
getStatus()                    // -> NotificationStatus
enroll({ baseUrl, code })      // -> NotificationStatus
enableCodexHook()              // -> HookState
disableCodexHook()             // -> HookState
createPairing()                // -> { pairingUrl, expiresAt }
sendTest()                     // -> { ok, ... }
unpair(installationId)         // -> NotificationStatus
onStatus(callback)             // -> unsubscribe fn
```

`NotificationStatus`:

```json
{
  "configured": true,
  "baseUrl": "https://example.workers.dev",
  "device": { "deviceId": "dev_...", "name": "DESKTOP-XXXX" },
  "hook": { "enabled": true, "needsTrust": false, "error": null },
  "outbox": { "pending": 0, "lastError": null },
  "mobileInstallations": [
    { "installationId": "mob_...", "name": "iPhone", "pushEnabled": true, "lastSeenAt": "..." }
  ]
}
```

Forbidden renderer fields: desktop/mobile bearer, enrollment secret, credential MAC/pepper, bridge token, VAPID private key, PushSubscription keys, raw hook stdin, transcript path, assistant response.

`sendTest()` calls `POST /v1/desktop/test`; `unpair(installationId)` calls `DELETE /v1/desktop/mobile/:installationId`. Desktop code must not call a mobile-auth endpoint with a desktop credential.

## 6. PWA client contract

IndexedDB database `token-m`, store `auth`, schema version 1:

```json
{
  "key": "installation",
  "tenantId": "...",
  "installationId": "mob_...",
  "credential": "tm_m1....",
  "desktop": { "deviceId": "dev_...", "name": "DESKTOP-XXXX" }
}
```

The credential is never placed in URL query parameters, cookies, DOM data attributes, analytics, or logs. The pair fragment is cleared with `history.replaceState` before the first network request.

Service-worker push payload contract:

```json
{
  "eventId": "evt_...",
  "title": "Token M",
  "body": "Codex task completed\nProject: token-m",
  "url": "/?event=evt_...",
  "tag": "evt_..."
}
```

The service worker uses safe defaults when JSON is missing/malformed, calls `showNotification`, and on click focuses an existing same-origin window or opens `url`. It never executes or injects payload content as HTML.

## 7. Retry classifications

```text
2xx                  success; remove outbox item
400/404/413/422      terminal-visible client/schema error; retain suspended
401/403              credential repair required; retain suspended
408/425/429          retry with exponential backoff and jitter
500/502/503/504      retry with exponential backoff and jitter
network/timeout      retry with exponential backoff and jitter
```

Worker push classifications:

```text
201/202              delivered
404/410              remove subscription, terminal for that installation
429/5xx/network      pending; desktop retry required
other 4xx            invalid subscription, terminal and surfaced
```

## 8. Secret and configuration names

Worker secrets:

```text
TOKEN_MONITOR_SECRET          # legacy /api only
TOKEN_M_ENROLLMENT_SECRET     # tenant creation only
TOKEN_M_CREDENTIAL_PEPPER     # managed credential MAC
TOKEN_M_VAPID_PRIVATE_KEY     # URL-safe P-256 private key
TOKEN_M_VAPID_SUBJECT         # mailto: or https: contact
```

Worker public variable:

```text
TOKEN_M_VAPID_PUBLIC_KEY      # URL-safe uncompressed P-256 public key
```

Electron credential-store settings:

```text
tokenMCloudCredential
```

Electron non-secret settings:

```text
tokenMCloudUrl
tokenMCloudDeviceId
tokenMCloudDeviceName
tokenMCodexHookEnabled
```

Internal legacy names and `TOKEN_MONITOR_*` compatibility variables are not mechanically renamed.
