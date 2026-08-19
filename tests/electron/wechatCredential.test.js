'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CredentialStore,
  credentialSettingsForRenderer,
  persistSettingsAndCredentials,
  stripCredentialSettings
} = require('../../src/shared/credentialStore');

const CREDENTIAL = `tm_wx_d1.dev_abcdefghijklmnopqrstuv.${'x'.repeat(43)}`;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-wechat-credential-'));
  const settingsPath = path.join(directory, 'settings.json');
  const credentialsPath = path.join(directory, 'credentials.json');
  t.after(() => {
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
    if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
    fs.rmdirSync(directory);
  });
  return { directory, settingsPath, credentialsPath };
}

test('WeChat credential migrates into the private store and is stripped from settings', (t) => {
  const { directory, settingsPath } = fixture(t);
  const store = new CredentialStore(directory);
  const migrated = store.migrateLegacySettings({ tokenMWeChatCredential: CREDENTIAL });
  assert.equal(migrated.migrated, true);
  assert.equal(store.settingsCredentials().tokenMWeChatCredential, CREDENTIAL);
  assert.equal(stripCredentialSettings({ tokenMWeChatCredential: CREDENTIAL, visible: true }).tokenMWeChatCredential, undefined);

  persistSettingsAndCredentials({
    store,
    settingsPath,
    settings: { tokenMWeChatCredential: CREDENTIAL, tokenMWeChatApiUrl: 'https://example.test' },
    previousSettings: {}
  });
  const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(savedSettings.tokenMWeChatCredential, undefined);
  assert.doesNotMatch(fs.readFileSync(settingsPath, 'utf8'), /tm_wx_d1/);
});

test('renderer redaction never returns the WeChat bearer', () => {
  const redacted = credentialSettingsForRenderer({ tokenMWeChatCredential: CREDENTIAL }, {
    expose: ['hubHostSecret', 'secret']
  });
  assert.equal(redacted.tokenMWeChatCredential, '');
  assert.doesNotMatch(JSON.stringify(redacted), /tm_wx_d1|abcdefghijklmnopqrstuv/);
  const preload = fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8');
  assert.doesNotMatch(preload, /tokenMWeChatCredential|tm_wx_d1/);
});
