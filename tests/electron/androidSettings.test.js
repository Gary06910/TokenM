'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CredentialStore,
  credentialSettingsForRenderer,
  persistSettingsAndCredentials
} = require('../../src/shared/credentialStore');

const DESKTOP_ID = 'dev_11111111-1111-4111-8111-111111111111';

test('Android Desktop credential stays in the private store and is redacted from renderer settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-android-credential-'));
  const settingsPath = path.join(directory, 'settings.json');
  const credentialsPath = path.join(directory, 'credentials.json');
  const credential = `tm_uc_d1.${DESKTOP_ID}.${crypto.randomBytes(32).toString('base64url')}`;
  t.after(() => {
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
    if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
    fs.rmdirSync(directory);
  });
  const store = new CredentialStore(directory);
  store.writeDocument({ version: 1, credentials: { tokenM: { weChatCredential: 'historical-test-value' } }, migrations: {} });
  persistSettingsAndCredentials({
    store,
    settingsPath,
    settings: {
      tokenMAndroidCredential: credential,
      tokenMAndroidApiUrl: 'https://android.example.test/tokenm-desktop-http'
    },
    previousSettings: {}
  });
  assert.equal(new CredentialStore(directory).settingsCredentials().tokenMAndroidCredential, credential);
  assert.equal(store.settingsCredentials().tokenMWeChatCredential, undefined);
  assert.equal(store.readDocument().credentials.tokenM.weChatCredential, 'historical-test-value');
  const settingsOnDisk = fs.readFileSync(settingsPath, 'utf8');
  assert.equal(JSON.parse(settingsOnDisk).tokenMAndroidCredential, undefined);
  assert.equal(settingsOnDisk.includes(credential), false);
  const redacted = credentialSettingsForRenderer({ tokenMAndroidCredential: credential }, {
    expose: ['hubHostSecret', 'secret']
  });
  assert.equal(redacted.tokenMAndroidCredential, '');
});

test('Electron exposes Android pairing without a destination selector without renderer credentials', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/i18n.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');
  const notificationSettings = fs.readFileSync(
    path.join(__dirname, '../../src/electron/renderer/tokenMNotificationSettings.js'),
    'utf8'
  );
  const generalStart = html.indexOf('data-settings-section="general"');
  const notificationsStart = html.indexOf('data-settings-section="notifications"');
  assert.ok(generalStart >= 0 && notificationsStart > generalStart, 'notifications must follow the General section');
  const generalMarkup = html.slice(generalStart, notificationsStart);
  const notificationsMarkup = html.slice(notificationsStart, html.indexOf('data-settings-section="main"', notificationsStart));
  assert.doesNotMatch(generalMarkup, /tokenMNotificationSettings/);
  assert.match(notificationsMarkup, /id="tokenMNotificationSettings"/);
  assert.match(notificationsMarkup, /data-i18n="settings\.notifications\.title"/);
  assert.match(app, /SETTINGS_SECTION_IDS = \[[^\]]*'notifications'/);
  for (const id of [
    'tokenMNotificationPairingCode',
    'tokenMNotificationPairButton',
    'tokenMNotificationEnabled',
    'tokenMNotificationUnpairButton'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /tokenMNotificationSettings\.js/);
  for (const label of ['手机通知', 'Android 设备', '隐私模式', '完整模式', '解除此电脑绑定', 'Codex 完成通知']) {
    assert.match(i18n, new RegExp(label));
  }
  for (const oldLabel of ['Token M Android notifications', 'Pair Android', 'Privacy mode', 'Full mode', 'Unpair this computer', 'Enable hook', 'Disable hook', 'pending', 'last seen']) {
    assert.doesNotMatch(notificationsMarkup, new RegExp(oldLabel));
  }
  for (const oldLabel of ['Token M Android notifications', 'Pair Android', 'Privacy mode', 'Full mode', 'Unpair this computer', 'Enable hook', 'Disable hook']) {
    assert.doesNotMatch(notificationSettings, new RegExp(oldLabel));
  }
  assert.doesNotMatch(html, /notificationTarget|WeChat|微信/);
  assert.doesNotMatch(preload, /WeChat|setNotificationTarget/);
  assert.match(notificationSettings, /api\.pairAndroid/);
  assert.match(notificationSettings, /api\.setAndroidEnabled/);
  assert.match(notificationSettings, /api\.setAndroidPrivacyMode/);
  assert.match(notificationSettings, /api\.unpairAndroid/);
  assert.match(notificationSettings, /api\.enableCodexHook/);
  assert.match(notificationSettings, /api\.disableCodexHook/);
  assert.match(preload, /notifications:pairAndroid/);
  assert.match(main, /notifications:unpairAndroid/);
  assert.match(notificationSettings, /bindingState/);
  assert.match(notificationSettings, /lastSeen/);
  assert.match(notificationSettings, /invalid/);
  assert.match(i18n, /settings\.about\.title/);
  assert.doesNotMatch(`${html}\n${app}\n${preload}\n${notificationSettings}`, /tokenMAndroidCredential|tm_uc_d1/);
});
