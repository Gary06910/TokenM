'use strict';

const os = require('node:os');
const path = require('node:path');
const {
  androidApiOrigin,
  createAndroidClient,
  credentialDesktopId,
  pairAndroidDesktop
} = require('./androidClient');
const { buildAndroidCompletionPayload } = require('./androidPayload');
const { createAndroidOutbox } = require('./androidOutbox');

const BINDING_STATES = Object.freeze(['unbound', 'pairing', 'bound', 'invalid']);
const DESKTOP_ID_RE = /^dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function androidOutboxFilePath(userDataPath, desktopId) {
  if (!DESKTOP_ID_RE.test(desktopId || '')) return null;
  return path.join(userDataPath, `token-m-android-outbox-${desktopId}.json`);
}

function safeCode(error, fallback = 'android_request_failed') {
  const code = String(error?.code || fallback);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : fallback;
}

function safeName(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, 80);
}

// Remote status is deliberately strict: an omitted or unknown status is not
// treated as active. A null status is allowed only for the local fallback used
// while retaining the last known device identity for diagnostics.
function sanitizeDesktop(value, fallback = null) {
  const source = value && typeof value === 'object' ? value : fallback;
  if (!source || typeof source !== 'object') return null;
  const desktopId = DESKTOP_ID_RE.test(source.desktopId || '')
    ? source.desktopId
    : (DESKTOP_ID_RE.test(fallback?.desktopId || '') ? fallback.desktopId : '');
  if (!desktopId) return null;
  const status = ['active', 'revoked'].includes(source.status) ? source.status : null;
  return {
    desktopId,
    name: safeName(source.name, fallback?.name || ''),
    status,
    lastSeenAt: typeof source.lastSeenAt === 'string' ? source.lastSeenAt : null,
    lastEventAt: typeof source.lastEventAt === 'string' ? source.lastEventAt : null
  };
}

function createAndroidNotificationRuntime(options) {
  const {
    userDataPath,
    fetch,
    getSettings,
    commitSettings,
    logger = {},
    hostname = os.hostname()
  } = options || {};
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be absolute');
  }
  if (typeof fetch !== 'function' || typeof getSettings !== 'function' || typeof commitSettings !== 'function') {
    throw new TypeError('fetch, getSettings, and commitSettings are required');
  }

  let client = null;
  let outbox = null;
  let desktopStatus = null;
  let lastError = null;
  let bindingState = 'unbound';
  let pairingInFlight = false;

  function configuration() {
    const settings = getSettings() || {};
    const credential = typeof settings.tokenMAndroidCredential === 'string'
      ? settings.tokenMAndroidCredential
      : '';
    const desktopId = credentialDesktopId(credential);
    const baseUrl = typeof settings.tokenMAndroidApiUrl === 'string'
      ? settings.tokenMAndroidApiUrl.trim()
      : '';
    let urlValid = !baseUrl;
    let normalizedBaseUrl = baseUrl;
    let configError = '';
    if (baseUrl) {
      try {
        normalizedBaseUrl = androidApiOrigin(baseUrl);
        urlValid = true;
      } catch (_) {
        urlValid = false;
        configError = 'invalid_config';
      }
    }
    if (credential && !desktopId) configError = 'invalid_credential';
    if (credential && !baseUrl) configError = 'invalid_config';
    return {
      settings,
      credential,
      desktopId,
      baseUrl,
      normalizedBaseUrl,
      urlValid,
      configError,
      credentialPresent: Boolean(credential),
      configured: Boolean(desktopId && baseUrl && urlValid),
      enabled: settings.tokenMAndroidEnabled === true,
      privacyMode: settings.tokenMAndroidPrivacyMode !== false
    };
  }

  function currentBindingState(config = configuration()) {
    if (pairingInFlight) return 'pairing';
    if (!config.credentialPresent) return config.configError ? 'invalid' : 'unbound';
    if (!config.configured) return 'invalid';
    return bindingState === 'invalid' ? 'invalid' : 'bound';
  }

  function fallbackDesktop(config) {
    const desktopId = config.desktopId || (DESKTOP_ID_RE.test(config.settings.tokenMAndroidDesktopId || '')
      ? config.settings.tokenMAndroidDesktopId
      : '');
    if (!desktopId) return null;
    return sanitizeDesktop({
      desktopId,
      name: config.settings.tokenMAndroidDesktopName || hostname,
      status: null
    });
  }

  function snapshot() {
    try {
      return outbox?.snapshot() || { pending: 0, lastError: null, paused: false, pausedReason: null };
    } catch (error) {
      return { pending: 0, lastError: safeCode(error, 'invalid_outbox'), paused: true, pausedReason: 'invalid_outbox' };
    }
  }

  function publicStatus() {
    const config = configuration();
    const queue = snapshot();
    const desktop = desktopStatus?.desktop || fallbackDesktop(config);
    const state = currentBindingState(config);
    return {
      bindingState: BINDING_STATES.includes(state) ? state : 'invalid',
      configured: config.configured,
      // `enabled` is intentionally independent from bindingState. A revoked
      // credential may remain enabled until the user re-pairs or disables it.
      enabled: config.enabled,
      privacyMode: config.privacyMode,
      baseUrl: config.baseUrl,
      desktop,
      outbox: {
        pending: Number.isSafeInteger(queue.pending) && queue.pending >= 0 ? queue.pending : 0,
        lastError: queue.lastError || lastError,
        paused: queue.paused === true,
        pausedReason: queue.pausedReason || null
      }
    };
  }

  function isInvalidBindingError(error) {
    return error?.status === 401
      || error?.status === 403
      || error?.code === 'desktop_revoked'
      || error?.code === 'invalid_response'
      || error?.code === 'invalid_credential'
      || error?.code === 'invalid_config'
      || error?.code === 'invalid_outbox';
  }

  function pauseOutbox(reason) {
    if (!outbox) return;
    try { outbox.pause(reason); } catch (error) {
      logger.warn?.('Android outbox pause failed', { code: safeCode(error) });
    }
  }

  function markInvalid(error, fallback = 'invalid_response') {
    bindingState = 'invalid';
    lastError = safeCode(error, fallback);
    pauseOutbox(lastError);
  }

  async function stop() {
    const active = outbox;
    outbox = null;
    client = null;
    if (active) await active.stop();
    return publicStatus();
  }

  async function refreshStatus() {
    const config = configuration();
    if (!config.credentialPresent) {
      bindingState = config.configError ? 'invalid' : 'unbound';
      if (!config.configError) lastError = null;
      return publicStatus();
    }
    if (!config.configured) {
      markInvalid(Object.assign(new Error('Android configuration is invalid'), { code: config.configError || 'invalid_config' }), 'invalid_config');
      return publicStatus();
    }
    if (!client) return publicStatus();
    try {
      const result = await client.status();
      const remote = sanitizeDesktop(result?.desktop);
      if (result?.ok !== true || !remote || remote.desktopId !== config.desktopId || !remote.status) {
        throw Object.assign(new Error('Android status response is invalid'), { code: 'invalid_response' });
      }
      desktopStatus = { desktop: remote };
      if (remote.status === 'revoked') {
        throw Object.assign(new Error('Android Desktop credential is revoked'), {
          code: 'desktop_revoked',
          status: 401
        });
      }
      bindingState = 'bound';
      lastError = null;
      if (config.enabled && outbox) await outbox.start();
    } catch (error) {
      if (isInvalidBindingError(error)) markInvalid(error);
      else lastError = safeCode(error);
    }
    return publicStatus();
  }

  async function start() {
    await stop();
    const config = configuration();
    if (!config.credentialPresent) {
      bindingState = config.configError ? 'invalid' : 'unbound';
      lastError = config.configError || null;
      return publicStatus();
    }
    if (!config.configured) {
      markInvalid(Object.assign(new Error('Android configuration is invalid'), {
        code: config.configError || 'invalid_config'
      }), 'invalid_config');
      return publicStatus();
    }
    try {
      client = createAndroidClient({
        baseUrl: config.normalizedBaseUrl,
        credential: config.credential,
        fetch,
        timeoutMs: 5_000
      });
      const outboxPath = androidOutboxFilePath(userDataPath, config.desktopId);
      if (!outboxPath) {
        throw Object.assign(new Error('Android desktop identity is invalid'), {
          code: 'invalid_credential'
        });
      }
      outbox = createAndroidOutbox({
        filePath: outboxPath,
        send: (payload) => client.sendEvent(payload),
        onDeliveryFailure: ({ error, outcome }) => {
          if (outcome?.kind === 'credential' || error?.code === 'invalid_response') markInvalid(error, 'invalid_response');
        },
        logger
      });
      try {
        outbox.load();
      } catch (error) {
        markInvalid(Object.assign(error, { code: 'invalid_outbox' }), 'invalid_outbox');
        return publicStatus();
      }
      bindingState = 'bound';
      await refreshStatus();
      if (currentBindingState() === 'bound' && config.enabled) await outbox.start();
    } catch (error) {
      if (isInvalidBindingError(error) || error instanceof TypeError) markInvalid(error, 'invalid_config');
      else lastError = safeCode(error);
    }
    return publicStatus();
  }

  return {
    get outboxPath() {
      return androidOutboxFilePath(userDataPath, configuration().desktopId);
    },
    configuration,
    publicStatus,
    isActive() {
      const config = configuration();
      return config.configured
        && config.enabled
        && currentBindingState(config) === 'bound'
        && Boolean(outbox);
    },
    identityDeviceId() { return configuration().desktopId; },
    start,
    stop,
    shutdownSync() {
      const active = outbox;
      outbox = null;
      client = null;
      if (active) void active.stop();
    },
    refreshStatus,
    enqueue(rawInput) {
      const config = configuration();
      if (!config.configured || !config.enabled || !outbox || currentBindingState(config) !== 'bound') {
        return Promise.resolve(publicStatus());
      }
      try {
        const payload = buildAndroidCompletionPayload({
          rawInput,
          desktopId: config.desktopId,
          privacyMode: config.privacyMode
        });
        return outbox.enqueue(payload).catch((error) => {
          if (error?.code === 'invalid_outbox') markInvalid(error, 'invalid_outbox');
          throw error;
        });
      } catch (error) {
        return Promise.reject(error);
      }
    },
    async pair({ baseUrl, code, deviceName } = {}) {
      if (pairingInFlight) throw Object.assign(new Error('Android pairing is already in progress'), { code: 'pairing_in_progress' });
      const previousState = currentBindingState();
      pairingInFlight = true;
      lastError = null;
      bindingState = 'pairing';
      try {
        const configuredRoot = baseUrl || configuration().baseUrl;
        const root = androidApiOrigin(configuredRoot);
        const paired = await pairAndroidDesktop({
          baseUrl: root,
          code,
          deviceName: deviceName || hostname,
          fetch,
          timeoutMs: 5_000
        });
        await commitSettings({
          tokenMAndroidApiUrl: root,
          tokenMAndroidCredential: paired.credential,
          tokenMAndroidDesktopId: paired.desktop.desktopId,
          tokenMAndroidDesktopName: paired.desktop.name,
          tokenMAndroidEnabled: true,
          tokenMAndroidPrivacyMode: true
        });
        desktopStatus = { desktop: { ...paired.desktop, status: 'active' } };
        bindingState = 'bound';
        lastError = null;
        pairingInFlight = false;
        return publicStatus();
      } catch (error) {
        bindingState = previousState === 'bound' ? 'bound' : (previousState === 'invalid' ? 'invalid' : 'unbound');
        lastError = safeCode(error);
        throw error;
      } finally {
        pairingInFlight = false;
      }
    },
    async setEnabled(enabled) {
      const config = configuration();
      if (enabled === true && !config.configured) throw new Error('android_not_configured');
      await commitSettings({ tokenMAndroidEnabled: enabled === true });
      await start();
      return publicStatus();
    },
    async setPrivacyMode(privacyMode) {
      if (privacyMode !== true && privacyMode !== false) {
        throw new TypeError('privacyMode must be boolean');
      }
      await commitSettings({ tokenMAndroidPrivacyMode: privacyMode });
      return publicStatus();
    },
    async unpairSelf() {
      const config = configuration();
      if (!config.configured) throw new Error('android_not_configured');
      const activeClient = client || createAndroidClient({
        baseUrl: config.normalizedBaseUrl,
        credential: config.credential,
        fetch,
        timeoutMs: 5_000
      });
      await activeClient.unpairSelf();
      await commitSettings({
        tokenMAndroidCredential: '',
        tokenMAndroidDesktopId: '',
        tokenMAndroidDesktopName: '',
        tokenMAndroidEnabled: false
      });
      desktopStatus = null;
      bindingState = 'unbound';
      lastError = null;
      await stop();
      return publicStatus();
    }
  };
}

module.exports = {
  BINDING_STATES,
  androidOutboxFilePath,
  createAndroidNotificationRuntime,
  sanitizeDesktop
};
