# tokenm-api CloudBase function

This directory is a self-contained CloudBase Node.js function. Deploy it with its own dependencies; do not hoist `wx-server-sdk` to the repository root. The manifest uses the conservative `~3.0.1` compatibility line and makes no claim that it is the newest registry release. Confirm that line against the Node runtime selected in the target CloudBase environment before deployment.

Production configuration is read from function environment variables and fails closed when required values are absent:

- `PAIRING_CODE_PEPPER` and `DEVICE_SECRET_PEPPER`: different random values of at least 32 characters.
- `WECHAT_SUBSCRIBE_TEMPLATE_ID`: the approved one-time subscription template ID.
- `WECHAT_TEMPLATE_KEYWORDS` (or `WECHAT_TEMPLATE_KEYWORD_MAPPING`): JSON mapping logical values to official keyword names and compatible types, for example `{"completion":{"key":"thing1","type":"thing"},"completedAt":{"key":"time2","type":"time"}}`.
- `WECHAT_MINIPROGRAM_STATE`: `developer`, `trial`, or `formal`.
- `WECHAT_HTTP_PUBLIC_ORIGIN`: the HTTPS CloudBase gateway origin. Loopback HTTP is accepted only for automated local tests.
- `WECHAT_SUBSCRIBE_LANG`: optional; defaults to `zh_CN`.

The function uses `wx-server-sdk` with `DYNAMIC_CURRENT_ENV`. `config.json` grants only `subscribeMessage.send`; AppSecret and manually fetched access tokens are neither required nor supported.

Run the owned unit suite with `npm test` from this directory.
