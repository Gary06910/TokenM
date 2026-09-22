'use strict';

const { validateUsageSnapshot, timestamp, object, text, PROFILE_ID_RE, COUNTERS, MAPS, PERIODS } = require('./usageSnapshot');
const MAX_PAGE_GUARD = 64;
function requestId(value) { if (value !== undefined && (typeof value !== 'string' || !/^req_[a-zA-Z0-9_-]{1,80}$/.test(value))) throw Error('Invalid usage response'); }
function validateStoredUsage(value) {
  object(value, ['status', 'profileId', 'receivedAt', 'requestId'], ['status', 'profileId', 'receivedAt']);
  if (value.status !== 'stored' || typeof value.profileId !== 'string' || !PROFILE_ID_RE.test(value.profileId)) throw Error('Invalid usage response');
  timestamp(value.receivedAt);
  requestId(value.requestId);
  return value;
}
function validateUsagePage(value) {
  object(value, ['items', 'nextCursor', 'requestId'], ['items', 'nextCursor']);
  requestId(value.requestId);
  if (!Array.isArray(value.items) || value.items.length > 4
    || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.nextCursor)))) throw Error('Invalid usage page');
  for (const item of value.items) {
    object(item, ['source', 'profile', 'receivedAt', 'snapshot']);
    object(item.source, ['desktopId', 'name']);
    if (typeof item.source.desktopId !== 'string' || !/^dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.source.desktopId)) throw Error('Invalid source');
    text(item.source.name, 160);
    object(item.profile, ['id', 'name']);
    validateUsageSnapshot(item.snapshot);
    if (item.profile.id !== item.snapshot.profile.id || item.profile.name !== item.snapshot.profile.name) throw Error('Invalid profile');
    timestamp(item.receivedAt);
  }
  return value;
}
async function listAllRemoteUsageSnapshots(client, { excludeSelf = false, desktopId = client.desktopId } = {}) {
  const items = [];
  const cursors = new Set();
  let cursor;
  for (let pageIndex = 0; pageIndex < MAX_PAGE_GUARD; pageIndex++) {
    const page = validateUsagePage(await client.listUsageSnapshots({ limit: 4, ...(cursor ? { cursor } : {}) }));
    items.push(...page.items.filter((item) => !excludeSelf || item.source.desktopId !== desktopId));
    if (page.nextCursor === null) return items;
    if (cursors.has(page.nextCursor)) throw Error('Repeated usage cursor');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw Error('Usage pagination limit exceeded');
}
function aggregateRemoteUsage(items, { excludeSelf = false, desktopId } = {}) {
  const selected = new Map();
  for (const item of items) {
    validateUsagePage({ items: [item], nextCursor: null });
    if (excludeSelf && item.source.desktopId === desktopId) continue;
    const identity = JSON.stringify([item.source.desktopId, item.profile.id]);
    const previous = selected.get(identity);
    if (!previous || Date.parse(item.receivedAt) > Date.parse(previous.receivedAt)) selected.set(identity, item);
  }
  const result = {};
  for (const periodName of PERIODS) {
    const total = { ...Object.fromEntries([...COUNTERS, 'costUsd'].map((key) => [key, 0])),
      ...Object.fromEntries([...MAPS, 'clientModels', 'clientModelCosts'].map((key) => [key, {}])),
      capabilities: { tokenComponents: true, modelAttribution: true } };
    for (const { snapshot } of selected.values()) {
      const period = snapshot[periodName];
      for (const key of [...COUNTERS, 'costUsd']) total[key] += period[key];
      for (const key of MAPS) for (const [name, count] of Object.entries(period[key])) total[key][name] = (Object.hasOwn(total[key], name) ? total[key][name] : 0) + count;
      for (const key of ['clientModels', 'clientModelCosts']) {
        for (const [client, models] of Object.entries(period[key])) {
          total[key][client] ||= {};
          for (const [model, count] of Object.entries(models)) total[key][client][model] = (Object.hasOwn(total[key][client], model) ? total[key][client][model] : 0) + count;
        }
      }
      total.capabilities.tokenComponents &&= snapshot.capabilities.tokenComponents && period.capabilities.tokenComponents && period.unclassifiedTokens === 0;
      total.capabilities.modelAttribution &&= snapshot.capabilities.modelAttribution && period.capabilities.modelAttribution;
    }
    const denominator = total.totalTokens - total.outputTokens;
    total.cacheHitRate = total.capabilities.tokenComponents && denominator > 0 ? total.cacheReadTokens / denominator : null;
    result[periodName] = total;
  }
  return result;
}
// Future composition only: quota observations never enter the schema-1 wire.
function dedupeAccountLimits(observations) {
  const winners = new Map();
  const unknown = [];
  for (const entry of observations) {
    if (!entry || entry.trusted !== true || entry.valid !== true || !Number.isFinite(Date.parse(entry.observedAt))) continue;
    if (typeof entry.provider !== 'string' || !entry.provider || typeof entry.window !== 'string' || !entry.window) continue;
    const values = ['remaining', 'used', 'remainingPercent', 'usedPercent', 'quota'].filter((key) => entry[key] !== undefined);
    if (!values.length || values.some((key) => typeof entry[key] !== 'number' || !Number.isFinite(entry[key]) || entry[key] < 0 || (key.endsWith('Percent') && entry[key] > 100))) continue;
    const copy = structuredClone(entry);
    if (typeof entry.accountKey !== 'string' || !entry.accountKey.trim()) { unknown.push(copy); continue; }
    const key = JSON.stringify([entry.provider, entry.accountKey, entry.window]);
    if (!winners.has(key) || Date.parse(entry.observedAt) > Date.parse(winners.get(key).observedAt)) winners.set(key, copy);
  }
  return [...winners.values(), ...unknown];
}
module.exports = { MAX_PAGE_GUARD, validateStoredUsage, validateUsagePage, listAllRemoteUsageSnapshots, aggregateRemoteUsage, dedupeAccountLimits };
