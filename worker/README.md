# Token M Optional Cloudflare Hub

This directory contains the optional Cloudflare Worker implementation of Token M's multi-device usage-sync hub.

It serves the `/api/*` usage, history, subscription, and SSE synchronization contract. It is not a mobile-notification backend and does not provide QR pairing, PWA assets, Web Push, or WeChat delivery.

For current mobile notifications, use `wechat-miniapp/` and its CloudBase `tokenm-api` function.

## Development

```bash
npm ci
npm run dev
```

Configure `TOKEN_MONITOR_SECRET` as a Worker secret. `PUBLIC_STATS_ENABLED` and `STALE_AFTER_MS` are optional.

```bash
npx wrangler secret put TOKEN_MONITOR_SECRET
npm run deploy
```
