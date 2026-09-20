'use strict';

const { readRegularFileNoFollow, writePrivateJsonAtomic } = require('../shared/credentialStore');
const { normalizeLimitProvider } = require('../shared/limits/core');

const ROW_FIELDS = ['provider', 'accountKey', 'accountLabel', 'accountName', 'plan', 'updatedAt', 'source', 'sourceDetail'];
const WINDOW_FIELDS = ['id', 'kind', 'label', 'limitId', 'additional', 'metric', 'currency', 'usedPercent', 'remainingPercent', 'used', 'limit', 'remaining', 'resetsAt', 'windowMinutes'];
function pick(value, fields) {
  return Object.fromEntries(fields.filter((key) => ['string', 'number', 'boolean'].includes(typeof value?.[key]))
    .map((key) => [key, value[key]]));
}
function safeRow(value) {
  const row = normalizeLimitProvider(value);
  if (!row?.accountKey || row.status !== 'ok' || !row.windows?.length) return null;
  return { ...pick(row, ROW_FIELDS), status: 'ok', windows: row.windows.map((w) => pick(w, WINDOW_FIELDS)) };
}

function createLimitsDisplayCache({ filePath, now = Date.now, bindingFor, onChange = () => {} }) {
  let entries = [];
  const attempts = new Map();
  const live = new Map();
  const revisions = new Map();
  let writable = true;
  try {
    const data = JSON.parse(readRegularFileNoFollow(filePath, { description: 'Limits display cache', encoding: 'utf8', maxBytes: 1024 * 1024 }));
    if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('invalid_cache');
    entries = data.entries.slice(0, 200).flatMap((entry) => {
      const row = safeRow(entry.row);
      return row && typeof entry.bindingKey === 'string' && Number.isFinite(entry.cacheSavedAt)
        ? [{ row, bindingKey: entry.bindingKey, cacheSavedAt: entry.cacheSavedAt }] : [];
    });
  } catch (error) {
    // Cache failure must never block launch or overwrite an unrecognized file.
    writable = error.code === 'ENOENT';
  }
  function persist() {
    if (!writable) return;
    try { writePrivateJsonAtomic(filePath, { version: 1, entries }); } catch (_) { /* presentation only */ }
  }
  function snapshot() {
    const bindings = new Map();
    const binding = (provider) => {
      if (!bindings.has(provider)) bindings.set(provider, bindingFor(provider));
      return bindings.get(provider);
    };
    const rows = [];
    for (const entry of entries) {
      const id = entry.row.provider;
      if (!entry.bindingKey || entry.bindingKey !== binding(id)) continue;
      const current = live.get(id);
      if (current?.bindingKey === entry.bindingKey && current.rows.some((r) => r.accountKey === entry.row.accountKey && r.status === 'ok')) continue;
      const attempt = attempts.get(id);
      const resetExpired = entry.row.windows.some((w) => w.resetsAt && Date.parse(w.resetsAt) <= now());
      rows.push({ ...entry.row, windows: resetExpired ? [] : entry.row.windows, cached: true,
        cachedAt: entry.cacheSavedAt, livePending: !attempt || attempt.pending,
        refreshFailed: Boolean(attempt && !attempt.pending && attempt.failed), resetExpired });
    }
    for (const [id, value] of live) {
      if (value.bindingKey !== binding(id)) continue;
      for (const row of value.rows) {
        if (rows.some((r) => r.provider === id && (r.accountKey === row.accountKey || !row.accountKey))) continue;
        rows.push(row);
      }
    }
    return { providers: rows };
  }
  return {
    snapshot,
    begin(provider) {
      const revision = revisions.get(provider) || 0;
      const bindingKey = bindingFor(provider);
      attempts.set(provider, { pending: true });
      onChange();
      return { provider, revision, bindingKey };
    },
    finish(ticket, rows, { aborted = false, scoped = false } = {}) {
      const { provider, revision, bindingKey } = ticket;
      if (aborted || revision !== (revisions.get(provider) || 0) || bindingKey !== bindingFor(provider)) return;
      const good = rows.filter((row) => row.status === 'ok');
      attempts.set(provider, { pending: false, failed: good.length !== rows.length || !rows.length });
      const previous = scoped ? (live.get(provider)?.rows || []).filter((r) => !rows.some((n) => n.accountKey === r.accountKey)) : [];
      live.set(provider, { bindingKey, rows: [...previous, ...rows] });
      if (rows.some((r) => ['unauthorized', 'notConfigured', 'disabled'].includes(r.status))) {
        entries = entries.filter((e) => e.row.provider !== provider);
      }
      if (!scoped && good.length === rows.length) {
        entries = entries.filter((e) => e.row.provider !== provider || good.some((r) => r.accountKey === e.row.accountKey));
      }
      for (const row of good) {
        const clean = safeRow(row);
        if (!clean || !bindingKey) continue;
        entries = entries.filter((e) => !(e.row.provider === provider && e.row.accountKey === clean.accountKey));
        entries.push({ row: clean, bindingKey, cacheSavedAt: now() });
      }
      entries = entries.slice(-200);
      persist();
      onChange();
    },
    clear(provider) {
      revisions.set(provider, (revisions.get(provider) || 0) + 1);
      entries = entries.filter((e) => e.row.provider !== provider);
      live.delete(provider);
      attempts.delete(provider);
      persist();
      onChange();
    }
  };
}

module.exports = { createLimitsDisplayCache, safeRow };
