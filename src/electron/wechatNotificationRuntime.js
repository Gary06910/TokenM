'use strict';

const os = require('node:os');
const path = require('node:path');
const { buildWeChatCompletionPayload } = require('./wechatPayload');
const {
  createWeChatClient,
  credentialDesktopId,
  pairWeChatDesktop,
  wechatApiOrigin
} = require('./wechatClient');
const { createWeChatOutbox } = require('./wechatOutbox');

function safeCode(error) {
  const code = String(error?.code || 'wechat_request_failed');
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'wechat_request_failed';
}

function sanitizeDesktop(value, fallback = null) {
  const desktopId = /^dev_[A-Za-z0-9_-]{22}$/.test(value?.desktopId || '')
    ? value.desktopId
    : fallback?.desktopId;
  if (!desktopId) return null;
  const name = String(value?.name || fallback?.name || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 80);
  return {
    desktopId,
    name,
    status: ['active', 'revoked'].includes(value?.status) ? value.status : 'active',
    lastSeenAt: typeof value?.lastSeenAt === 'string' ? value.lastSeenAt : null,
    lastEventAt: typeof value?.lastEventAt === 'string' ? value.lastEventAt : null
  };
}

function createWeChatNotificationRuntime(options) {
  const {
    userDataPath,
    fetch,
    getSettings,
    commitSettings,
    logger = {},
    hostname = os.hostname()
  } = options || {};
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new TypeError('userDataPath must be absolute');
  if (typeof fetch !== 'function' || typeof getSettings !== 'function' || typeof commitSettings !== 'function') {
    throw new TypeError('fetch, getSettings, and commitSettings are required');
  }

  const outboxPath = path.join(userDataPath, 'token-m-wechat-outbox.json');
  let client = null;
  let outbox = null;
  let desktopStatus = null;
  let lastError = null;

  function configuration() {
    const settings = getSettings() || {};
    const credential = typeof settings.tokenMWeChatCredential === 'string' ? settings.tokenMWeChatCredential : '';
    const desktopId = credentialDesktopId(credential);
    const baseUrl = typeof settings.tokenMWeChatApiUrl === 'string' ? settings.tokenMWeChatApiUrl.trim() : '';
    return {
      settings,
      credential,
      desktopId,
      baseUrl,
      configured: Boolean(desktopId && baseUrl),
      enabled: settings.tokenMWeChatEnabled !== false,
      privacyMode: settings.tokenMWeChatPrivacyMode !== false
    };
  }

  function snapshot() {
    try { return outbox?.snapshot() || { pending: 0, lastError: null }; }
    catch (error) { return { pending: 0, lastError: safeCode(error) }; }
  }

  function publicStatus() {
    const config = configuration();
    const queue = snapshot();
    const fallback = {
      desktopId: config.settings.tokenMWeChatDesktopId || config.desktopId,
      name: config.settings.tokenMWeChatDesktopName || hostname
    };
    return {
      configured: config.configured,
      enabled: config.configured && config.enabled,
      privacyMode: config.privacyMode,
      baseUrl: config.baseUrl,
      desktop: config.configured ? sanitizeDesktop(desktopStatus?.desktop, fallback) : null,
      outbox: { pending: queue.pending, lastError: queue.lastError || lastError }
    };
  }

  async function stop() {
    const active = outbox;
    outbox = null;
    client = null;
    if (active) await active.stop();
    return publicStatus();
  }

  async function refreshStatus() {
    if (!client) return publicStatus();
    try {
      const result = await client.status();
      desktopStatus = { desktop: sanitizeDesktop(result?.desktop) };
      if (!desktopStatus.desktop) throw Object.assign(new Error('invalid status'), { code: 'invalid_response' });
      lastError = null;
    } catch (error) {
      lastError = safeCode(error);
    }
    return publicStatus();
  }

  async function start() {
    await stop();
    const config = configuration();
    if (!config.configured) return publicStatus();
    client = createWeChatClient({
      baseUrl: config.baseUrl,
      credential: config.credential,
      fetch,
      timeoutMs: 5_000
    });
    outbox = createWeChatOutbox({
      filePath: outboxPath,
      send: (payload) => client.sendEvent(payload),
      logger
    });
    if (config.enabled) await outbox.start();
    return refreshStatus();
  }

  return {
    outboxPath,
    configuration,
    publicStatus,
    isActive() {
      const config = configuration();
      return config.configured && config.enabled && Boolean(outbox);
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
    enqueue(completion, rawInput) {
      const config = configuration();
      if (!config.configured || !config.enabled || !outbox) return Promise.resolve(publicStatus());
      return outbox.enqueue(buildWeChatCompletionPayload({
        completion,
        rawInput,
        desktopId: config.desktopId,
        privacyMode: config.privacyMode
      }));
    },
    async pair({ baseUrl, code, deviceName } = {}) {
      const configuredOrigin = baseUrl || configuration().baseUrl;
      const origin = wechatApiOrigin(configuredOrigin);
      const paired = await pairWeChatDesktop({
        baseUrl: origin,
        code,
        deviceName: deviceName || hostname,
        fetch,
        timeoutMs: 5_000
      });
      await commitSettings({
        tokenMWeChatApiUrl: origin,
        tokenMWeChatCredential: paired.credential,
        tokenMWeChatDesktopId: paired.desktop.desktopId,
        tokenMWeChatDesktopName: paired.desktop.name,
        tokenMWeChatEnabled: true,
        tokenMWeChatPrivacyMode: true
      });
      desktopStatus = { desktop: { ...paired.desktop, status: 'active' } };
      lastError = null;
      await start();
      return publicStatus();
    },
    async setEnabled(enabled) {
      if (enabled === true && !configuration().configured) throw new Error('wechat_not_configured');
      await commitSettings({ tokenMWeChatEnabled: enabled === true });
      await start();
      return publicStatus();
    },
    async setPrivacyMode(privacyMode) {
      if (privacyMode !== true && privacyMode !== false) throw new TypeError('privacyMode must be boolean');
      await commitSettings({ tokenMWeChatPrivacyMode: privacyMode });
      return publicStatus();
    },
    async unpairSelf() {
      if (!client) throw new Error('wechat_not_configured');
      await client.unpairSelf();
      await commitSettings({
        tokenMWeChatCredential: '',
        tokenMWeChatDesktopId: '',
        tokenMWeChatDesktopName: '',
        tokenMWeChatEnabled: false
      });
      desktopStatus = null;
      lastError = null;
      await stop();
      return publicStatus();
    }
  };
}

module.exports = {
  createWeChatNotificationRuntime,
  sanitizeDesktop
};
