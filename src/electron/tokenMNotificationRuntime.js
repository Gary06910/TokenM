'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeCodexCompletion } = require('../shared/codexCompletion');
const { writePrivateJsonAtomic } = require('../shared/credentialStore');
const { createCodexHookBridge } = require('./codexHookBridge');
const { disableCodexStopHook, enableCodexStopHook, readCodexHookState } = require('./codexStopHook');
const { createWeChatNotificationRuntime } = require('./wechatNotificationRuntime');

function posixQuote(value) { return `'${String(value).replaceAll("'", `'"'"'`)}'`; }
function windowsQuote(value) { return `"${String(value).replaceAll('"', '\\"')}"`; }
function legacyWindowsHookCommandFor({ executablePath, helperPath, runtimePath }) {
  return `set "ELECTRON_RUN_AS_NODE=1"&&${windowsQuote(executablePath)} ${windowsQuote(helperPath)} ${windowsQuote(runtimePath)}`;
}
function hookCommandFor({ platform = process.platform, executablePath = process.execPath, helperPath, runtimePath }) {
  if (![executablePath, helperPath, runtimePath].every((value) => typeof value === 'string' && path.isAbsolute(value))) throw new TypeError('Hook command paths must be absolute');
  if (platform === 'win32') {
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const script = ["$ProgressPreference = 'SilentlyContinue'", '$utf8 = [System.Text.UTF8Encoding]::new($false)', '[Console]::InputEncoding = $utf8', '$OutputEncoding = $utf8', '$payload = [Console]::In.ReadToEnd()', "$env:ELECTRON_RUN_AS_NODE = '1'", `$payload | & ${quote(executablePath)} ${quote(helperPath)} ${quote(runtimePath)}`, 'exit $LASTEXITCODE'].join('; ');
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -InputFormat Text -OutputFormat Text -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
  }
  return `ELECTRON_RUN_AS_NODE=1 ${posixQuote(executablePath)} ${posixQuote(helperPath)} ${posixQuote(runtimePath)}`;
}
function safeMachineCode(error) {
  const code = String(error?.code || 'cloud_request_failed');
  return /^[a-zA-Z0-9_.-]{1,80}$/.test(code) ? code : 'cloud_request_failed';
}

function createTokenMNotificationRuntime(options) {
  const { userDataPath, fetch, getSettings, commitSettings, emitStatus = () => {}, logger = {}, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), executablePath = process.execPath, helperPath = path.join(__dirname, 'codexHookForwarder.js'), platform = process.platform, hostname = os.hostname() } = options || {};
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new TypeError('userDataPath must be absolute');
  if (typeof fetch !== 'function' || typeof getSettings !== 'function' || typeof commitSettings !== 'function') throw new TypeError('fetch, getSettings, and commitSettings are required');
  const runtimePath = path.join(userDataPath, 'token-m-notification-runtime.json');
  const command = hookCommandFor({ platform, executablePath, helperPath, runtimePath });
  const commandWindows = platform === 'win32' ? command : null;
  const legacyCommands = platform === 'win32' ? [legacyWindowsHookCommandFor({ executablePath, helperPath, runtimePath })] : [];
  const commandIdentity = { command, commandWindows, legacyCommands };
  let bridge = null; let stopped = true; let statusTimer = null; let lifecycle = Promise.resolve();
  const wechat = createWeChatNotificationRuntime({ userDataPath, fetch, getSettings, commitSettings, logger, hostname });
  function hookState() { return readCodexHookState({ codexHome, commandIdentity }); }
  function publicStatus() { const hook = hookState(); return { hook: { enabled: hook.enabled, needsTrust: hook.needsTrust, error: hook.error }, wechat: wechat.publicStatus() }; }
  function publish() { const value = publicStatus(); emitStatus(value); return value; }
  function removeRuntimeMetadata() { try { fs.unlinkSync(runtimePath); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  async function stopBridge() { const active = bridge; bridge = null; if (active) await active.stop(); removeRuntimeMetadata(); }
  async function stopComponents() { if (statusTimer) clearInterval(statusTimer); statusTimer = null; await stopBridge(); await wechat.stop(); }
  async function startBridge() {
    if (bridge || !hookState().enabled || !wechat.isActive()) return;
    const token = crypto.randomBytes(32).toString('base64url');
    const instance = createCodexHookBridge({ host: '127.0.0.1', port: 0, token, logger, onCompletion: async (input) => {
      const deviceId = wechat.identityDeviceId(); if (!deviceId) return;
      const event = normalizeCodexCompletion(input, { deviceId });
      try { await wechat.enqueue(event, input); } catch (error) { logger.warn?.('WeChat notification enqueue failed', { code: safeMachineCode(error) }); }
      publish();
    } });
    const address = await instance.start();
    try { writePrivateJsonAtomic(runtimePath, { version: 1, host: '127.0.0.1', port: address.port, token }); bridge = instance; } catch (error) { await instance.stop(); throw error; }
  }
  async function reconcileBridge() { return wechat.isActive() ? startBridge() : stopBridge(); }
  async function startComponents() { await wechat.start(); await startBridge(); if (wechat.configuration().configured) { statusTimer = setInterval(() => { void wechat.refreshStatus().then(publish); }, 60_000); statusTimer.unref?.(); } }
  function inLifecycle(operation) { const run = lifecycle.then(operation, operation); lifecycle = run.catch(() => {}); return run; }
  return {
    commandIdentity: command, runtimePath,
    start() { stopped = false; return inLifecycle(async () => { await stopComponents(); if (!stopped) await startComponents(); return publish(); }); },
    stop() { stopped = true; return inLifecycle(async () => { await stopComponents(); return publicStatus(); }); },
    shutdownSync() { stopped = true; if (statusTimer) clearInterval(statusTimer); statusTimer = null; removeRuntimeMetadata(); const active = bridge; bridge = null; if (active) void active.stop(); wechat.shutdownSync(); },
    getStatus() { return inLifecycle(async () => { await wechat.refreshStatus(); return publish(); }); },
    enableCodexHook() { return inLifecycle(async () => { if (!wechat.configuration().configured) throw new Error('notifications_not_configured'); const state = enableCodexStopHook({ codexHome, command, commandWindows, legacyCommands }); if (state.enabled) { await commitSettings({ tokenMCodexHookEnabled: true }); await startBridge(); } publish(); return state; }); },
    disableCodexHook() { return inLifecycle(async () => { const state = disableCodexStopHook({ codexHome, commandIdentity }); if (!state.error) await commitSettings({ tokenMCodexHookEnabled: false }); await stopBridge(); publish(); return state; }); },
    pairWeChat(request) { return inLifecycle(async () => { await wechat.pair(request); await reconcileBridge(); return publish(); }); },
    setWeChatEnabled(enabled) { return inLifecycle(async () => { await wechat.setEnabled(enabled === true); await reconcileBridge(); return publish(); }); },
    setWeChatPrivacyMode(privacyMode) { return inLifecycle(async () => { await wechat.setPrivacyMode(privacyMode); return publish(); }); },
    unpairWeChat() { return inLifecycle(async () => { await wechat.unpairSelf(); await reconcileBridge(); return publish(); }); }
  };
}
module.exports = { createTokenMNotificationRuntime, hookCommandFor, legacyWindowsHookCommandFor };
