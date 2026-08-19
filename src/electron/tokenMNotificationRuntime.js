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
const { createWeChatNotificationRuntime } = require('./wechatNotificationRuntime');

const DESKTOP_CREDENTIAL_RE = /^tm_d1\.[A-Za-z0-9_-]{22}\.(dev_[A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43}$/;

function posixQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function windowsQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function legacyWindowsHookCommandFor({ executablePath, helperPath, runtimePath }) {
  return `set "ELECTRON_RUN_AS_NODE=1"&&${windowsQuote(executablePath)} ${windowsQuote(helperPath)} ${windowsQuote(runtimePath)}`;
}

function hookCommandFor({ platform = process.platform, executablePath = process.execPath, helperPath, runtimePath }) {
  if (![executablePath, helperPath, runtimePath].every((value) => typeof value === 'string' && path.isAbsolute(value))) {
    throw new TypeError('Hook command paths must be absolute');
  }
  if (platform === 'win32') {
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      '$utf8 = [System.Text.UTF8Encoding]::new($false)',
      '[Console]::InputEncoding = $utf8',
      '$OutputEncoding = $utf8',
      '$payload = [Console]::In.ReadToEnd()',
      "$env:ELECTRON_RUN_AS_NODE = '1'",
      `$payload | & ${quote(executablePath)} ${quote(helperPath)} ${quote(runtimePath)}`,
      'exit $LASTEXITCODE'
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -InputFormat Text -OutputFormat Text -EncodedCommand ${encoded}`;
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
  const commandWindows = platform === 'win32' ? command : null;
  const legacyCommands = platform === 'win32'
    ? [legacyWindowsHookCommandFor({ executablePath, helperPath, runtimePath })]
    : [];
  const commandIdentity = { command, commandWindows, legacyCommands };
  let bridge = null;
  let outbox = null;
  let cloud = null;
  let management = null;
  let cloudStatus = null;
  let lastCloudError = null;
  let stopped = true;
  let statusTimer = null;
  let lifecycle = Promise.resolve();
  const wechat = createWeChatNotificationRuntime({
    userDataPath,
    fetch,
    getSettings,
    commitSettings,
    logger,
    hostname
  });

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
    return readCodexHookState({ codexHome, commandIdentity });
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
      mobileInstallations: sanitizeInstallations(cloudStatus?.mobileInstallations),
      wechat: wechat.publicStatus()
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

  async function stopBridge() {
    const activeBridge = bridge;
    bridge = null;
    if (activeBridge) await activeBridge.stop();
    removeRuntimeMetadata();
  }

  async function stopComponents() {
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
    await stopBridge();
    const activeOutbox = outbox;
    outbox = null;
    if (activeOutbox) await activeOutbox.stop();
    await wechat.stop();
    cloud = null;
    management = null;
  }

  async function startBridge() {
    if (bridge || !hookState().enabled) return;
    const config = currentConfiguration();
    if (!(config.configured && outbox) && !wechat.isActive()) return;
    const token = crypto.randomBytes(32).toString('base64url');
    const instance = createCodexHookBridge({
      host: '127.0.0.1',
      port: 0,
      token,
      logger,
      onCompletion: async (input) => {
        const latest = currentConfiguration();
        const identityDeviceId = latest.configured ? latest.deviceId : wechat.identityDeviceId();
        if (!identityDeviceId) return;
        const event = normalizeCodexCompletion(input, { deviceId: identityDeviceId });
        const routes = [];
        if (latest.configured && outbox) routes.push(['managed', outbox.enqueue(event)]);
        if (wechat.isActive()) routes.push(['wechat', wechat.enqueue(event, input)]);
        const results = await Promise.allSettled(routes.map(([, operation]) => operation));
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.warn?.('Notification route enqueue failed', {
              route: routes[index][0],
              code: safeMachineCode(result.reason)
            });
          }
        });
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

  async function reconcileBridge() {
    const config = currentConfiguration();
    if ((config.configured && outbox) || wechat.isActive()) return startBridge();
    return stopBridge();
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
    await wechat.start();
    if (config.configured) {
      cloud = createTokenMCloudClient({ baseUrl: config.baseUrl, credential: config.credential, fetch });
      management = createTokenMDesktopManagementClient({ baseUrl: config.baseUrl, credential: config.credential, fetch });
      outbox = createNotificationOutbox({
        filePath: outboxPath,
        send: (event) => cloud.sendEvent(event),
        logger
      });
      await outbox.start();
      await refreshCloudStatus();
    }
    await startBridge();
    if (config.configured || wechat.configuration().configured) {
      statusTimer = setInterval(() => {
        void Promise.all([refreshCloudStatus(), wechat.refreshStatus()]).then(publish);
      }, 60_000);
      statusTimer.unref?.();
    }
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
      wechat.shutdownSync();
      cloud = null;
      management = null;
    },
    getStatus() {
      return inLifecycle(async () => {
        await Promise.all([refreshCloudStatus(), wechat.refreshStatus()]);
        return publish();
      });
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
        if (!currentConfiguration().configured && !wechat.configuration().configured) {
          throw new Error('notifications_not_configured');
        }
        const state = enableCodexStopHook({ codexHome, command, commandWindows, legacyCommands });
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
        const state = disableCodexStopHook({ codexHome, commandIdentity });
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
    },
    pairWeChat(request) {
      return inLifecycle(async () => {
        await wechat.pair(request);
        await reconcileBridge();
        return publish();
      });
    },
    setWeChatEnabled(enabled) {
      return inLifecycle(async () => {
        await wechat.setEnabled(enabled === true);
        await reconcileBridge();
        return publish();
      });
    },
    setWeChatPrivacyMode(privacyMode) {
      return inLifecycle(async () => {
        await wechat.setPrivacyMode(privacyMode);
        return publish();
      });
    },
    unpairWeChat() {
      return inLifecycle(async () => {
        await wechat.unpairSelf();
        await reconcileBridge();
        return publish();
      });
    }
  };
  return api;
}

module.exports = {
  createTokenMNotificationRuntime,
  hookCommandFor,
  legacyWindowsHookCommandFor,
  sanitizeInstallations
};
