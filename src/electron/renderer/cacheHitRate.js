'use strict';

(function exposeCacheHitRate(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorCacheHitRate = api;
})(typeof window !== 'undefined' ? window : null, function createCacheHitRateApi() {
  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function nonNegative(value) {
    return Math.max(0, finiteNumber(value));
  }

  function tokenParts(source = {}) {
    const totalTokens = nonNegative(source.totalTokens);
    const cacheReadTokens = nonNegative(source.cacheReadTokens);
    const cacheWriteTokens = nonNegative(source.cacheWriteTokens);
    const outputTokens = nonNegative(source.outputTokens);
    const inputSideTokens = Math.max(0, totalTokens - outputTokens);
    const hitTokens = cacheReadTokens;
    const cacheMissTokens = Math.max(0, inputSideTokens - hitTokens);
    const freshInputTokens = Math.max(
      0,
      totalTokens - cacheReadTokens - cacheWriteTokens - outputTokens
    );
    return {
      totalTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      inputSideTokens,
      hitTokens,
      cacheMissTokens,
      freshInputTokens
    };
  }

  function unclassifiedFor(period, scope, key) {
    if (scope === 'model') return nonNegative(period?.modelUnclassifiedTokens?.[key]);
    if (scope === 'client') return nonNegative(period?.clientUnclassifiedTokens?.[key]);
    return nonNegative(period?.unclassifiedTokens);
  }

  function unavailable(parts, reason) {
    return {
      ...parts,
      available: false,
      reason,
      hitRate: null,
      unclassifiedTokens: null
    };
  }

  function summaryFor(period, options = {}) {
    const scope = options.scope || 'overall';
    const key = options.key || '';
    const parts = tokenParts(scope === 'model'
      ? {
        totalTokens: period?.models?.[key],
        cacheReadTokens: period?.modelCacheReads?.[key],
        cacheWriteTokens: period?.modelCacheWrites?.[key],
        outputTokens: period?.modelOutputs?.[key]
      }
      : scope === 'client'
        ? {
          totalTokens: period?.clients?.[key],
          cacheReadTokens: period?.clientCacheReads?.[key],
          cacheWriteTokens: period?.clientCacheWrites?.[key],
          outputTokens: period?.clientOutputs?.[key]
        }
        : period);
    if (period?.capabilities?.tokenComponents !== true) return unavailable(parts, 'capability');
    const unclassifiedTokens = unclassifiedFor(period, scope, key);
    if (unclassifiedTokens > 0) return unavailable(parts, 'unclassified');
    if (parts.inputSideTokens <= 0) return unavailable(parts, 'noInput');
    return {
      ...parts,
      available: true,
      reason: null,
      unclassifiedTokens: 0,
      hitRate: parts.hitTokens / parts.inputSideTokens
    };
  }

  function keysFor(period, scope) {
    const source = scope === 'model'
      ? [period?.models, period?.modelCacheReads, period?.modelCacheWrites, period?.modelOutputs]
      : [period?.clients, period?.clientCacheReads, period?.clientCacheWrites, period?.clientOutputs];
    return [...new Set(source.flatMap((value) => Object.keys(value || {})))];
  }

  function breakdownRows(period, scope) {
    return keysFor(period, scope)
      .map((key) => ({ key, ...summaryFor(period, { scope, key }) }))
      .filter((row) => row.inputSideTokens > 0)
      .sort((a, b) => b.inputSideTokens - a.inputSideTokens || a.key.localeCompare(b.key));
  }

  function formatPercent(summary, digits = 1) {
    if (!summary?.available) return '—';
    return `${(summary.hitRate * 100).toFixed(digits)}%`;
  }

  return {
    breakdownRows,
    formatPercent,
    summaryFor,
    tokenParts
  };
});
