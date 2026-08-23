# tokenm-api CloudBase function

This directory is a self-contained CloudBase Node.js function. Deploy it with its own dependencies; do not hoist `wx-server-sdk` to the repository root. The manifest pins `wx-server-sdk` to `4.0.2`.

`wx-server-sdk` is installed from the checked-in `vendor/wx-server-sdk-4.0.2-tokenm-diagnostic-v2.tgz`. The vendored package is generated from the integrity-verified official `4.0.2` package by `tools/build-vendored-wx-server-sdk.js`, retains the upstream metadata and license, and applies the checked-in exact-anchor patch before `npm pack`. CloudBase disables dependency lifecycle scripts during server-side installation, so a postinstall-only mutation does not survive production packaging; this local package makes both `npm ci` and `npm ci --ignore-scripts` install the patched dependency directly.

Production deployment must upload an exact prepared dependency tree with CloudBase `InstallDependency=FALSE`; server-side dependency installation would replace the patched SDK. The current production function uses that mode and has passed downloaded-artifact verification. Deployment tooling must preserve `InstallDependency=FALSE`, and every future candidate must pass the same downloaded-production-artifact verification before it is considered ready.

The patch preserves a small allowlisted `upstreamEvidence` object before `wx-server-sdk` converts CloudBase/TCB failures such as outer `-501001` into generic errors. It is observability-only: it does not change the OpenAPI endpoint, payload, auth, timeout, provider-call count, retry policy, classifier, or quota settlement. Unknown outcomes remain `unknown`, retain their reservation, and are never retried automatically. Raw errors, messages, stacks, request/response bodies, identity fields, credentials, and tokens are excluded. When updating `wx-server-sdk`, use a new empty build directory, regenerate the vendored package, and review the version, official integrity, source anchors, provenance, lockfile, and full tests; version or source-anchor mismatch fails closed. Always run `node tools/verify-diagnostic-v2-artifact.js` against the final deployment directory and the downloaded production artifact.

Production configuration is read from function environment variables and fails closed when required values are absent:

- `PAIRING_CODE_PEPPER` and `DEVICE_SECRET_PEPPER`: different random values of at least 32 characters.
- `WECHAT_SUBSCRIBE_TEMPLATE_ID`: the approved one-time subscription template ID.
- `WECHAT_TEMPLATE_KEYWORDS` (or `WECHAT_TEMPLATE_KEYWORD_MAPPING`): JSON mapping logical values to official keyword names and compatible types, for example `{"completion":{"key":"thing1","type":"thing"},"completedAt":{"key":"time2","type":"time"}}`.
- `WECHAT_MINIPROGRAM_STATE`: `developer`, `trial`, or `formal`.
- `WECHAT_HTTP_PUBLIC_ORIGIN`: the HTTPS CloudBase gateway origin. Loopback HTTP is accepted only for automated local tests.
- `WECHAT_SUBSCRIBE_LANG`: optional; defaults to `zh_CN`.

The function uses `wx-server-sdk` with `DYNAMIC_CURRENT_ENV`. `config.json` grants only `subscribeMessage.send`; AppSecret and manually fetched access tokens are neither required nor supported.

Run the owned unit suite with `npm test` from this directory.
