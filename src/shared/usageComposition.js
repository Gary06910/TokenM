'use strict';

const { PERIODS, mergePeriods } = require('./usage');
const { aggregateRemoteUsage, dedupeRemoteUsageItems } = require('./remoteUsage');

const REMOTE_FRESH_MS = 15 * 60 * 1000;
const REMOTE_HISTORY_MAX_DAYS = 30;
const SAFE_STATUS = new Set(['ready', 'stale', 'unavailable', 'unconfigured', 'unauthenticated']);

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeName(value, fallback = '') {
  const normalized = String(value || fallback)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  return normalized.slice(0, 160);
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function freshnessFor(value, nowMs, staleAfterMs = REMOTE_FRESH_MS) {
  const receivedAtMs = timestampMs(value);
  const ageMs = receivedAtMs > 0 ? Math.max(0, nowMs - receivedAtMs) : null;
  return {
    state: ageMs !== null && ageMs <= staleAfterMs ? 'fresh' : 'stale',
    ageMs,
    receivedAt: receivedAtMs > 0 ? new Date(receivedAtMs).toISOString() : null
  };
}

function cacheHitRate(period) {
  const denominator = finiteNumber(period?.totalTokens) - finiteNumber(period?.outputTokens);
  return period?.capabilities?.tokenComponents === true
    && finiteNumber(period?.unclassifiedTokens) === 0
    && denominator > 0
    ? finiteNumber(period.cacheReadTokens) / denominator
    : null;
}

function finalizePeriod(period, modelAttribution = true) {
  const result = { ...period, capabilities: { ...(period?.capabilities || {}) } };
  result.capabilities.modelAttribution = modelAttribution === true;
  result.cacheHitRate = cacheHitRate(result);
  return result;
}

function sourceNameForDevice(device, fallback) {
  return safeName(device?.displayName || device?.hostname || fallback || 'Local', 'Local') || 'Local';
}

function localSources(stats, { localDeviceId = '', localSourceName = '', nowMs }) {
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  if (devices.length > 0) {
    return devices.map((device, index) => {
      const receivedAt = device?.receivedAt || device?.updatedAt || null;
      const freshness = freshnessFor(receivedAt, nowMs, Number.POSITIVE_INFINITY);
      return {
        id: `local-${index}`,
        kind: 'local',
        name: sourceNameForDevice(device, localSourceName),
        platform: safeName(device?.platform),
        isLocal: Boolean(localDeviceId && device?.deviceId === localDeviceId),
        stale: device?.stale === true,
        receivedAt,
        updatedAt: device?.updatedAt || null,
        freshness: { ...freshness, state: device?.stale === true ? 'stale' : 'fresh' },
        periods: device?.periods || {},
        profiles: []
      };
    });
  }

  return [{
    id: 'local-0',
    kind: 'local',
    name: safeName(localSourceName, 'Local') || 'Local',
    platform: 'win32',
    isLocal: true,
    stale: false,
    receivedAt: stats?.updatedAt || null,
    updatedAt: stats?.updatedAt || null,
    freshness: freshnessFor(stats?.updatedAt, nowMs, Number.POSITIVE_INFINITY),
    periods: stats?.periods || {},
    profiles: []
  }];
}

function remoteHistoryCoverage(items) {
  const dates = [];
  for (const item of items) {
    for (const row of item?.snapshot?.history?.daily || []) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || ''))) dates.push(row.date);
    }
  }
  const unique = [...new Set(dates)].sort();
  return {
    available: unique.length > 0,
    days: unique.length,
    maxDays: REMOTE_HISTORY_MAX_DAYS,
    partial: unique.length > 0,
    oldestDate: unique[0] || null,
    newestDate: unique.at(-1) || null
  };
}

function remoteSources(items, nowMs) {
  const groups = new Map();
  for (const item of items) {
    const key = item.source.desktopId;
    if (!groups.has(key)) groups.set(key, { source: item.source, items: [] });
    groups.get(key).items.push(item);
  }

  return [...groups.values()]
    .sort((a, b) => String(a.source.name).localeCompare(String(b.source.name)) || a.source.desktopId.localeCompare(b.source.desktopId))
    .map(({ source, items: sourceItems }, sourceIndex) => {
      const profiles = sourceItems
        .map((item) => {
          const freshness = freshnessFor(item.receivedAt, nowMs);
          const periods = Object.fromEntries(PERIODS.map((periodName) => [
            periodName,
            finalizePeriod(mergePeriods(item.snapshot?.[periodName]), item.snapshot?.capabilities?.modelAttribution !== false && item.snapshot?.[periodName]?.capabilities?.modelAttribution !== false)
          ]));
          return {
            id: item.profile.id,
            name: safeName(item.profile.name, item.profile.id) || item.profile.id,
            client: 'codex',
            platform: safeName(item.snapshot?.platform),
            agentVersion: safeName(item.snapshot?.agentVersion),
            receivedAt: item.receivedAt,
            freshness,
            stale: freshness.state === 'stale',
            periods,
            history: { daily: Array.isArray(item.snapshot?.history?.daily) ? item.snapshot.history.daily.slice(0, REMOTE_HISTORY_MAX_DAYS) : [] }
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      const periods = Object.fromEntries(PERIODS.map((periodName) => [
        periodName,
        finalizePeriod(
          mergePeriods(...profiles.map((profile) => profile.periods[periodName])),
          profiles.every((profile) => profile.periods[periodName]?.capabilities?.modelAttribution !== false)
        )
      ]));
      const latestReceivedAt = profiles
        .map((profile) => profile.receivedAt)
        .sort((a, b) => timestampMs(b) - timestampMs(a))[0] || null;
      const freshness = freshnessFor(latestReceivedAt, nowMs);
      return {
        id: `remote-${sourceIndex}`,
        kind: 'remote',
        name: safeName(source.name, 'A800 Server') || 'A800 Server',
        platform: safeName(profiles[0]?.platform || 'linux'),
        isLocal: false,
        stale: freshness.state === 'stale',
        receivedAt: latestReceivedAt,
        updatedAt: latestReceivedAt,
        freshness,
        periods,
        profiles,
        historyCoverage: remoteHistoryCoverage(sourceItems)
      };
    });
}

function safeRemoteStatus(remoteState, hasItems) {
  const raw = String(remoteState?.status || (hasItems ? 'ready' : 'unavailable'));
  return SAFE_STATUS.has(raw) ? raw : (hasItems ? 'ready' : 'unavailable');
}

function composeUsageSources({
  stats = {},
  remoteItems = [],
  remoteState = {},
  localDeviceId = '',
  localSourceName = '',
  nowMs = Date.now(),
  remoteFreshAfterMs = REMOTE_FRESH_MS
} = {}) {
  let selected = [];
  let remoteInvalid = false;
  try {
    selected = dedupeRemoteUsageItems(remoteItems, {
      excludeSelf: true,
      desktopId: remoteState?.localDesktopId
    });
  } catch (_) {
    remoteInvalid = true;
  }

  // Keep the existing remote aggregation as the single counter/map authority;
  // source/profile rows below only add physical hierarchy and freshness.
  const aggregatedRemote = selected.length > 0 ? aggregateRemoteUsage(selected) : null;
  const periods = Object.fromEntries(PERIODS.map((periodName) => {
    const basePeriod = stats?.periods?.[periodName];
    const combined = selected.length > 0
      ? mergePeriods(basePeriod, aggregatedRemote?.[periodName])
      : mergePeriods(basePeriod);
    const localModelAttribution = basePeriod?.capabilities?.modelAttribution !== false;
    const remoteModelAttribution = selected.length === 0
      ? true
      : aggregatedRemote?.[periodName]?.capabilities?.modelAttribution !== false;
    return [periodName, finalizePeriod(combined, localModelAttribution && remoteModelAttribution)];
  }));

  const local = localSources(stats, { localDeviceId, localSourceName, nowMs });
  const remote = remoteSources(selected, nowMs).map((source) => ({
    ...source,
    freshness: {
      ...source.freshness,
      state: source.freshness.ageMs !== null && source.freshness.ageMs <= remoteFreshAfterMs ? 'fresh' : 'stale'
    },
    stale: source.freshness.ageMs === null || source.freshness.ageMs > remoteFreshAfterMs
  }));
  if (remote.length === 0 && remoteState?.configured === true) {
    remote.push({
      id: 'remote-0',
      kind: 'remote',
      name: 'A800 Server',
      platform: 'linux',
      isLocal: false,
      stale: true,
      receivedAt: null,
      updatedAt: null,
      freshness: { state: 'stale', ageMs: null, receivedAt: null },
      periods: Object.fromEntries(PERIODS.map((periodName) => [periodName, finalizePeriod(mergePeriods(), true)])),
      profiles: [],
      historyCoverage: remoteHistoryCoverage([])
    });
  }
  const sources = [...local, ...remote];
  const historyCoverage = remoteHistoryCoverage(selected);
  const status = safeRemoteStatus(remoteState, selected.length > 0);
  const remoteUsage = {
    status: remoteInvalid ? 'unavailable' : status,
    configured: remoteState?.configured === true,
    sourceCount: remote.length,
    profileCount: remote.reduce((count, source) => count + source.profiles.length, 0),
    hasCachedData: selected.length > 0,
    lastSuccessAt: timestampMs(remoteState?.lastSuccessAt) > 0 ? new Date(remoteState.lastSuccessAt).toISOString() : null,
    lastAttemptAt: timestampMs(remoteState?.lastAttemptAt) > 0 ? new Date(remoteState.lastAttemptAt).toISOString() : null,
    errorCode: /^[A-Za-z0-9_.-]{1,80}$/.test(String(remoteState?.errorCode || '')) ? String(remoteState.errorCode) : null,
    historyCoverage
  };

  return {
    ...stats,
    updatedAt: stats?.updatedAt || new Date(nowMs).toISOString(),
    periods,
    sources,
    remoteUsage
  };
}

module.exports = {
  REMOTE_FRESH_MS,
  REMOTE_HISTORY_MAX_DAYS,
  cacheHitRate,
  composeUsageSources,
  freshnessFor,
  safeName
};
