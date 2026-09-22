'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeServerSnapshot } = require('../../src/server-agent/snapshot');
const { createAndroidClient } = require('../../src/shared/notification/androidClient');
const { validateUsagePage, listAllRemoteUsageSnapshots, aggregateRemoteUsage, dedupeAccountLimits } = require('../../src/shared/remoteUsage');
const ID = 'dev_11111111-1111-4111-8111-111111111111';
function item(id = ID, profile = 'codex', counters = {}) {
  const period = { totalTokens: 100, cacheReadTokens: 50, outputTokens: 20, capabilities: { tokenComponents: true }, models: { gpt: 100 }, ...counters };
  const snapshot = serializeServerSnapshot({ today: period, month: period, allTime: period, updatedAt: '2026-09-22T00:00:00.000Z' }, { profile: { id: profile, name: profile } }).snapshot;
  return { source: { desktopId: id, name: 'Server' }, profile: { ...snapshot.profile }, receivedAt: snapshot.updatedAt, snapshot };
}
test('all-pages reader excludes own source and rejects repeated/unbounded cursors', async () => {
  let page = 0; const other = item(ID.replace('11111111-', '22222222-'));
  const client = { desktopId: ID, listUsageSnapshots: async () => page++ ? { items: [other], nextCursor: null } : { items: [item()], nextCursor: 'next' } };
  assert.deepEqual(await listAllRemoteUsageSnapshots(client, { excludeSelf: true }), [other]);
  await assert.rejects(listAllRemoteUsageSnapshots({ listUsageSnapshots: async () => ({ items: [], nextCursor: 'same' }) }), /Repeated/);
  let count = 0;
  await assert.rejects(listAllRemoteUsageSnapshots({ listUsageSnapshots: async () => ({ items: [], nextCursor: 'c' + count++ }) }), /limit/);
  assert.equal(count, 64);
});
test('raw totals and model counters add; hit rate is ratio of sums; capabilities cannot improve', () => {
  const a = item(); const b = item(ID, 'codex-srj', { totalTokens: 1000, cacheReadTokens: 100, outputTokens: 100, models: { gpt: 1000 } });
  const total = aggregateRemoteUsage([a, b]).today;
  assert.equal(total.totalTokens, 1100); assert.equal(total.models.gpt, 1100);
  assert.equal(total.cacheReadTokens, 150); assert.equal(total.cacheHitRate, 150 / 980);
  assert.notEqual(total.cacheHitRate, (50 / 80 + 100 / 900) / 2);
  const c = item(ID.replace('11111111-', '22222222-'));
  assert.equal(aggregateRemoteUsage([a, c]).today.totalTokens, 200);
  assert.equal(aggregateRemoteUsage([a, c], { excludeSelf: true, desktopId: ID }).today.totalTokens, 100);
  assert.equal(aggregateRemoteUsage([a, a]).today.totalTokens, 100);
  b.snapshot.today.capabilities.tokenComponents = false;
  b.snapshot.today.capabilities.modelAttribution = false;
  assert.equal(aggregateRemoteUsage([a, b]).today.cacheHitRate, null);
  assert.equal(aggregateRemoteUsage([a, b]).today.capabilities.modelAttribution, false);
  a.snapshot.today.unclassifiedTokens = 1;
  assert.equal(aggregateRemoteUsage([a]).today.capabilities.tokenComponents, false);
});
test('quota dedupe selects latest trusted valid observation; missing account stays separate', () => {
  const base = { provider: 'codex', accountKey: 'acct1', window: '5h', observedAt: '2026-09-22T01:00:00Z', remainingPercent: 80, trusted: true, valid: true, source: ID };
  const latest = { ...base, source: 'other', observedAt: '2026-09-22T02:00:00Z', remainingPercent: 70 };
  assert.deepEqual(dedupeAccountLimits([base, latest, { ...latest, trusted: false, observedAt: '2026-09-22T03:00:00Z' }]), [latest]);
  assert.equal(dedupeAccountLimits([base, { ...base, window: 'weekly' }]).length, 2);
  assert.equal(dedupeAccountLimits([base, { ...base, accountKey: 'acct2' }]).length, 2);
  assert.equal(dedupeAccountLimits([{ ...base, accountKey: null }, { ...latest, accountKey: undefined }]).length, 2);
  assert.deepEqual(dedupeAccountLimits([{ ...base, remainingPercent: Infinity }, { ...base, remainingPercent: -1 }]), []);
});
test('client rejects hostile response snapshots and envelopes with safe errors', async () => {
  // Use the actual existing credential grammar instead of inventing an API identity.
  const { createDesktopCredential } = require('../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core/credential');
  const valid = createDesktopCredential(ID, Buffer.alloc(32)).credential;
  for (const mutate of [(p) => { p.items[0].snapshot.today.prompt = 'secret'; }, (p) => { p.ownerId = 'owner'; }, (p) => { p.items[0].profile.id = 'wrong'; }]) {
    const payload = { items: [item()], nextCursor: null }; mutate(payload);
    assert.throws(() => validateUsagePage(payload));
    const client = createAndroidClient({ baseUrl: 'https://example.test', credential: valid, fetch: async () => new Response(JSON.stringify(payload)) });
    await assert.rejects(client.listUsageSnapshots(), { code: 'invalid_response' });
  }
});

test('safe model names shadowing Object methods still sum numerically', () => {
  const value = item(ID, 'codex', { models: { toString: 100 }, clientModels: { codex: { toString: 100 } } });
  const result = aggregateRemoteUsage([value]).today;
  assert.equal(result.models.toString, 100);
  assert.equal(result.clientModels.codex.toString, 100);
});
