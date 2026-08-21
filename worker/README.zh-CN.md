# Token M 可选 Cloudflare Hub

此目录仅包含 Token M 多设备用量同步的可选 Cloudflare Worker。

它提供 `/api/*` 用量、历史、订阅和 SSE 同步接口，不是移动通知后端，也不提供二维码绑定、PWA、Web Push 或微信通知。

当前移动通知请使用 `wechat-miniapp/` 及其 CloudBase `tokenm-api` 云函数。
