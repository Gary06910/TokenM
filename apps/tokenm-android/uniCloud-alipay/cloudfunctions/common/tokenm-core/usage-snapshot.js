'use strict';

// Portable schema-1 boundary. The cloud copy is checked byte-for-byte in tests.
const MAX_BYTES = 12288;
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const FORBIDDEN = new Set(('prompt reply response summary lastassistantmessage cwd absolutecwd absolutepath project projectpath sessions nativesessions nativeprojects transcript auth auth.json accesstoken refreshtoken credential authorization cookie sshkey terminal source sourcepath title __proto__ constructor prototype').split(' '));
const COUNTERS = ['totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'unclassifiedTokens'];
const MAPS = ['clients', 'clientCosts', 'clientCacheReads', 'clientCacheWrites', 'clientOutputs', 'clientUnclassifiedTokens', 'models', 'modelCosts', 'modelCacheReads', 'modelCacheWrites', 'modelOutputs', 'modelUnclassifiedTokens'];
const PERIODS = ['today', 'month', 'allTime'];
function check(ok) { if (!ok) throw new TypeError('Invalid usage snapshot'); }
function object(value, keys, required = keys) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  check(Object.keys(value).every((key) => keys.includes(key)) && required.every((key) => Object.hasOwn(value, key)));
}
function text(value, max) {
  check(typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
    && !/[\p{Cc}\p{Cf}\\]/u.test(value));
}
function timestamp(value) {
  text(value, 32);
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z'));
}
function numeric(value, money = false) {
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0 && (money || Number.isSafeInteger(value)));
}
function map(value, money, clients = false) {
  object(value, Object.keys(value || {}), []);
  for (const [key, count] of Object.entries(value)) {
    text(key, 160);
    check(!FORBIDDEN.has(key.toLowerCase()) && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,159}$/.test(key) && !key.includes('..') && !/^[a-zA-Z]:/.test(key) && !key.includes('://') && (!clients || key === 'codex'));
    numeric(count, money);
  }
}
function capabilities(value, history = false) {
  object(value, ['tokenComponents', 'modelAttribution', ...(history ? ['history'] : [])]);
  check(Object.values(value).every((entry) => typeof entry === 'boolean'));
}
function period(value) {
  object(value, [...COUNTERS, 'costUsd', ...MAPS, 'clientModels', 'clientModelCosts', 'capabilities']);
  for (const key of COUNTERS) numeric(value[key]);
  numeric(value.costUsd, true);
  capabilities(value.capabilities);
  for (const key of MAPS) map(value[key], key.endsWith('Costs'), key.startsWith('client'));
  for (const key of ['clientModels', 'clientModelCosts']) {
    object(value[key], ['codex'], []);
    if (Object.hasOwn(value[key], 'codex')) map(value[key].codex, key.endsWith('Costs'));
  }
}
function validateUsageSnapshot(value) {
  // Size first also bounds subsequent traversal of JSON received over HTTP.
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  check(bytes <= MAX_BYTES);
  object(value, ['schemaVersion', 'deviceName', 'profile', 'platform', 'agentVersion', 'updatedAt', 'periodWindows', ...PERIODS, 'history', 'capabilities'],
    ['schemaVersion', 'profile', 'platform', 'agentVersion', 'updatedAt', 'periodWindows', ...PERIODS, 'history', 'capabilities']);
  check(value.schemaVersion === 1);
  if (value.deviceName !== undefined) text(value.deviceName, 80);
  object(value.profile, ['id', 'name']);
  check(typeof value.profile.id === 'string' && PROFILE_ID_RE.test(value.profile.id) && !FORBIDDEN.has(value.profile.id));
  text(value.profile.name, 80);
  text(value.platform, 64);
  check(/^[a-zA-Z0-9._-]+$/.test(value.platform));
  text(value.agentVersion, 128);
  check(/^[a-zA-Z0-9._+-]+$/.test(value.agentVersion));
  timestamp(value.updatedAt);
  object(value.periodWindows, PERIODS, []);
  for (const window of Object.values(value.periodWindows)) {
    object(window, ['key', 'startsAt', 'endsAt'], []);
    if (window.key !== undefined) { text(window.key, 128); check(/^[a-zA-Z0-9._:-]+$/.test(window.key)); }
    if (window.startsAt !== undefined) timestamp(window.startsAt);
    if (window.endsAt !== undefined && window.endsAt !== null) timestamp(window.endsAt);
  }
  for (const key of PERIODS) period(value[key]);
  capabilities(value.capabilities, true);
  object(value.history, ['daily']);
  check(Array.isArray(value.history.daily) && value.history.daily.length <= 30);
  for (const row of value.history.daily) {
    object(row, ['date', ...COUNTERS, 'costUsd']);
    check(typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && new Date(row.date).toISOString().slice(0, 10) === row.date);
    for (const key of COUNTERS) numeric(row[key]);
    numeric(row.costUsd, true);
  }
  return { bytes };
}
module.exports = { MAX_BYTES, PROFILE_ID_RE, COUNTERS, MAPS, PERIODS, validateUsageSnapshot, timestamp, object, text };
