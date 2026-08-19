'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createTokenMNotificationRuntime } = require('../../src/electron/tokenMNotificationRuntime');

const MANAGED_DEVICE = 'dev_abcdefghijklmnopqrstuv';
const WECHAT_DEVICE = 'dev_zyxwvutsrqponmlkjihgfe';
const MANAGED_CREDENTIAL = `tm_d1.abcdefghijklmnopqrstuv.${MANAGED_DEVICE}.${'m'.repeat(43)}`;
const WECHAT_CREDENTIAL = `tm_wx_d1.${WECHAT_DEVICE}.${'w'.repeat(43)}`;

function jsonResponse(status, value) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

function postStop(metadata, input) {
  const body = Buffer.from(JSON.stringify(input));
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: metadata.host,
      port: metadata.port,
      path: '/codex/stop',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-token-m-bridge-token': metadata.token
      }
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function createFixture(t, settings, fetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-wechat-fanout-'));
  const userDataPath = path.join(root, 'user-data');
  const codexHome = path.join(root, 'codex');
  fs.mkdirSync(userDataPath);
  fs.mkdirSync(codexHome);
  let current = { ...settings };
  const runtime = createTokenMNotificationRuntime({
    userDataPath,
    codexHome,
    fetch,
    getSettings: () => current,
    commitSettings: async (patch) => { current = { ...current, ...patch }; },
    hostname: 'Desktop'
  });
  t.after(async () => {
    await runtime.stop();
    for (const file of [
      path.join(codexHome, 'hooks.json'),
      path.join(userDataPath, 'token-m-notification-runtime.json'),
      path.join(userDataPath, 'token-m-notification-outbox.json'),
      path.join(userDataPath, 'token-m-wechat-outbox.json')
    ]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(codexHome);
    fs.rmdirSync(userDataPath);
    fs.rmdirSync(root);
  });
  return { runtime };
}

function stopInput() {
  return {
    hook_event_name: 'Stop',
    session_id: 'session-1',
    turn_id: 'turn-1',
    cwd: 'C:\\work\\token-m',
    model: 'gpt-5.6-sol',
    last_assistant_message: 'Task finished',
    occurred_at: '2026-08-18T08:00:00.000Z'
  };
}

test('WeChat-only configuration runs the shared Hook bridge and receives a normalized completion', async (t) => {
  const events = [];
  const fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/v1/desktop/status') {
      return jsonResponse(200, { ok: true, desktop: { desktopId: WECHAT_DEVICE, name: 'Desktop', status: 'active' } });
    }
    if (pathname === '/v1/desktop/events') {
      events.push(JSON.parse(options.body));
      return jsonResponse(201, { status: 'created', taskId: 'tsk_abcdefghijklmnopqrstuv' });
    }
    throw new Error(`unexpected ${options.method || 'GET'} ${url}`);
  };
  const { runtime } = createFixture(t, {
    tokenMWeChatApiUrl: 'https://wechat.example.test',
    tokenMWeChatCredential: WECHAT_CREDENTIAL,
    tokenMWeChatDesktopId: WECHAT_DEVICE,
    tokenMWeChatDesktopName: 'Desktop',
    tokenMWeChatEnabled: true,
    tokenMWeChatPrivacyMode: true
  }, fetch);
  await runtime.start();
  assert.equal((await runtime.enableCodexHook()).enabled, true);
  const metadata = JSON.parse(fs.readFileSync(runtime.runtimePath, 'utf8'));
  assert.equal(await postStop(metadata, stopInput()), 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'codex.task.completed');
  assert.match(events[0].eventId, /^evt_[A-Za-z0-9_-]{43}$/);
  assert.equal(events[0].desktopId, WECHAT_DEVICE);
  assert.equal(events[0].privacyMode, true);
  assert.equal(events[0].project, null);
  runtime.shutdownSync();
  assert.equal(fs.existsSync(runtime.runtimePath), false);
});

test('one normalized Stop fans out independently and leaves the existing managed route unchanged', async (t) => {
  const managedEvents = [];
  const wechatEvents = [];
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/desktop/status' && parsed.hostname === 'managed.example.test') {
      return jsonResponse(200, { device: { deviceId: MANAGED_DEVICE, name: 'Desktop' }, mobileInstallations: [] });
    }
    if (parsed.pathname === '/v1/desktop/status') {
      return jsonResponse(200, { ok: true, desktop: { desktopId: WECHAT_DEVICE, name: 'Desktop', status: 'active' } });
    }
    if (parsed.pathname === '/v1/events') {
      managedEvents.push(JSON.parse(options.body));
      throw Object.assign(new Error('managed route offline'), { code: 'network_error' });
    }
    if (parsed.pathname === '/v1/desktop/events') {
      wechatEvents.push(JSON.parse(options.body));
      return jsonResponse(201, { status: 'created', taskId: 'tsk_abcdefghijklmnopqrstuv' });
    }
    throw new Error(`unexpected ${options.method || 'GET'} ${url}`);
  };
  const { runtime } = createFixture(t, {
    tokenMCloudUrl: 'https://managed.example.test',
    tokenMCloudCredential: MANAGED_CREDENTIAL,
    tokenMCloudDeviceId: MANAGED_DEVICE,
    tokenMCloudDeviceName: 'Desktop',
    tokenMWeChatApiUrl: 'https://wechat.example.test',
    tokenMWeChatCredential: WECHAT_CREDENTIAL,
    tokenMWeChatDesktopId: WECHAT_DEVICE,
    tokenMWeChatDesktopName: 'Desktop',
    tokenMWeChatEnabled: true,
    tokenMWeChatPrivacyMode: false
  }, fetch);
  await runtime.start();
  await runtime.enableCodexHook();
  const metadata = JSON.parse(fs.readFileSync(runtime.runtimePath, 'utf8'));
  assert.equal(await postStop(metadata, stopInput()), 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(managedEvents.length, 1);
  assert.equal(wechatEvents.length, 1);
  assert.equal(managedEvents[0].type, 'codex.turn.completed');
  assert.equal(managedEvents[0].status, 'completed');
  assert.equal(managedEvents[0].deviceId, MANAGED_DEVICE);
  assert.equal(wechatEvents[0].event, 'codex.task.completed');
  assert.equal(wechatEvents[0].desktopId, WECHAT_DEVICE);
  assert.notEqual(managedEvents[0].deviceId, wechatEvents[0].desktopId);
  assert.equal(wechatEvents[0].eventId, managedEvents[0].eventId);
  assert.equal(wechatEvents[0].summary, 'Task finished');
  assert.equal(wechatEvents[0].project, 'token-m');
  const status = await runtime.getStatus();
  assert.equal(status.outbox.pending, 1);
  assert.equal(status.wechat.outbox.pending, 0);
  const retained = JSON.parse(fs.readFileSync(path.join(path.dirname(runtime.runtimePath), 'token-m-notification-outbox.json'), 'utf8'));
  assert.equal(retained.items[0].event.eventId, wechatEvents[0].eventId);
});
