'use strict';

const { androidApiOrigin, createAndroidClient, credentialDesktopId } = require('./androidClient');
const { listAllRemoteUsageSnapshots, dedupeRemoteUsageItems } = require('../shared/remoteUsage');

const REMOTE_USAGE_NORMAL_REFRESH_MS = 60 * 1000;
const REMOTE_USAGE_MANUAL_DEBOUNCE_MS = 5 * 1000;

function safeCode(error, fallback = 'remote_usage_unavailable') {
  const code = String(error?.code || fallback);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : fallback;
}

function isoAt(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function normalizedConfig(raw = {}) {
  const baseUrl = String(raw.baseUrl || raw.tokenMAndroidApiUrl || '').trim();
  const credential = String(raw.credential || raw.tokenMAndroidCredential || '').trim();
  let endpoint = '';
  let desktopId = '';
  let configError = '';
  if (baseUrl) {
    try { endpoint = androidApiOrigin(baseUrl); }
    catch (_) { configError = 'invalid_config'; }
  }
  if (credential) {
    desktopId = credentialDesktopId(credential);
    if (!desktopId) configError = 'invalid_credential';
  }
  const configured = Boolean(endpoint && desktopId && !configError);
  return {
    endpoint,
    credential,
    desktopId,
    configured,
    configError,
    identity: configured ? `${endpoint}\u0000${desktopId}\u0000${credential}` : ''
  };
}

function createRemoteUsageRuntime(options = {}) {
  const {
    getConfig = () => ({}),
    clientFactory = createAndroidClient,
    listSnapshots = listAllRemoteUsageSnapshots,
    fetch,
    now = () => Date.now(),
    onUpdate = () => {},
    logger = {}
  } = options;
  if (typeof getConfig !== 'function') throw new TypeError('getConfig must be a function');
  if (typeof clientFactory !== 'function' || typeof listSnapshots !== 'function') throw new TypeError('remote usage dependencies are required');
  if (typeof onUpdate !== 'function') throw new TypeError('onUpdate must be a function');

  let config = normalizedConfig();
  let client = null;
  let items = [];
  let generation = 0;
  let request = null;
  let timer = null;
  let stopped = true;
  let status = 'unconfigured';
  let errorCode = null;
  let lastAttemptAt = 0;
  let lastSuccessAt = 0;
  let lastManualAt = 0;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function clearRemoteData() {
    items = [];
    lastAttemptAt = 0;
    lastSuccessAt = 0;
    lastManualAt = 0;
    errorCode = null;
  }

  function publicState() {
    return {
      status,
      configured: config.configured,
      sourceCount: new Set(items.map((item) => item.source.desktopId)).size,
      profileCount: items.length,
      hasCachedData: items.length > 0,
      lastAttemptAt: isoAt(lastAttemptAt),
      lastSuccessAt: isoAt(lastSuccessAt),
      errorCode
    };
  }

  function publish() {
    const state = publicState();
    try { onUpdate(state); } catch (_) {}
    return state;
  }

  function schedule() {
    clearTimer();
    if (stopped || !config.configured) return;
    timer = setTimeout(() => {
      timer = null;
      void refresh({ reason: 'interval' });
    }, REMOTE_USAGE_NORMAL_REFRESH_MS);
    timer.unref?.();
  }

  function configure(raw = getConfig()) {
    const next = normalizedConfig(raw);
    const identityChanged = next.identity !== config.identity;
    if (identityChanged) {
      generation += 1;
      request?.abort?.();
      request = null;
      clearRemoteData();
      client = null;
    }
    config = next;
    clearTimer();
    if (!config.configured) {
      status = config.configError ? 'unavailable' : 'unconfigured';
      errorCode = config.configError || null;
      if (stopped) return publish();
      return publish();
    }
    if (!client || identityChanged) {
      try {
        client = clientFactory({
          baseUrl: config.endpoint,
          credential: config.credential,
          fetch,
          timeoutMs: 5_000
        });
        status = 'unavailable';
        errorCode = null;
      } catch (error) {
        client = null;
        status = 'unavailable';
        errorCode = safeCode(error, 'invalid_config');
      }
    }
    if (!stopped && client) void refresh({ force: true, reason: 'configure' });
    return publish();
  }

  async function refresh({ force = false, reason = 'manual' } = {}) {
    if (stopped) return publicState();
    if (!config.configured || !client) return publicState();
    const currentNow = Number(now()) || Date.now();
    if (request) return request;
    if (force && currentNow - lastManualAt < REMOTE_USAGE_MANUAL_DEBOUNCE_MS) return publicState();
    if (!force && lastAttemptAt > 0 && currentNow - lastAttemptAt < REMOTE_USAGE_NORMAL_REFRESH_MS) return publicState();
    if (force && reason === 'manual') lastManualAt = currentNow;
    lastAttemptAt = currentNow;
    const requestGeneration = generation;
    const activeClient = client;
    request = (async () => {
      try {
        const fetched = await listSnapshots(activeClient, {
          excludeSelf: true,
          desktopId: config.desktopId
        });
        if (requestGeneration !== generation || activeClient !== client) return publicState();
        items = dedupeRemoteUsageItems(fetched, {
          excludeSelf: true,
          desktopId: config.desktopId
        });
        lastSuccessAt = Number(now()) || Date.now();
        errorCode = null;
        status = 'ready';
        publish();
        logger.debug?.('Remote usage refreshed', { reason, profileCount: items.length });
      } catch (error) {
        if (requestGeneration !== generation || activeClient !== client) return publicState();
        errorCode = safeCode(error);
        status = error?.status === 401 || error?.status === 403
          ? 'unauthenticated'
          : (items.length > 0 ? 'stale' : 'unavailable');
        logger.warn?.('Remote usage refresh failed', { code: errorCode, status });
        publish();
      } finally {
        if (requestGeneration === generation && activeClient === client) {
          request = null;
          schedule();
        }
      }
      return publicState();
    })();
    return request;
  }

  function compositionState() {
    return {
      ...publicState(),
      localDesktopId: config.desktopId,
      items
    };
  }

  return {
    configure,
    start() {
      stopped = false;
      return configure(getConfig());
    },
    stop() {
      stopped = true;
      generation += 1;
      request?.abort?.();
      request = null;
      clearTimer();
      client = null;
      clearRemoteData();
      config = normalizedConfig();
      status = 'unconfigured';
      return publicState();
    },
    refresh,
    getState: publicState,
    getCompositionState: compositionState,
    constants: {
      normalRefreshMs: REMOTE_USAGE_NORMAL_REFRESH_MS,
      manualDebounceMs: REMOTE_USAGE_MANUAL_DEBOUNCE_MS
    }
  };
}

module.exports = {
  REMOTE_USAGE_MANUAL_DEBOUNCE_MS,
  REMOTE_USAGE_NORMAL_REFRESH_MS,
  createRemoteUsageRuntime,
  normalizedConfig
};
