'use strict';

const crypto = require('node:crypto');
const { probeLimitProvider, providerFetchers, parseLimitProviders } = require('../shared/limits/collector');
const path = require('node:path');
const { readRegularFileNoFollow } = require('../shared/credentialStore');
const { resolveCodexLimitsSource, sourceErrorCode } = require('./codexLimitsSource');
const { createLimitsDisplayCache } = require('./limitsDisplayCache');

// Deliberately outside DeviceState, upload sinks, history, and shared wire models.
function createLimitsPresentation({ filePath, getSettings, getConfig, emit = () => {}, resolveSource = resolveCodexLimitsSource, probe = probeLimitProvider }) {
  let source = null;
  function resolve() {
    const next = resolveSource({ override: getSettings().codexHomeOverride || '' });
    if (source?.bindingKey === next.bindingKey) next.error = source?.error || '';
    source = next;
    return source;
  }
  function bindingFor(provider) {
    const config = getConfig();
    const fields = Object.fromEntries(Object.entries(config).filter(([key]) => key.toLowerCase().startsWith(provider)));
    if (provider === 'codex') {
      const current = resolve();
      fields.liveIdentity = current.status === 'OK' ? current.bindingKey : current.status;
      fields.managedIdentity = (config.codexManagedAccounts || []).map((account) => {
        try {
          return crypto.createHash('sha256').update(readRegularFileNoFollow(account.authPath || path.join(account.homePath, 'auth.json'),
            { description: 'Codex managed identity', encoding: 'utf8', maxBytes: 1024 * 1024 })).digest('hex');
        } catch (_) { return 'unavailable'; }
      });
    } else if (!Object.entries(fields).some(([key, value]) => /key|token|cookie|profiles|accounts|userid/i.test(key)
      && value && (typeof value !== 'object' || Object.keys(value).length))) {
      // An external app login with no locally verifiable identity must probe first.
      return null;
    }
    return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  }
  function sourceForRenderer() {
    const value = source || resolve();
    return { provider: 'codex', status: value.status, mode: value.mode,
      authPath: value.authPath || '', error: value.error || '' };
  }
  function snapshot() {
    const display = cache.snapshot();
    const config = getConfig();
    const enabled = config.limitsEnabled === false ? [] : parseLimitProviders(config.limitProviders);
    display.providers = display.providers.filter((row) => enabled.includes(row.provider));
    for (const provider of enabled) {
      if (!display.providers.some((row) => row.provider === provider)) {
        display.providers.push({ provider, status: 'loading', windows: [] });
      }
    }
    return { ...display, source: sourceForRenderer() };
  }
  function publish() { emit(snapshot()); }
  const cache = createLimitsDisplayCache({ filePath, bindingFor, onChange: publish });
  return {
    snapshot,
    clear(provider) { cache.clear(provider); },
    resolve,
    async probeProvider(provider, options, context, deps) {
      const ticket = cache.begin(provider);
      let effectiveDeps = deps;
      if (provider === 'codex') {
        const selected = resolve();
        selected.error = '';
        const fetchCodex = providerFetchers().codex;
        effectiveDeps = { ...deps, providerFetchers: { ...deps.providerFetchers, codex: async (opts, probeDeps) => {
          if (selected.status !== 'OK') {
            const managed = await fetchCodex({ ...opts, includeLiveCodexAccount: false }, probeDeps);
            const rows = Array.isArray(managed) ? managed : [managed];
            return [...rows, { provider: 'codex', status: 'notConfigured', windows: [] }];
          }
          try {
            return await fetchCodex(opts, { ...probeDeps, codexAuthPath: selected.authPath,
              onCodexLiveLimitsError: (error) => {
                if (!context.signal?.aborted) source = { ...selected, error: sourceErrorCode(error) };
              },
              env: { ...(probeDeps.env || process.env), CODEX_HOME: selected.homePath } });
          } catch (error) {
            if (!context.signal?.aborted) source = { ...selected, error: sourceErrorCode(error) };
            throw error;
          }
        } } };
      }
      const onAbort = () => {
        if (context.signal?.reason?.code !== 'PROBE_TIMEOUT') return;
        if (provider === 'codex' && source) source.error = 'TIMEOUT';
        cache.finish(ticket, [{ provider, status: 'unavailable', windows: [] }]);
      };
      context.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const rows = await probe(provider, options, context, effectiveDeps);
        cache.finish(ticket, rows, { aborted: context.signal?.aborted, scoped: Boolean(options.limitRefreshScope?.accountKey) });
        return rows; // Original live result only; cached rows never leave this module.
      } finally {
        context.signal?.removeEventListener('abort', onAbort);
      }
    }
  };
}

module.exports = { createLimitsPresentation };
