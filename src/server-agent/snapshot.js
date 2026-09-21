'use strict';

const { normalizeProfileId } = require('./config');

const SERVER_SNAPSHOT_SCHEMA_VERSION = 1;
const SERVER_SNAPSHOT_BUDGET_BYTES = 12 * 1024;
const MAX_HISTORY_DAYS = 30;
const PROFILE_CLIENT = 'codex';
const PERIOD_NAMES = Object.freeze(['today', 'month', 'allTime']);

// This is intentionally used by the recursive test/audit guard as well as by
// the projection. The projection is allowlist-based, so an input field can
// only survive if it is explicitly copied below.
const FORBIDDEN_KEYS = new Set([
  'prompt', 'reply', 'response', 'summary', 'lastassistantmessage',
  'cwd', 'absolutecwd', 'absolutepath', 'project', 'projectpath',
  'sessions', 'nativesessions', 'nativeprojects', 'transcript',
  'auth', 'auth.json', 'accesstoken', 'refreshtoken', 'credential',
  'authorization', 'cookie', 'sshkey', 'terminal', 'source', 'sourcepath',
  'title'
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function finiteNumber(value, fallback = 0) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInt(value) {
  return Math.max(0, Math.round(finiteNumber(value)));
}

function nonNegativeMoney(value) {
  return Math.max(0, finiteNumber(value));
}

function safeText(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > maxLength || /[\r\n\p{Cc}\p{Cf}]/u.test(normalized)) return fallback;
  return normalized;
}

function safeMapKey(value, maxLength = 160) {
  const key = safeText(value, maxLength);
  if (!key || FORBIDDEN_KEYS.has(key.toLowerCase()) || key === '__proto__' || key === 'constructor' || key === 'prototype') {
    return '';
  }
  return key;
}

function numericMap(value, mapper = nonNegativeInt) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = safeMapKey(rawKey);
    if (!key) continue;
    result[key] = mapper(rawValue);
  }
  return result;
}

function nestedNumericMap(value, mapper = nonNegativeInt, allowedOuter = null) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [rawOuter, rawInner] of Object.entries(value)) {
    const outer = safeMapKey(rawOuter);
    if (!outer || (allowedOuter && !allowedOuter.has(outer))) continue;
    if (!rawInner || typeof rawInner !== 'object' || Array.isArray(rawInner)) continue;
    const inner = numericMap(rawInner, mapper);
    if (Object.keys(inner).length > 0) result[outer] = inner;
  }
  return result;
}

function firstNumber(value, ...keys) {
  for (const key of keys) {
    if (hasOwn(value, key)) return finiteNumber(value[key]);
  }
  return 0;
}

function mapTokenSum(value) {
  return Object.values(value || {}).reduce((sum, entry) => sum + nonNegativeInt(entry), 0);
}

function componentValue(source, camel, snake) {
  return nonNegativeInt(firstNumber(source, camel, snake));
}

function projectPeriod(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const totalTokens = componentValue(source, 'totalTokens', 'total_tokens');
  const costUsd = nonNegativeMoney(firstNumber(source, 'costUsd', 'cost_usd', 'cost'));
  const cacheReadTokens = componentValue(source, 'cacheReadTokens', 'cache_read_tokens');
  const cacheWriteTokens = componentValue(source, 'cacheWriteTokens', 'cache_write_tokens');
  const outputTokens = componentValue(source, 'outputTokens', 'output_tokens');
  const knownComponentTokens = Math.min(totalTokens, cacheReadTokens + cacheWriteTokens + outputTokens);
  const declaredCapability = source.capabilities?.tokenComponents;
  const unclassifiedTokens = Math.min(
    totalTokens - knownComponentTokens,
    hasOwn(source, 'unclassifiedTokens') || hasOwn(source, 'unclassified_tokens')
      ? nonNegativeInt(firstNumber(source, 'unclassifiedTokens', 'unclassified_tokens'))
      : declaredCapability === true ? 0 : totalTokens - knownComponentTokens
  );
  const tokenComponents = totalTokens === 0
    ? declaredCapability !== false
    : declaredCapability === true && unclassifiedTokens === 0;

  const clients = numericMap(source.clients);
  const clientCosts = numericMap(source.clientCosts, nonNegativeMoney);
  const clientCacheReads = numericMap(source.clientCacheReads);
  const clientCacheWrites = numericMap(source.clientCacheWrites);
  const clientOutputs = numericMap(source.clientOutputs);
  const clientUnclassifiedTokens = numericMap(source.clientUnclassifiedTokens);
  const onlyCodex = (value) => Object.prototype.hasOwnProperty.call(value, PROFILE_CLIENT)
    ? { [PROFILE_CLIENT]: value[PROFILE_CLIENT] }
    : {};

  const models = numericMap(source.models);
  const modelCosts = numericMap(source.modelCosts, nonNegativeMoney);
  const modelCacheReads = numericMap(source.modelCacheReads);
  const modelCacheWrites = numericMap(source.modelCacheWrites);
  const modelOutputs = numericMap(source.modelOutputs);
  const modelUnclassifiedTokens = numericMap(source.modelUnclassifiedTokens);
  const clientModels = nestedNumericMap(source.clientModels, nonNegativeInt, new Set([PROFILE_CLIENT]));
  const clientModelCosts = nestedNumericMap(source.clientModelCosts, nonNegativeMoney, new Set([PROFILE_CLIENT]));
  const modelAttributionDeclared = source.capabilities?.modelAttribution;
  const modelAttributionInferred = totalTokens === 0
    || (Object.keys(models).length > 0
      && mapTokenSum(models) === totalTokens
      && (!clientModels[PROFILE_CLIENT] || mapTokenSum(clientModels[PROFILE_CLIENT]) === totalTokens));
  const modelAttribution = modelAttributionDeclared === false
    ? false
    : modelAttributionDeclared === true || modelAttributionInferred;

  return {
    capabilities: { tokenComponents, modelAttribution },
    totalTokens,
    costUsd,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    unclassifiedTokens,
    clients: onlyCodex(clients),
    clientCosts: onlyCodex(clientCosts),
    clientCacheReads: onlyCodex(clientCacheReads),
    clientCacheWrites: onlyCodex(clientCacheWrites),
    clientOutputs: onlyCodex(clientOutputs),
    clientUnclassifiedTokens: onlyCodex(clientUnclassifiedTokens),
    models,
    modelCosts,
    modelCacheReads,
    modelCacheWrites,
    modelOutputs,
    modelUnclassifiedTokens,
    clientModels,
    clientModelCosts
  };
}

function projectPeriodWindows(value) {
  const result = {};
  for (const periodName of PERIOD_NAMES) {
    const source = value?.[periodName];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const period = {};
    for (const key of ['key', 'startsAt', 'endsAt']) {
      if (source[key] === null && key === 'endsAt') period[key] = null;
      else {
        const text = safeText(source[key], 128);
        if (text) period[key] = text;
      }
    }
    if (Object.keys(period).length > 0) result[periodName] = period;
  }
  return result;
}

function projectHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { daily: [] };
  const rows = Array.isArray(value.daily) ? value.daily : [];
  const daily = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const date = safeText(row.date, 32);
    if (!date) return null;
    const totalTokens = nonNegativeInt(row.totalTokens ?? row.tokens);
    const costUsd = nonNegativeMoney(row.costUsd ?? row.cost);
    const cacheReadTokens = nonNegativeInt(row.cacheReadTokens ?? row.cache_read_tokens);
    const cacheWriteTokens = nonNegativeInt(row.cacheWriteTokens ?? row.cache_write_tokens);
    const outputTokens = nonNegativeInt(row.outputTokens ?? row.output_tokens);
    const known = Math.min(totalTokens, cacheReadTokens + cacheWriteTokens + outputTokens);
    const unclassifiedTokens = Math.min(
      totalTokens - known,
      hasOwn(row, 'unclassifiedTokens') || hasOwn(row, 'unclassified_tokens')
        ? nonNegativeInt(row.unclassifiedTokens ?? row.unclassified_tokens)
        : row.tokenComponentsAvailable === true ? 0 : totalTokens - known
    );
    return {
      date,
      totalTokens,
      costUsd,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      unclassifiedTokens
    };
  }).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date));
  return { daily: daily.slice(-MAX_HISTORY_DAYS) };
}

function projectServerSnapshot(summary, options = {}) {
  const profile = options.profile || {};
  const profileId = normalizeProfileId(profile.id);
  const profileName = safeText(profile.name, 80, profileId);
  const periods = Object.fromEntries(PERIOD_NAMES.map((name) => [name, projectPeriod(summary?.[name])]))
    ;
  const history = projectHistory(summary?.history);
  const historyAvailable = summary?.historyAvailable !== false && summary?.history !== null;
  const platform = safeText(
    options.platform || summary?.platform || `${process.platform}-${process.arch}`,
    64,
    'unknown'
  );
  const agentVersion = safeText(options.agentVersion || summary?.agentVersion, 128, 'unknown');
  const updatedAt = safeText(summary?.updatedAt, 128, new Date().toISOString());
  const tokenComponents = PERIOD_NAMES.every((name) => periods[name].capabilities.tokenComponents);
  const modelAttribution = PERIOD_NAMES.every((name) => periods[name].capabilities.modelAttribution);

  return {
    schemaVersion: SERVER_SNAPSHOT_SCHEMA_VERSION,
    ...(options.deviceName || summary?.deviceName
      ? { deviceName: safeText(options.deviceName || summary.deviceName, 80) }
      : {}),
    profile: { id: profileId, name: profileName },
    platform,
    agentVersion,
    updatedAt,
    periodWindows: projectPeriodWindows(summary?.periodWindows),
    ...periods,
    history,
    capabilities: {
      tokenComponents,
      modelAttribution,
      history: historyAvailable
    }
  };
}

function removeModel(snapshot, model) {
  let removed = false;
  for (const periodName of PERIOD_NAMES) {
    const period = snapshot[periodName];
    for (const field of [
      'models', 'modelCosts', 'modelCacheReads', 'modelCacheWrites', 'modelOutputs', 'modelUnclassifiedTokens'
    ]) {
      if (hasOwn(period[field], model)) {
        delete period[field][model];
        removed = true;
      }
    }
    const clientModels = period.clientModels?.codex;
    const clientModelCosts = period.clientModelCosts?.codex;
    if (clientModels && hasOwn(clientModels, model)) {
      delete clientModels[model];
      removed = true;
    }
    if (clientModelCosts && hasOwn(clientModelCosts, model)) delete clientModelCosts[model];
    period.capabilities.modelAttribution = false;
  }
  snapshot.capabilities.modelAttribution = false;
  return removed;
}

function leastValuableModel(snapshot) {
  const entries = [];
  for (const periodName of PERIOD_NAMES) {
    for (const [model, tokens] of Object.entries(snapshot[periodName].models || {})) {
      entries.push({ model, tokens: nonNegativeInt(tokens), periodName });
    }
  }
  entries.sort((left, right) => left.tokens - right.tokens || left.model.localeCompare(right.model));
  return entries[0]?.model || '';
}

function snapshotJson(snapshot) {
  return JSON.stringify(snapshot);
}

function snapshotBytes(snapshot) {
  return Buffer.byteLength(snapshotJson(snapshot), 'utf8');
}

class SnapshotBudgetError extends Error {
  constructor(bytes, budget = SERVER_SNAPSHOT_BUDGET_BYTES) {
    super(`server snapshot exceeds ${budget} bytes after safe trimming`);
    this.name = 'SnapshotBudgetError';
    this.code = 'snapshot-budget-exceeded';
    this.bytes = bytes;
    this.budget = budget;
  }
}

function serializeServerSnapshot(summary, options = {}) {
  const budget = options.budgetBytes || SERVER_SNAPSHOT_BUDGET_BYTES;
  const snapshot = projectServerSnapshot(summary, options);
  let bytes = snapshotBytes(snapshot);
  let historyTrimmed = false;
  let modelAttributionTrimmed = false;

  // Oldest history rows are the first disposable data. Global period counters
  // are never touched by this loop.
  while (bytes > budget && snapshot.history.daily.length > 0) {
    snapshot.history.daily.shift();
    historyTrimmed = true;
    bytes = snapshotBytes(snapshot);
  }

  // Keep the model entries with the most tokens by removing the least valuable
  // one until the bounded payload fits. The raw global/client component
  // counters remain intact, and the capability explicitly records the loss.
  while (bytes > budget) {
    const model = leastValuableModel(snapshot);
    if (!model || !removeModel(snapshot, model)) break;
    modelAttributionTrimmed = true;
    bytes = snapshotBytes(snapshot);
  }

  if (bytes > budget) throw new SnapshotBudgetError(bytes, budget);
  return {
    snapshot,
    json: snapshotJson(snapshot),
    bytes,
    trimmed: {
      history: historyTrimmed,
      modelAttribution: modelAttributionTrimmed
    }
  };
}

function assertNoForbiddenKeys(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`forbidden server snapshot field at ${path}.${key}`);
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function validateServerSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('server snapshot must be an object');
  }
  if (snapshot.schemaVersion !== SERVER_SNAPSHOT_SCHEMA_VERSION) {
    throw new TypeError('unsupported server snapshot schema');
  }
  assertNoForbiddenKeys(snapshot);
  const bytes = snapshotBytes(snapshot);
  const budget = options.budgetBytes || SERVER_SNAPSHOT_BUDGET_BYTES;
  if (bytes > budget) throw new SnapshotBudgetError(bytes, budget);
  return { bytes };
}

module.exports = {
  FORBIDDEN_KEYS,
  MAX_HISTORY_DAYS,
  PROFILE_CLIENT,
  SERVER_SNAPSHOT_BUDGET_BYTES,
  SERVER_SNAPSHOT_SCHEMA_VERSION,
  SnapshotBudgetError,
  assertNoForbiddenKeys,
  projectServerSnapshot,
  serializeServerSnapshot,
  snapshotBytes,
  validateServerSnapshot
};
