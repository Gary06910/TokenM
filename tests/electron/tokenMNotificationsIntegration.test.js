'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { credentialSettingsForRenderer } = require('../../src/shared/credentialStore');
const { createTokenMNotificationRuntime, hookCommandFor } = require('../../src/electron/tokenMNotificationRuntime');

const TENANT = 'abcdefghijklmnopqrstuv';
const DEVICE = 'dev_abcdefghijklmnopqrstuv';
const CREDENTIAL = `tm_d1.${TENANT}.${DEVICE}.${'x'.repeat(43)}`;

function jsonResponse(status, value) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

function removeFile(filePath) {
  try { fs.unlinkSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

test('notification credential stays redacted from renderer settings', () => {
  const redacted = credentialSettingsForRenderer({ tokenMCloudCredential: CREDENTIAL }, {
    expose: ['hubHostSecret', 'secret']
  });
  assert.equal(redacted.tokenMCloudCredential, '');
  const preload = fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8');
  assert.doesNotMatch(preload, /tokenMCloudCredential|tm_d1/);
});

test('stable hook command survives runtime token and port changes and disables exactly', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-notification-ui-'));
  const userDataPath = path.join(root, 'user-data');
  const codexHome = path.join(root, 'codex');
  fs.mkdirSync(userDataPath);
  fs.mkdirSync(codexHome);
  const helperPath = path.join(__dirname, '../../src/electron/codexHookForwarder.js');
  const executablePath = process.execPath;
  let settings = {
    tokenMCloudUrl: 'https://example.workers.dev',
    tokenMCloudCredential: CREDENTIAL,
    tokenMCloudDeviceId: DEVICE,
    tokenMCloudDeviceName: 'Desktop'
  };
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/v1/desktop/status')) {
      return jsonResponse(200, {
        device: { deviceId: DEVICE, name: 'Desktop' },
        mobileInstallations: []
      });
    }
    throw new Error(`unexpected ${options.method || 'GET'} ${url}`);
  };
  const runtime = createTokenMNotificationRuntime({
    userDataPath,
    codexHome,
    executablePath,
    helperPath,
    fetch,
    getSettings: () => settings,
    commitSettings: async (patch) => { settings = { ...settings, ...patch }; },
    hostname: 'Desktop'
  });
  t.after(() => {
    runtime.shutdownSync();
    removeFile(path.join(codexHome, 'hooks.json'));
    removeFile(path.join(userDataPath, 'token-m-notification-runtime.json'));
    removeFile(path.join(userDataPath, 'token-m-notification-outbox.json'));
    fs.rmdirSync(codexHome);
    fs.rmdirSync(userDataPath);
    fs.rmdirSync(root);
  });

  await runtime.start();
  const enabled = await runtime.enableCodexHook();
  assert.equal(enabled.enabled, true);
  const firstMetadata = JSON.parse(fs.readFileSync(runtime.runtimePath, 'utf8'));
  const hooksAfterEnable = fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8');
  assert.match(hooksAfterEnable, /ELECTRON_RUN_AS_NODE/);
  assert.doesNotMatch(hooksAfterEnable, new RegExp(firstMetadata.token));
  assert.doesNotMatch(hooksAfterEnable, new RegExp(`:${firstMetadata.port}`));

  await runtime.stop();
  assert.equal(fs.existsSync(runtime.runtimePath), false);
  await runtime.start();
  const secondMetadata = JSON.parse(fs.readFileSync(runtime.runtimePath, 'utf8'));
  assert.notEqual(secondMetadata.token, firstMetadata.token);
  assert.equal(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'), hooksAfterEnable);

  const disabled = await runtime.disableCodexHook();
  assert.equal(disabled.enabled, false);
  assert.equal(fs.existsSync(runtime.runtimePath), false);
  const hooks = JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  assert.deepEqual(hooks.hooks.Stop, []);
});

test('hook command identity contains only stable paths', () => {
  const command = hookCommandFor({
    platform: 'win32',
    executablePath: 'C:\\Program Files\\Token M\\Token M.exe',
    helperPath: 'C:\\Program Files\\Token M\\resources\\app.asar\\src\\electron\\codexHookForwarder.js',
    runtimePath: 'C:\\Users\\Test\\AppData\\Roaming\\Token Monitor\\token-m-notification-runtime.json'
  });
  assert.match(command, /ELECTRON_RUN_AS_NODE/);
  assert.doesNotMatch(command, /127\.0\.0\.1|tm_d1|bridge-token/);
});

test('desktop management calls use desktop auth and the frozen endpoints', async () => {
  const { createTokenMDesktopManagementClient } = require('../../src/electron/tokenMManagedApi');
  const calls = [];
  const client = createTokenMDesktopManagementClient({
    baseUrl: 'https://example.workers.dev',
    credential: CREDENTIAL,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { ok: true });
    }
  });
  await client.sendTest();
  await client.unpair('mob_abcdefghijklmnopqrstuv');
  assert.deepEqual(calls.map((call) => [call.options.method, new URL(call.url).pathname]), [
    ['POST', '/v1/desktop/test'],
    ['DELETE', '/v1/desktop/mobile/mob_abcdefghijklmnopqrstuv']
  ]);
  assert.ok(calls.every((call) => call.options.headers.authorization === `Bearer ${CREDENTIAL}`));
});

test('visible product name is Token M while legacy userData and appId stay stable', () => {
  const packageJson = require('../../package.json');
  const main = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');
  assert.equal(packageJson.productName, 'Token M');
  assert.equal(packageJson.build.productName, 'Token M');
  assert.equal(packageJson.build.appId, 'com.javis.tokenmonitor');
  assert.match(main, /LEGACY_USER_DATA_PATH = path\.join\(app\.getPath\('appData'\), 'Token Monitor'\)/);
  assert.ok(main.indexOf("app.setPath('userData', LEGACY_USER_DATA_PATH)") < main.indexOf('app.setName(APP_NAME)'));
});

test('renderer exposes phone status, QR pairing, test, and unpair controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  assert.match(html, /data-settings-section="notifications"/);
  assert.match(html, /id="notificationQrImage"/);
  assert.match(html, /id="notificationTestButton"/);
  assert.match(appJs, /tokenMNotifications\.unpair/);
  assert.match(appJs, /pairing\.pairingUrl/);
  assert.doesNotMatch(html, /tokenMCloudCredential|tm_d1/);
});
