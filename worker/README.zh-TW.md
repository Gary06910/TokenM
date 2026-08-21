# Token M 可選 Cloudflare Hub

此目錄僅包含 Token M 多裝置用量同步的可選 Cloudflare Worker。

它提供 `/api/*` 用量、歷史、訂閱和 SSE 同步介面，不是行動通知後端，也不提供 QR 綁定、PWA、Web Push 或微信通知。

目前行動通知請使用 `wechat-miniapp/` 及其 CloudBase `tokenm-api` 雲端函式。
