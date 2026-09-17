'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('notification preload preserves Android IPC arguments and status subscription lifecycle', async () => {
  const exposed = {};
  const calls = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke: async (...args) => { calls.push(args); return { ok: true }; },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => { assert.equal(listeners.get(channel), listener); listeners.delete(channel); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return { ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } } };
    }
  });
  const api = exposed.tokenMNotifications;
  const request = { baseUrl: 'https://android.example.test/tokenm-desktop-http', code: '123456' };
  await api.pairAndroid(request);
  await api.getStatus();
  await api.setAndroidEnabled(false);
  await api.setAndroidPrivacyMode(false);
  await api.unpairAndroid();
  assert.deepEqual(calls, [
    ['notifications:pairAndroid', request], ['notifications:getStatus'],
    ['notifications:setAndroidEnabled', false], ['notifications:setAndroidPrivacyMode', false],
    ['notifications:unpairAndroid']
  ]);
  let observed;
  const unsubscribe = api.onStatus((value) => { observed = value; });
  const status = { android: { bindingState: 'bound' } };
  listeners.get('notifications:status')({}, status);
  assert.equal(observed, status);
  unsubscribe();
  assert.equal(listeners.size, 0);
  assert.equal(api.pairWeChat, undefined);
  assert.equal(api.setNotificationTarget, undefined);
});

test('current Desktop source contains no legacy mobile runtime references', () => {
  const directory = path.join(__dirname, '../../src');
  for (const entry of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|html|css)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /wechat|weixin|miniprogram|微信|小程序|TOKEN_M_WECHAT_API_URL/i, path.relative(directory, file));
  }
});
