'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const cacheHitRate = require('../../src/electron/renderer/cacheHitRate');

function exactPeriod(overrides = {}) {
  return {
    capabilities: { tokenComponents: true },
    totalTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    unclassifiedTokens: 0,
    clients: {},
    clientCacheReads: {},
    clientCacheWrites: {},
    clientOutputs: {},
    clientUnclassifiedTokens: {},
    models: {},
    modelCacheReads: {},
    modelCacheWrites: {},
    modelOutputs: {},
    modelUnclassifiedTokens: {},
    ...overrides
  };
}

test('uses cache reads over input-side tokens, including a true 100% hit rate', () => {
  const summary = cacheHitRate.summaryFor(exactPeriod({
    totalTokens: 100,
    cacheReadTokens: 100
  }));
  assert.equal(summary.inputSideTokens, 100);
  assert.equal(summary.hitRate, 1);
  assert.equal(cacheHitRate.formatPercent(summary), '100.0%');
});

test('keeps a complete zero-read period as a real 0% rather than unavailable', () => {
  const summary = cacheHitRate.summaryFor(exactPeriod());
  assert.equal(summary.available, true);
  assert.equal(summary.hitRate, 0);
  assert.equal(cacheHitRate.formatPercent(summary), '0.0%');
});

test('excludes output from the denominator and counts cache writes as cache misses', () => {
  const summary = cacheHitRate.summaryFor(exactPeriod({
    totalTokens: 120,
    cacheReadTokens: 80,
    cacheWriteTokens: 10,
    outputTokens: 20
  }));
  assert.equal(summary.inputSideTokens, 100);
  assert.equal(summary.hitTokens, 80);
  assert.equal(summary.cacheMissTokens, 20);
  assert.equal(summary.freshInputTokens, 10);
  assert.equal(summary.hitRate, 0.8);
  assert.equal(cacheHitRate.formatPercent(summary), '80.0%');
});

test('day, month, and all-time periods use the same raw-counter formula', () => {
  const periods = {
    today: exactPeriod({ totalTokens: 100, cacheReadTokens: 100 }),
    month: exactPeriod({ totalTokens: 120, cacheReadTokens: 80, cacheWriteTokens: 10, outputTokens: 20 }),
    allTime: exactPeriod({ totalTokens: 200, cacheReadTokens: 50, outputTokens: 50 })
  };
  assert.equal(cacheHitRate.formatPercent(cacheHitRate.summaryFor(periods.today)), '100.0%');
  assert.equal(cacheHitRate.formatPercent(cacheHitRate.summaryFor(periods.month)), '80.0%');
  assert.equal(cacheHitRate.formatPercent(cacheHitRate.summaryFor(periods.allTime)), '33.3%');
});

test('missing input, capability, and component provenance stay unavailable', () => {
  const noInput = cacheHitRate.summaryFor(exactPeriod({ totalTokens: 0 }));
  assert.equal(noInput.available, false);
  assert.equal(noInput.reason, 'noInput');
  assert.equal(cacheHitRate.formatPercent(noInput), '—');

  const oldRecord = cacheHitRate.summaryFor(exactPeriod({
    capabilities: { tokenComponents: false },
    totalTokens: 100,
    cacheReadTokens: 0
  }));
  assert.equal(oldRecord.available, false);
  assert.equal(oldRecord.reason, 'capability');
  assert.equal(cacheHitRate.formatPercent(oldRecord), '—');

  const unclassified = cacheHitRate.summaryFor(exactPeriod({ unclassifiedTokens: 1 }));
  assert.equal(unclassified.available, false);
  assert.equal(unclassified.reason, 'unclassified');
  assert.equal(cacheHitRate.formatPercent(unclassified), '—');
});

test('overall, model, and client rates are weighted by token sums, never averaged', () => {
  const period = exactPeriod({
    totalTokens: 1000,
    cacheReadTokens: 900,
    models: { 'gpt-6-astra': 900, 'gpt-5.5': 100 },
    modelCacheReads: { 'gpt-6-astra': 900, 'gpt-5.5': 0 },
    modelCacheWrites: {},
    modelOutputs: { 'gpt-6-astra': 0, 'gpt-5.5': 0 },
    modelUnclassifiedTokens: { 'gpt-6-astra': 0, 'gpt-5.5': 0 },
    clients: { codex: 900, claude: 100 },
    clientCacheReads: { codex: 900, claude: 0 },
    clientCacheWrites: {},
    clientOutputs: { codex: 0, claude: 0 },
    clientUnclassifiedTokens: { codex: 0, claude: 0 }
  });
  assert.equal(cacheHitRate.summaryFor(period).hitRate, 0.9);
  assert.equal(cacheHitRate.summaryFor(period, { scope: 'model', key: 'gpt-6-astra' }).hitRate, 1);
  assert.equal(cacheHitRate.summaryFor(period, { scope: 'model', key: 'gpt-5.5' }).hitRate, 0);
  assert.equal(cacheHitRate.summaryFor(period, { scope: 'client', key: 'codex' }).hitRate, 1);
  assert.equal(cacheHitRate.summaryFor(period, { scope: 'client', key: 'claude' }).hitRate, 0);
  assert.deepEqual(cacheHitRate.breakdownRows(period, 'model').map((row) => row.key), ['gpt-6-astra', 'gpt-5.5']);
  assert.deepEqual(cacheHitRate.breakdownRows(period, 'client').map((row) => row.key), ['codex', 'claude']);
});

test('breakdown rows exclude entities with no input-side tokens', () => {
  const period = exactPeriod({
    models: { outputOnly: 20, input: 100 },
    modelCacheReads: { input: 50 },
    modelOutputs: { outputOnly: 20, input: 0 }
  });
  assert.deepEqual(cacheHitRate.breakdownRows(period, 'model').map((row) => row.key), ['input']);
});
