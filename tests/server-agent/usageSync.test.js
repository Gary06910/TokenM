'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { createUsageSyncRuntime } = require('../../src/server-agent/usageSyncRuntime');
const { createServerAgentSupervisor } = require('../../src/server-agent/supervisor');
const { serializeServerSnapshot } = require('../../src/server-agent/snapshot');

function snapshot(id = 'codex', tokens = 1) {
  return serializeServerSnapshot({ today: { totalTokens: tokens }, updatedAt: '2026-09-22T00:00:00.000Z' }, { profile: { id, name: id } }).snapshot;
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fixture(send = async () => {}, options = {}) {
  let time = 0; let id = 0; const timers = new Map(); const sent = [];
  const deps = {
    now: () => time,
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
    clearTimeout: (key) => timers.delete(key),
    loadCredential: () => ({ state: 'configured', credential: 'local-test' }),
    createClient: () => ({ putUsageSnapshot: async (value) => { sent.push({ at: time, value }); return send(value); } })
  };
  const config = { endpoint: 'https://example.test', profiles: [{ id: 'codex', enabled: true }, { id: 'codex-srj', enabled: true }] };
  const runtime = createUsageSyncRuntime({ config, ...options }, deps);
  async function advance(ms) {
    time += ms;
    for (const [key, timer] of timers) if (timer.at <= time) { timers.delete(key); timer.fn(); }
    await settle();
  }
  return { runtime, sent, timers, advance, deps, config };
}
test('initial upload immediate, independent profiles, 60s minimum and latest-only coalescing', async () => {
  const f = fixture(); f.runtime.start();
  f.runtime.accept('codex', snapshot()); f.runtime.accept('codex-srj', snapshot('codex-srj'));
  await settle(); assert.equal(f.sent.length, 2);
  for (const tokens of [2, 3, 4]) f.runtime.accept('codex', snapshot('codex', tokens));
  await f.advance(59999); assert.equal(f.sent.length, 2);
  await f.advance(1); assert.equal(f.sent.length, 3);
  assert.equal(f.sent[2].value.today.totalTokens, 4);
  assert.deepEqual(f.sent.map((s) => s.at), [0, 0, 60000]);
  await f.runtime.stop(); assert.equal(f.timers.size, 0);
});
test('slow A and fresh B remain serial even beyond minimum interval', async () => {
  let finish; const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  f.runtime.start(); f.runtime.accept('codex', snapshot()); await settle();
  f.runtime.accept('codex', snapshot('codex', 2));
  await f.advance(120000); assert.equal(f.sent.length, 1);
  finish(); await settle(); assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].value.today.totalTokens, 2);
  finish(); await settle(); await f.runtime.stop();
});
for (const status of [undefined, 408, 425, 429, 500, 502, 503, 504]) test('retry latest snapshot on network/HTTP ' + status, async () => {
  const f = fixture(async () => { throw Object.assign(Error('private response'), { status }); });
  f.runtime.start(); f.runtime.accept('codex', snapshot()); await settle();
  f.runtime.accept('codex', snapshot('codex', 9));
  await f.advance(60000); assert.equal(f.sent.length, 2); assert.equal(f.sent[1].value.today.totalTokens, 9);
  await f.advance(60000); assert.equal(f.sent.length, 3); assert.equal(f.sent[2].value.today.totalTokens, 9);
  await f.runtime.stop(); assert.equal(f.timers.size, 0);
});
for (const status of [401, 403]) test('credential pause ' + status + ' cancels timers without repeated requests', async () => {
  const f = fixture(async () => { throw Object.assign(Error('private credential'), { status }); });
  f.runtime.start(); f.runtime.accept('codex', snapshot()); await settle();
  assert.equal(f.runtime.status().state, 'paused_credential');
  assert.equal(f.runtime.accept('codex', snapshot()), false);
  await f.advance(1000000); assert.equal(f.sent.length, 1); assert.equal(f.timers.size, 0);
  await f.runtime.stop();
});
test('stop has bounded grace, cancels pending and never schedules after late completion', async () => {
  let finish; const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  f.runtime.start(); f.runtime.accept('codex', snapshot()); await settle();
  f.runtime.accept('codex', snapshot('codex', 2));
  const stopping = f.runtime.stop(); await f.advance(2000); await stopping;
  assert.equal(f.timers.size, 0); finish(); await settle();
  await f.advance(60000); assert.equal(f.sent.length, 1); assert.equal(f.timers.size, 0);
});
test('once, missing endpoint/credential, malformed credential and worker mismatch fail open', async () => {
  const once = fixture(undefined, { once: true }); assert.equal(once.runtime.start().state, 'skipped_once');
  assert.equal(once.runtime.accept('codex', snapshot()), false);
  const empty = fixture(undefined, { config: {} }); assert.equal(empty.runtime.start().state, 'unconfigured');
  const f = fixture();
  for (const loadCredential of [() => ({ state: 'unconfigured' }), () => { throw Error('private'); }]) {
    const runtime = createUsageSyncRuntime({ config: f.config }, { ...f.deps, loadCredential });
    assert.equal(runtime.start().state, 'unconfigured');
  }
  f.runtime.start(); assert.equal(f.runtime.accept('codex-srj', snapshot()), false);
  const value = snapshot(); value.today.prompt = 'secret'; assert.equal(f.runtime.accept('codex', value), false);
  assert.equal(f.sent.length, 0); await f.runtime.stop();
});
for (const once of [false, true]) test('supervisor integration with independent notification and usage lifecycles; once=' + once, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-2c-'));
  const children = []; let syncCreated = 0;
  const f = fixture(async () => { throw Object.assign(Error(), { status: 500 }); });
  const supervisor = createServerAgentSupervisor({
    config: { version: 1, endpoint: 'https://example.test', profiles: [{ id: 'codex', name: 'Codex', codexHome: root, enabled: true }] },
    paths: { profileStateDir: () => root }, pidFile: false, once,
    configValidation: {}, startTimeoutMs: 10
  }, {
    fork: () => {
      const child = new EventEmitter(); child.connected = true;
      child.send = () => { child.emit('exit', 0, null); };
      children.push(child); queueMicrotask(() => child.emit('message', { type: 'worker.ready', profileId: 'codex' }));
      return child;
    },
    createNotificationRuntime: () => ({ start: () => ({ state: 'ready' }), stop: () => ({ state: 'stopped' }),
      publicStatus: () => ({ state: 'ready' }), enqueue: async () => ({ ok: true }) }),
    createUsageSyncRuntime: () => { syncCreated++; return f.runtime; }
  });
  try {
    await supervisor.start();
    children[0].emit('message', { type: 'worker.snapshot', profileId: 'codex', snapshot: snapshot() });
    await settle();
    assert.equal(supervisor.getSnapshot('codex').profile.id, 'codex');
    assert.equal(syncCreated, once ? 0 : 1);
    assert.equal(f.sent.length, once ? 0 : 1);
    if (!once) {
      assert.equal(supervisor.getDiagnostics().notification.state, 'ready');
      children[0].emit('message', { type: 'worker.snapshot', profileId: 'codex', snapshot: snapshot('codex', 99) });
      assert.equal(supervisor.getSnapshot('codex').today.totalTokens, 99);
    }
    children[0].emit('message', { type: 'worker.snapshot', profileId: 'codex', snapshot: snapshot('codex-srj') });
    assert.equal(supervisor.getSnapshot('codex').profile.id, 'codex');
  } finally { await supervisor.stop(); fs.rmdirSync(root); }
});
