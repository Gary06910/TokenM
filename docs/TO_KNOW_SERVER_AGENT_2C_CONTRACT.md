# Server Agent 2C usage contract

Phase 2C-A implements local code and contract tests only. Production schema,
indexes and functions are not deployed by this change. Real A800 uploads and
Windows owner reads require Phase 2C-B acceptance.

## Authenticated HTTP

Both routes use the existing desktop Bearer credential. No server credential
type is introduced. The authenticated desktop supplies ownerId and desktopId.

- `PUT /v1/desktop/usage`: exact body `{ "snapshot": <schema-1> }`.
  Response: `{ "status": "stored", "profileId": "codex", "receivedAt": "<UTC ISO>", "requestId": "req_..." }`.
- `GET /v1/desktop/usage?limit=4&cursor=<opaque>`: no body or content type required.
  Response: `{ "items": [...], "nextCursor": null, "requestId": "req_..." }`.
  Each item has `source: { desktopId, name }`, `profile: { id, name }`,
  `receivedAt` and `snapshot`. Source names come from current desktop records.

Snapshots are at most 12288 UTF-8 JSON bytes; transport remains 16384 bytes.
GET default/maximum page size is four, below the client's 65536-byte response
budget. Unknown query/body keys are rejected. Snapshot validation failures and
malformed cursors return safe `422 invalid_request` responses without payloads.
The cloud validator is a standalone copy of `src/shared/usageSnapshot.js`;
byte parity and positive/negative behavioral tests prevent drift. Changes must
update both files. The producer wrapper and receiving client use that same
portable structural contract. Snapshot schema remains 1 and excludes limits.

## Storage and pagination

`tokenm-usage-snapshots` is cloud-function-only. The unique index is
`desktopId + profileId`; records use random `usg_` UUIDs. Upsert recovers an
insert uniqueness conflict by finding and updating the winning row. Updating
uses uniCloud `command.set` for the entire snapshot so old model keys cannot
survive nested object merge. `createdAtMs` remains stable. `updatedAtMs` and
`receivedAtMs` come from backend time, never the worker clock.

Read criteria always include the authenticated owner's ID. Pagination uses
`updatedAtMs DESC, _id DESC` and a strict base64url tuple cursor. No identity or
credential is encoded in it. Source revocation/removal is checked on read.
Legacy invalid/inactive rows can produce an empty page with a non-null cursor;
clients must continue until null. A traversal is not an immutable database
snapshot: concurrent uploads may move a row before an already-read cursor.
The next refresh retrieves current data; the composition helper selects one
latest observation per exact source/profile identity.

Unbind, self-unpair and account deletion clean usage rows. Upload rechecks source
activity after storage to remove a write racing with revocation. Account cleanup
retains the existing bounded cleanupPending lifecycle.

Database adapter design follows the existing repository and the documented
[uniCloud database commands](https://doc.dcloud.net.cn/uniCloud/cf-database.html).
Tests use MemoryRepository and a command-recording adapter. Production query,
index and concurrency behavior still require deployment acceptance.

## Supervisor lifecycle

`run` starts an independent usage runtime before profile workers; `once` never
starts it. Workers only collect and project local usage. The supervisor checks
worker identity and schema before accepting each snapshot. Missing endpoint or
credential leaves usage sync unconfigured without interrupting workers.

Each profile has at most one in-flight upload and one latest pending snapshot.
The first upload is immediate. Subsequent request starts are at least 60000 ms
apart, including retries. Backoff starts at 5000 ms, doubles to at most 300000 ms,
and respects the 60000-ms floor. Network errors, 408, 425, 429 and 5xx retry the
latest snapshot; other 4xx discard that attempt. 401/403 pause usage sync until
runtime restart with valid configuration. They do not delete credentials or
stop the notification subsystem. Stop cancels timers and waits at most the
supervisor's shutdown grace for active requests. There is no durable usage FIFO.

## Future desktop composition

`listAllRemoteUsageSnapshots` limits traversal to 64 pages and fails on repeated
cursors. `excludeSelf` removes the current desktop's source before composition.
Usage sums raw counters and model/client maps. Cache rate is the ratio of sums:
`cacheReadTokens / (totalTokens - outputTokens)`, or null for unavailable
components/zero denominator. Incomplete capabilities remain incomplete.

Only exact source/profile identity selects a latest observation. No path, token,
model or session fingerprint dedupe is attempted across physical sources.
Copied CODEX_HOME data cannot be reliably deduplicated within this privacy boundary.

`dedupeAccountLimits` is a future pure helper, outside the wire snapshot. Input
observations require `trusted: true`, `valid: true`, provider, window, observedAt,
and numeric remaining/used/percentage/quota values. For a known accountKey the
newest valid observation wins per provider/accountKey/window. Missing keys remain
separate. Equal timestamps retain the first observation. Quotas and percentages
are never added or averaged. No Desktop UI or Android client source is changed.

## Local Windows validation (2026-09-22)

- `npm ci`: real node_modules directory; package-lock unchanged.
- `npm run lint`: pass.
- `npm test` and final `npm run verify`: 4837 total, 4829 pass, 0 fail, 8 skip.
- New backend/runtime/composition contract files: 70 total, 70 pass.
- `npm run dist:win:dir`: preflight, builder and packaged runtime verifier pass;
  42 production packages verified, fs-extra present, no builder dependency warnings.
- Server package source-copy rules include the new modules and exclude Electron
  source. No Linux artifact was built on Windows.
- Existing 2B To Know was running; no process was killed and no competing GUI
  instance was launched. Packaged runtime verification is not GUI acceptance.
- Bundled Linux Node stays 22.23.2. Local test host was Node 24.15.0. Product and
  Server versions stay 1.0.0; Tokscale stays 4.17.0.
- A pre-existing outbox test sampled its event clock twice at an exact expiry
  boundary. It now reuses one event; notification production code is unchanged.
- Tokscale direct download failed. The existing 2B packaged binary was accepted
  only after matching the pinned SHA-256, then installed in the real 2C dependency
  directory through ensureVendoredTokscale. No node_modules junction was used.
- TRANSIENT_PUSH_INCIDENT: UNRESOLVED_NON_BLOCKING. No root cause is inferred.
- No tokenm-prod/database/function deployment, A800 action, Android client/UI
  change, systemd/linger, main/release merge, tag or GitHub Release was performed.
