'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Desktop settings expose redacted WeChat pairing, privacy, enable, and unpair controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');
  for (const id of [
    'notificationWeChatCodeInput',
    'notificationWeChatPairButton',
    'notificationWeChatEnabledInput',
    'notificationWeChatUnpairButton'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /name="notificationWeChatPrivacyMode" value="privacy"/);
  assert.match(html, /name="notificationWeChatPrivacyMode" value="full"/);
  assert.match(app, /tokenMNotifications\.pairWeChat/);
  assert.match(app, /tokenMNotifications\.setWeChatPrivacyMode/);
  assert.match(app, /tokenMNotifications\.unpairWeChat/);
  assert.match(preload, /notifications:pairWeChat/);
  assert.match(main, /notifications:unpairWeChat/);
  assert.doesNotMatch(`${html}\n${app}\n${preload}`, /tokenMWeChatCredential|tm_wx_d1/);
});
