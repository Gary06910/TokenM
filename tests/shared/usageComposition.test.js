'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { composeUsageSources } = require('../../src/shared/usageComposition');
const { dedupeRemoteUsageItems } = require('../../src/shared/remoteUsage');

const LOCAL_DESKTOP_ID = 'dev_11111111-1111-4111-8111-111111111111';
const REMOTE_DESKTOP_ID = 'dev_22222222-2222-4222-8222-222222222222';

function period({ totalTokens, cacheReadTokens, cacheWriteTokens, outputTokens, modelAttribution = true }) {
  return {
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    unclassifiedTokens: 0,
    costUsd: totalTokens / 1000,
    clients: { codex: totalTokens },
    clientCosts: { codex: totalTokens / 1000 },
    clientCacheReads: { codex: cacheReadTokens },
    clientCacheWrites: { codex: cacheWriteTokens },
    clientOutputs: { codex: outputTokens },
    clientUnclassifiedTokens: {},
    models: { 'gpt-test': totalTokens },
    modelCosts: { 'gpt-test': totalTokens / 1000 },
    modelCacheReads: { 'gpt-test': cacheReadTokens },
    modelCacheWrites: { 'gpt-test': cacheWriteTokens },
    modelOutputs: { 'gpt-test': outputTokens },
    modelUnclassifiedTokens: {},
    clientModels: { codex: { 'gpt-test': totalTokens } },
    clientModelCosts: { codex: { 'gpt-test': totalTokens / 1000 } },
    capabilities: { tokenComponents: true, modelAttribution }
  };
}

function snapshot({ profileId, profileName = profileId, totalTokens, receivedAt, modelAttribution = true, history = [], cacheReadTokens = totalTokens / 2, cacheWriteTokens = totalTokens / 4, outputTokens = totalTokens / 4 }) {
  const itemPeriod = period({
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    modelAttribution
  });
  return {
    source: { desktopId: REMOTE_DESKTOP_ID, name: 'A800 Server' },
    profile: { id: profileId, name: profileName },
    receivedAt,
    snapshot: {
      schemaVersion: 1,
      deviceName: 'A800 Server',
      profile: { id: profileId, name: profileName },
      platform: 'linux-a800',
      agentVersion: '1.0.0',
      updatedAt: receivedAt,
      periodWindows: {},
      today: itemPeriod,
      month: itemPeriod,
      allTime: itemPeriod,
      history: { daily: history.map((date) => ({ date, ...Object.fromEntries([
        ['totalTokens', totalTokens],
        ['cacheReadTokens', totalTokens / 2],
        ['cacheWriteTokens', totalTokens / 4],
        ['outputTokens', totalTokens / 4],
        ['unclassifiedTokens', 0],
        ['costUsd', totalTokens / 1000]
      ]) })) },
      capabilities: { tokenComponents: true, modelAttribution, history: history.length > 0 }
    }
  };
}

function localStats() {
  const localPeriod = period({ totalTokens: 100, cacheReadTokens: 30, cacheWriteTokens: 50, outputTokens: 20 });
  return {
    updatedAt: '2026-09-23T12:00:00.000Z',
    periods: { today: localPeriod, month: localPeriod, allTime: localPeriod },
    devices: [{
      deviceId: 'local-device-id',
      hostname: 'LOCAL-WINDOWS',
      platform: 'win32',
      updatedAt: '2026-09-23T12:00:00.000Z',
      receivedAt: '2026-09-23T12:00:00.000Z',
      periods: { today: localPeriod, month: localPeriod, allTime: localPeriod },
      stale: false
    }]
  };
}

test('composes local and two remote profiles without turning profiles into computers', () => {
  const items = [
    snapshot({ profileId: 'codex', totalTokens: 200, receivedAt: '2026-09-23T12:05:00.000Z', history: ['2026-09-22'] }),
    snapshot({ profileId: 'codex-srj', totalTokens: 300, receivedAt: '2026-09-23T12:04:00.000Z', history: ['2026-09-21'] }),
    snapshot({ profileId: 'codex', totalTokens: 1000, receivedAt: '2026-09-23T12:03:00.000Z' }),
    { ...snapshot({ profileId: 'codex', totalTokens: 400, receivedAt: '2026-09-23T12:02:00.000Z' }), source: { desktopId: LOCAL_DESKTOP_ID, name: 'This desktop' } }
  ];
  assert.doesNotThrow(() => dedupeRemoteUsageItems(items, { excludeSelf: true, desktopId: LOCAL_DESKTOP_ID }));
  const result = composeUsageSources({
    stats: localStats(),
    remoteItems: items,
    remoteState: { configured: true, localDesktopId: LOCAL_DESKTOP_ID, status: 'ready', lastSuccessAt: '2026-09-23T12:05:00.000Z' },
    localDeviceId: 'local-device-id',
    nowMs: Date.parse('2026-09-23T12:06:00.000Z')
  });

  assert.equal(result.periods.today.totalTokens, 600);
  assert.equal(result.periods.today.costUsd, 0.6);
  assert.equal(result.periods.today.cacheHitRate, 280 / 455);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].kind, 'local');
  assert.equal(result.sources[0].name, 'LOCAL-WINDOWS');
  assert.equal(result.sources[1].kind, 'remote');
  assert.equal(result.sources[1].name, 'A800 Server');
  assert.deepEqual(result.sources[1].profiles.map((profile) => profile.id), ['codex', 'codex-srj']);
  assert.equal(result.sources[1].profiles[0].periods.today.totalTokens, 200);
  assert.equal(result.sources[1].profiles[1].periods.today.totalTokens, 300);
  assert.equal(result.remoteUsage.historyCoverage.days, 2);
});

test('remote capability downgrade makes aggregate attribution and hit rate unknown', () => {
  const item = snapshot({ profileId: 'codex', totalTokens: 200, receivedAt: '2026-09-23T12:05:00.000Z', modelAttribution: false });
  const result = composeUsageSources({
    stats: localStats(),
    remoteItems: [item],
    remoteState: { configured: true, localDesktopId: LOCAL_DESKTOP_ID, status: 'ready' },
    nowMs: Date.parse('2026-09-23T12:06:00.000Z')
  });
  assert.equal(result.periods.today.capabilities.modelAttribution, false);
  assert.equal(result.periods.today.cacheHitRate, 130 / 230);
});

test('cache hit rate is ratio of summed raw counters, never an average of percentages', () => {
  const item = snapshot({
    profileId: 'codex',
    totalTokens: 200,
    cacheReadTokens: 100,
    cacheWriteTokens: 80,
    outputTokens: 20,
    receivedAt: '2026-09-23T12:05:00.000Z'
  });
  const result = composeUsageSources({
    stats: localStats(),
    remoteItems: [item],
    remoteState: { configured: true, localDesktopId: LOCAL_DESKTOP_ID, status: 'ready' },
    nowMs: Date.parse('2026-09-23T12:06:00.000Z')
  });
  assert.equal(result.periods.today.totalTokens, 300);
  assert.equal(result.periods.today.cacheHitRate, 130 / (300 - 40));
});

test('future receivedAt is clamped to fresh age zero and no remote data preserves local totals', () => {
  const future = snapshot({ profileId: 'codex', totalTokens: 200, receivedAt: '2026-09-23T13:00:00.000Z' });
  const result = composeUsageSources({
    stats: localStats(),
    remoteItems: [future],
    remoteState: { configured: true, localDesktopId: LOCAL_DESKTOP_ID, status: 'ready' },
    nowMs: Date.parse('2026-09-23T12:00:00.000Z')
  });
  assert.equal(result.sources[1].freshness.ageMs, 0);
  assert.equal(result.sources[1].freshness.state, 'fresh');

  const localOnly = composeUsageSources({ stats: localStats(), remoteItems: [], remoteState: { status: 'unconfigured' } });
  assert.equal(localOnly.periods.today.totalTokens, 100);
  assert.equal(localOnly.sources[0].name, 'LOCAL-WINDOWS');
  assert.equal(localOnly.remoteUsage.hasCachedData, false);

  const configuredEmpty = composeUsageSources({
    stats: localStats(),
    remoteItems: [],
    remoteState: { configured: true, localDesktopId: LOCAL_DESKTOP_ID, status: 'unavailable' }
  });
  assert.equal(configuredEmpty.sources[1].name, 'A800 Server');
  assert.equal(configuredEmpty.sources[1].periods.today.totalTokens, 0);
  assert.equal(configuredEmpty.sources[1].stale, true);
});
