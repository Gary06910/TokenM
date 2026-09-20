'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLimitsDisplayCache } = require('../../src/electron/limitsDisplayCache');
const { createLimitsPresentation } = require('../../src/electron/limitsPresentation');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-limits-'));
  const filePath = path.join(dir, 'cache.json');
  t.after(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); fs.rmdirSync(dir); });
  return filePath;
}
function row(usedPercent = 34, accountKey = 'account-a') {
  return { provider: 'codex', accountKey, status: 'ok', updatedAt: '2026-09-20T01:00:00Z',
    windows: [{ kind: 'session', usedPercent, resetsAt: '2026-09-20T05:00:00Z' }] };
}
test('safe cache cold load, real zero, live replacement and no credentials', (t) => {
  const filePath = fixture(t);
  const options = { filePath, now: () => Date.parse('2026-09-20T02:00:00Z'), bindingFor: () => 'identity-a' };
  const cache = createLimitsDisplayCache(options);
  assert.deepEqual(cache.snapshot().providers, []);
  cache.finish(cache.begin('codex'), [{ ...row(), accessToken: 'SECRET', raw: { cookie: 'SECRET' }, authPath: 'C:\\private' }]);
  const disk = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(disk, /SECRET|accessToken|cookie|raw|authPath|private/);
  const restarted = createLimitsDisplayCache(options);
  assert.equal(restarted.snapshot().providers[0].windows[0].usedPercent, 34);
  assert.equal(restarted.snapshot().providers[0].cached, true);
  assert.equal(restarted.snapshot().providers[0].livePending, true);
  restarted.finish(restarted.begin('codex'), [row(0)]);
  assert.equal(restarted.snapshot().providers[0].windows[0].usedPercent, 0);
  assert.equal(restarted.snapshot().providers[0].cached, undefined);
});
test('reset boundary removes old normal bars and refresh failures retain labeled last good', (t) => {
  let now = Date.parse('2026-09-20T02:00:00Z');
  const filePath = fixture(t);
  const options = { filePath, now: () => now, bindingFor: () => 'identity-a' };
  const first = createLimitsDisplayCache(options);
  first.finish(first.begin('codex'), [row()]);
  const cache = createLimitsDisplayCache(options);
  cache.finish(cache.begin('codex'), [{ provider: 'codex', status: 'unavailable', windows: [] }]);
  assert.equal(cache.snapshot().providers[0].refreshFailed, true);
  assert.equal(cache.snapshot().providers[0].windows[0].usedPercent, 34);
  now = Date.parse('2026-09-20T05:00:00Z');
  assert.equal(cache.snapshot().providers[0].resetExpired, true);
  assert.deepEqual(cache.snapshot().providers[0].windows, []);
});
test('identity and credential changes invalidate cache; late and aborted probes cannot resurrect it', (t) => {
  let identity = 'a';
  const cache = createLimitsDisplayCache({ filePath: fixture(t), bindingFor: () => identity });
  cache.finish(cache.begin('codex'), [row()]);
  const old = cache.begin('codex');
  identity = 'b';
  assert.equal(cache.snapshot().providers.length, 0);
  cache.finish(old, [row()]);
  assert.equal(cache.snapshot().providers.length, 0);
  const clearing = cache.begin('codex');
  cache.clear('codex');
  cache.finish(clearing, [row()]);
  cache.finish(cache.begin('codex'), [row()], { aborted: true });
  assert.equal(cache.snapshot().providers.length, 0);
});
test('unauthorized clears persisted last-good values', (t) => {
  const cache = createLimitsDisplayCache({ filePath: fixture(t), bindingFor: () => 'a' });
  cache.finish(cache.begin('codex'), [row()]);
  cache.finish(cache.begin('codex'), [{ provider: 'codex', status: 'unauthorized', windows: [] }]);
  assert.equal(cache.snapshot().providers.some((r) => r.cached), false);
});
test('presentation starts loading and never returns cache or local paths as live probe output', async (t) => {
  const settings = { codexHomeOverride: '' };
  let account = 'a';
  const options = { filePath: fixture(t), getSettings: () => settings,
    getConfig: () => ({ limitsEnabled: true, limitProviders: 'codex' }),
    resolveSource: () => ({ status: 'OK', mode: 'auto', homePath: 'C:\\private', authPath: 'C:\\private\\auth.json', bindingKey: account, accountKey: account }),
    probe: async () => [row(36)] };
  const presentation = createLimitsPresentation(options);
  assert.equal(presentation.snapshot().providers[0].status, 'loading');
  const output = await presentation.probeProvider('codex', {}, {}, {});
  assert.doesNotMatch(JSON.stringify(output), /private|authPath|cached|bindingKey/);
  assert.equal(presentation.snapshot().source.authPath, 'C:\\private\\auth.json');
  const restarted = createLimitsPresentation(options);
  assert.equal(restarted.snapshot().providers[0].cached, true);
  account = 'b';
  assert.equal(restarted.snapshot().providers[0].status, 'loading');
});

test('full successful refresh removes accounts absent from the new result', (t) => {
  const cache = createLimitsDisplayCache({ filePath: fixture(t), bindingFor: () => 'configured-identity' });
  cache.finish(cache.begin('codex'), [row(34, 'a'), row(21, 'b')]);
  cache.finish(cache.begin('codex'), [row(36, 'b')]);
  assert.deepEqual(cache.snapshot().providers.map((r) => r.accountKey), ['b']);
});

test('Limits bootstrap paints without usage data and signals readiness', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  const start = source.indexOf('function renderLimitsBootstrap()');
  const end = source.indexOf('\nfunction displayLimitProviders()', start);
  const calls = [];
  const panel = () => ({ classList: { add: () => {}, remove: () => calls.push('visible') } });
  const context = { state: { stats: null, breakdown: 'limits', settings: {} },
    els: { shell: panel(), homePanel: panel(), breakdown: panel(), serviceStatusPanel: panel(), trendsPanel: panel(), limitsPanel: panel() },
    renderViewSwitcher: () => {}, renderLimits: () => calls.push('render'), signalContentReady: () => calls.push('ready') };
  vm.runInNewContext(`(${source.slice(start, end)})()`, context);
  assert.deepEqual(calls.slice(-2), ['render', 'ready']);
  const readyStart = source.indexOf('function signalContentReady()');
  const readyEnd = source.indexOf('\nfunction renderTrends()', readyStart);
  const readyContext = { state: context.state, contentReadySignaled: false,
    window: { tokenMonitor: { signalContentReady: () => calls.push('ipc-ready') } } };
  vm.runInNewContext(`(${source.slice(readyStart, readyEnd)})()`, readyContext);
  assert.equal(calls.at(-1), 'ipc-ready');
});
