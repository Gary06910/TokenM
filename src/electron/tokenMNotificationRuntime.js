'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeCodexCompletion } = require('../shared/codexCompletion');
const { writePrivateJsonAtomic } = require('../shared/credentialStore');
const { createCodexHookBridge } = require('./codexHookBridge');
const {
  disableCodexStopHook,
  enableCodexStopHook,
  readCodexHookState
} = require('./codexStopHook');
const { createNotificationOutbox } = require('./notificationOutbox');
const { createTokenMCloudClient } = require('./tokenMCloudClient');
const {
  createTokenMDesktopManagementClient,
  enrollTokenMDesktop,
  managedCloudOrigin
} = require('./tokenMManagedApi');

const DESKTOP_CREDENTIAL_RE = /^tm_d1\.[A-Za-z0-9_-]{22}\.(dev_[A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43}$/;

function posixQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function windowsQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function hookCommandFor({ platform = process.platform, executablePath = process.execPath, helperPath, runtimePath }) {
  if (![executablePath, helperPath, runtimePath].every((value) => typeof value === 'string' && path.isAbsolute(value))) {
    throw new TypeError('Hook command paths must be absolute');
  }
  if (platform === 'win32') {
    return `set "ELECTRON_RUN_AS_NODE=1"&&${windowsQuote(executablePath)} ${windowsQuote(helperPath)} ${windowsQuote(runtimePath)}`;
  }
  return `ELECTRON_RUN_AS_NODE=1 ${posixQuote(executablePath)} ${posixQuote(helperPath)} ${posixQuote(runtimePath)}`;
}

function safeMachineCode(error) {
  const code = String(error?.code || 'cloud_request_failed');
  return /^[a-zA-Z0-9_.-]{1,80}$/.test(code) ? code : 'cloud_request_failed';
}

function sanitizeDevice(value, fallback = null) {
  const deviceId = typeof value?.deviceId === 'string' && /^dev_[A-Za-z0-9_-]{22}$/.test(value.deviceId)
    ? value.deviceId
    : fallback?.deviceId;
  if (!deviceId) return null;
  const name = typeof value?.name === 'string' && value.name.trim()
    ? value.name.trim().slice(0, 120)
    : String(fallback?.name || '').slice(0, 120);
  return { deviceId, name };
}

function sanitizeInstallations(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((installation) => {
    if (!/^mob_[A-Za-z0-9_-]{22}$/.test(installation?.installationId || '')) return [];
    return [{
      installationId: installation.installationId,
      name: String(installation.name || '').trim().slice(0, 120),
      pushEnabled: installation.pushEnabled === true,
      lastSeenAt: typeof installation.lastSeenAt === 'string' ? installation.lastSeenAt : null
    }];
  });
}

function createTokenMNotificationRuntime(options) {
  const {
    userDataPath,
    fetch,
    getSettings,
    commitSettings,
    emitStatus = () => {},
    logger = {},
    codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    executablePath = process.execPath,
    helperPath = path.join(__dirname, 'codexHookForwarder.js'),
    platform = process.platform,
    hostname = os.hostname()
  } = options || {};
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new TypeError('userDataPath must be absolute');
  if (typeof fetch !== 'function' || typeof getSettings !== 'function' || typeof commitSettings !== 'function') {
    throw new TypeError('fetch, getSettings, and commitSettings are required');
  }

  const runtimePath = path.join(userDataPath, 'token-m-notification-runtime.json');
  const outboxPath = path.join(userDataPath, 'token-m-notification-outbox.json');
  const command = hookCommandFor({ platform, executablePath, helperPath, runtimePath });
  let bridge = null;
  let outbox = null;
  let cloud = null;
  let management = null;
  let cloudStatus = null;
  let lastCloudError = null;
  let stopped = true;
  let statusTimer = null;
  let lifecycle = Promise.resolve();

  function currentConfiguration() {
    const settings = getSettings() || {};
    const credential = typeof settings.tokenMCloudCredential === 'string' ? settings.tokenMCloudCredential : '';
    const match = credential.match(DESKTOP_CREDENTIAL_RE);
    const baseUrl = typeof settings.tokenMCloudUrl === 'string' ? settings.tokenMCloudUrl : '';
    return {
      settings,
      baseUrl,
      credential,
      deviceId: match?.[1] || '',
      configured: Boolean(match && baseUrl)
    };
  }

  function hookState() {
    return readCodexHookState({ codexHome, commandIdentity: command });
  }

  function publicStatus() {
    const config = currentConfiguration();
    const hook = hookState();
    const fallbackDevice = {
      deviceId: config.settings.tokenMCloudDeviceId || config.deviceId,
      name: config.settings.tokenMCloudDeviceName || hostname
    };
    const snapshot = outbox?.snapshot() || { pending: 0, lastError: null };
    return {
      configured: config.configured,
      baseUrl: config.baseUrl,
      device: config.configured ? sanitizeDevice(cloudStatus?.device, fallbackDevice) : null,
      hook: { enabled: hook.enabled, needsTrust: hook.needsTrust, error: hook.error },
      outbox: { pending: snapshot.pending, lastError: snapshot.lastError || lastCloudError },
      mobileInstallations: sanitizeInstallations(cloudStatus?.mobileInstallations)
    };
  }

  function publish() {
    const value = publicStatus();
    emitStatus(value);
    return value;
  }

  function removeRuntimeMetadata() {
    try { fs.unlinkSync(runtimePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function stopComponents() {
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
    const activeBridge = bridge;
    bridge = null;
    if (activeBridge) await activeBridge.stop();
    removeRuntimeMetadata();
    const activeOutbox = outbox;
    outbox = null;
    if (activeOutbox) await activeOutbox.stop();
    cloud = null;
    management = null;
  }

  async function startBridge() {
    if (bridge || !hookState().enabled) return;
    const config = currentConfiguration();
    if (!config.configured || !outbox) return;
    const token = crypto.randomBytes(32).toString('base64url');
    const instance = createCodexHookBridge({
      host: '127.0.0.1',
      port: 0,
      token,
      logger,
      onCompletion: async (input) => {
        const latest = currentConfiguration();
        if (!latest.configured) throw new Error('notifications_not_configured');
        const event = normalizeCodexCompletion(input, { deviceId: latest.deviceId });
        await outbox.enqueue(event);
        publish();
      }
    });
    const address = await instance.start();
    try {
      writePrivateJsonAtomic(runtimePath, { version: 1, host: '127.0.0.1', port: address.port, token });
      bridge = instance;
    } catch (error) {
      await instance.stop();
      throw error;
    }
  }

  async function refreshCloudStatus() {
    if (!cloud) return publicStatus();
    try {
      cloudStatus = await cloud.status();
      lastCloudError = null;
    } catch (error) {
      lastCloudError = safeMachineCode(error);
    }
    return publish();
  }

  async function startComponents() {
    const config = currentConfiguration();
    if (!config.configured) return;
    cloud = createTokenMCloudClient({ baseUrl: config.baseUrl, credential: config.credential, fetch });
    management = createTokenMDesktopManagementClient({ baseUrl: config.baseUrl, credential: config.credential, fetch });
    outbox = createNotificationOutbox({
      filePath: outboxPath,
      send: (event) => cloud.sendEvent(event),
      logger
    });
    await outbox.start();
    await startBridge();
    await refreshCloudStatus();
    statusTimer = setInterval(() => { void refreshCloudStatus(); }, 60_000);
    statusTimer.unref?.();
  }

  function inLifecycle(operation) {
    const run = lifecycle.then(operation, operation);
    lifecycle = run.catch(() => {});
    return run;
  }

  const api = {
    commandIdentity: command,
    runtimePath,
    start() {
      stopped = false;
      return inLifecycle(async () => {
        await stopComponents();
        if (!stopped) await startComponents();
        return publish();
      });
    },
    stop() {
      stopped = true;
      return inLifecycle(async () => {
        await stopComponents();
        return publicStatus();
      });
    },
    shutdownSync() {
      stopped = true;
      if (statusTimer) clearInterval(statusTimer);
      statusTimer = null;
      removeRuntimeMetadata();
      const activeBridge = bridge;
      bridge = null;
      if (activeBridge) void activeBridge.stop();
      const activeOutbox = outbox;
      outbox = null;
      if (activeOutbox) void activeOutbox.stop();
      cloud = null;
      management = null;
    },
    getStatus() {
      return inLifecycle(() => refreshCloudStatus());
    },
    enroll({ baseUrl, code }) {
      return inLifecycle(async () => {
        const origin = managedCloudOrigin(baseUrl);
        const enrolled = await enrollTokenMDesktop({ baseUrl: origin, code, deviceName: hostname, fetch });
        await commitSettings({
          tokenMCloudUrl: origin,
          tokenMCloudCredential: enrolled.credential,
          tokenMCloudDeviceId: enrolled.device.deviceId,
          tokenMCloudDeviceName: enrolled.device.name
        });
        cloudStatus = { device: enrolled.device, mobileInstallations: [] };
        lastCloudError = null;
        await stopComponents();
        if (!stopped) await startComponents();
        return publish();
      });
    },
    enableCodexHook() {
      return inLifecycle(async () => {
        if (!currentConfiguration().configured) throw new Error('notifications_not_configured');
        const state = enableCodexStopHook({ codexHome, command, commandWindows: command });
        if (state.enabled) {
          await commitSettings({ tokenMCodexHookEnabled: true });
          await startBridge();
        }
        publish();
        return state;
      });
    },
    disableCodexHook() {
      return inLifecycle(async () => {
        const state = disableCodexStopHook({ codexHome, commandIdentity: command });
        if (!state.error) await commitSettings({ tokenMCodexHookEnabled: false });
        const activeBridge = bridge;
        bridge = null;
        if (activeBridge) await activeBridge.stop();
        removeRuntimeMetadata();
        publish();
        return state;
      });
    },
    createPairing() {
      return inLifecycle(async () => {
        if (!cloud) throw new Error('notifications_not_configured');
        const pairing = await cloud.createPairing();
        const pairingUrl = new URL(pairing?.pairingUrl);
        const expectedOrigin = managedCloudOrigin(currentConfiguration().baseUrl);
        const expiresAt = new Date(pairing?.expiresAt);
        if (pairingUrl.origin !== expectedOrigin || pairingUrl.pathname !== '/pair'
          || !/^#token=tm_p1\.[A-Za-z0-9_-]{22}\.pair_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(pairingUrl.hash)
          || !Number.isFinite(expiresAt.getTime())) {
          throw new Error('invalid_pairing_response');
        }
        return { pairingUrl: pairingUrl.toString(), expiresAt: pairing.expiresAt };
      });
    },
    sendTest() {
      return inLifecycle(async () => {
        if (!management) throw new Error('notifications_not_configured');
        const result = await management.sendTest();
        await refreshCloudStatus();
        return result;
      });
    },
    unpair(installationId) {
      return inLifecycle(async () => {
        if (!management) throw new Error('notifications_not_configured');
        await management.unpair(installationId);
        await refreshCloudStatus();
        return publicStatus();
      });
    }
  };
  return api;
}

module.exports = {
  createTokenMNotificationRuntime,
  hookCommandFor,
  sanitizeInstallations
};
