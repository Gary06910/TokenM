# Token M MVP deployment

This runbook deploys the existing desktop app, the backwards-compatible Hub API, the managed notification API, and the PWA to one free `workers.dev` origin. It does not deploy automatically and does not require a paid domain, native mobile app, Apple Developer membership, Google Play account, or push SaaS.

## 1. Prerequisites

- Node.js 22 or newer.
- A Cloudflare Free account with a `workers.dev` subdomain.
- The local repository and a clean `npm run verify` result.
- One Android browser with Web Push support or an iPhone/iPad on iOS/iPadOS 16.4 or newer for real-device verification.

Run dependency installation from the repository and Worker directories:

```powershell
npm install
Push-Location worker
npm install
Pop-Location
```

## 2. Generate deployment-only values

Generate independent random values for the legacy Hub secret, private-beta enrollment capability, and credential HMAC pepper. Do not reuse any value.

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Generate one P-256 VAPID key pair with a reputable Web Push key tool. The public key is the 65-byte uncompressed P-256 public key encoded as unpadded base64url (87 characters); the private key is the 32-byte scalar encoded as unpadded base64url (43 characters). Keep the private key only long enough to enter it into the Cloudflare secret prompt. Never put it in source, `.dev.vars`, renderer settings, a QR code, screenshots, or logs.

Set the public half in `worker/wrangler.toml`:

```toml
[vars]
STALE_AFTER_MS = "600000"
TOKEN_M_VAPID_PUBLIC_KEY = "<87-character-public-key>"
```

## 3. Configure Cloudflare secrets

Log in and enter each secret interactively. The values are not command-line arguments and therefore do not enter shell history.

```powershell
Push-Location worker
npx wrangler login
npx wrangler secret put TOKEN_MONITOR_SECRET
npx wrangler secret put TOKEN_M_ENROLLMENT_SECRET
npx wrangler secret put TOKEN_M_CREDENTIAL_PEPPER
npx wrangler secret put TOKEN_M_VAPID_PRIVATE_KEY
npx wrangler secret put TOKEN_M_VAPID_SUBJECT
Pop-Location
```

Use a `mailto:` or HTTPS operator contact for `TOKEN_M_VAPID_SUBJECT`. Keep the enrollment capability limited to the private beta; it can create a new isolated tenant but cannot read an existing tenant.

## 4. Validate and deploy the Worker/PWA

```powershell
Push-Location worker
npx wrangler deploy --dry-run
npx wrangler deploy
Pop-Location
```

Wrangler prints the HTTPS `workers.dev` origin. Confirm the legacy health route and PWA manifest without sending credentials:

```powershell
Invoke-RestMethod 'https://<worker>.<account>.workers.dev/api/health'
Invoke-WebRequest 'https://<worker>.<account>.workers.dev/manifest.webmanifest'
```

The deployment contains two separate Durable Object namespaces: legacy `/api/*` uses `HubDO`, while managed `/v1/*` routes each bearer-derived tenant to its own `TenantDO`. Never use `TOKEN_MONITOR_SECRET` as a managed desktop or mobile credential.

## 5. Build or run Token M Desktop

For a source checkout:

```powershell
npm start
```

For an unsigned local Windows package used only for private testing:

```powershell
npm run dist:win
```

The visible product name is Token M, while the existing app id, updater coordinates, artifact names, internal `TOKEN_MONITOR_*` compatibility fields, and legacy user-data directory remain unchanged for MVP migration safety.

In **Settings → Mobile notifications**:

1. Enter the deployed HTTPS Worker origin and the private-beta enrollment capability.
2. Enroll this desktop. The enrollment capability is used for that request only; the returned device credential is stored by the Electron main process and is never exposed to the renderer.
3. Explicitly enable the Codex Stop hook. Token M backs up and merges `~/.codex/hooks.json`; it does not replace existing hooks.
4. In Codex, open `/hooks`, review the Token M command, and trust it.
5. Select **Pair phone** and scan the QR code before its ten-minute expiry.

The QR contains only a one-time pairing capability in the URL fragment. It does not contain the desktop credential, a mobile credential, or VAPID private material.

## 6. Complete mobile onboarding

On Android, open the scanned link in a current compatible browser, confirm pairing, install the PWA when offered, and tap **Enable notifications**.

On iPhone or iPad, open the scanned link in Safari, confirm pairing, choose **Share → Add to Home Screen**, reopen Token M from its Home Screen icon, and only then tap **Enable notifications**. A normal Safari tab cannot request the required Home Screen Web Push permission and the UI explains this state.

Use **Send test notification** from either the PWA or Desktop. Then complete the real-device matrix in `docs/token-m-implementation-plan.md`; automated tests do not constitute Android or iPhone delivery verification.

## 7. Local-only Worker smoke test

For local testing, copy `worker/.dev.vars.example` to the git-ignored `worker/.dev.vars`, use development-only values, set the matching VAPID public variable, and run:

```powershell
Push-Location worker
npm run dev
Pop-Location
```

Delete each local secret file explicitly when it is no longer needed. Do not commit `.dev.vars`, production credentials, pairing URLs, PushSubscription keys, or captured hook input.
