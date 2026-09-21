'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertNoForbiddenKeys,
  serializeServerSnapshot,
  validateServerSnapshot
} = require('../../src/server-agent/snapshot');

function period(overrides = {}) {
  return {
    capabilities: { tokenComponents: true },
    totalTokens: 120,
    costUsd: 1.25,
    cacheReadTokens: 80,
    cacheWriteTokens: 10,
    outputTokens: 20,
    unclassifiedTokens: 0,
    clients: { codex: 120, claude: 999 },
    clientCosts: { codex: 1.25, claude: 99 },
    clientCacheReads: { codex: 80, claude: 1 },
    clientCacheWrites: { codex: 10, claude: 1 },
    clientOutputs: { codex: 20, claude: 1 },
    clientUnclassifiedTokens: { codex: 0, claude: 1 },
    models: { 'gpt-5-codex': 120 },
    modelCosts: { 'gpt-5-codex': 1.25 },
    modelCacheReads: { 'gpt-5-codex': 80 },
    modelCacheWrites: { 'gpt-5-codex': 10 },
    modelOutputs: { 'gpt-5-codex': 20 },
    modelUnclassifiedTokens: { 'gpt-5-codex': 0 },
    clientModels: { codex: { 'gpt-5-codex': 120 }, claude: { secret: 999 } },
    clientModelCosts: { codex: { 'gpt-5-codex': 1.25 } },
    sessions: { secret: { prompt: 'do not copy', cwd: 'C:\\private' } },
    ...overrides
  };
}

function summary(overrides = {}) {
  return {
    platform: 'linux-x64',
    agentVersion: '1.0.0-test',
    updatedAt: '2026-09-21T10:00:00.000Z',
    periodWindows: {
      today: { key: '2026-09-21', startsAt: '2026-09-21T00:00:00.000Z', endsAt: '2026-09-22T00:00:00.000Z' },
      month: { key: '2026-09', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' },
      allTime: { key: 'all-time', startsAt: '2024-01-01T00:00:00.000Z', endsAt: null }
    },
    today: period(),
    month: period(),
    allTime: period(),
    historyAvailable: true,
    history: {
      daily: [{
        date: '2026-09-21',
        tokens: 120,
        cost: 1.25,
        cacheReadTokens: 80,
        cacheWriteTokens: 10,
        outputTokens: 20,
        unclassifiedTokens: 0,
        title: 'private title',
        project: 'private project'
      }]
    },
    credential: 'private credential',
    auth: { accessToken: 'private token' },
    prompt: 'private prompt',
    reply: 'private reply',
    cwd: 'C:\\private',
    nativeSessions: { private: true },
    ...overrides
  };
}

function projectOptions() {
  return { profile: { id: 'business', name: 'Business' }, platform: 'linux-x64', agentVersion: '1.0.0-test' };
}

test('snapshot preserves raw additive counters and emits no hit-rate percentage', () => {
  const result = serializeServerSnapshot(summary(), projectOptions());
  const snapshot = result.snapshot;
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.today.totalTokens, 120);
  assert.equal(snapshot.today.cacheReadTokens, 80);
  assert.equal(snapshot.today.cacheWriteTokens, 10);
  assert.equal(snapshot.today.outputTokens, 20);
  assert.equal(snapshot.today.unclassifiedTokens, 0);
  assert.deepEqual(snapshot.today.clients, { codex: 120 });
  assert.equal(Object.hasOwn(snapshot.today, 'cacheHitRate'), false);
  assert.equal(Object.hasOwn(snapshot, 'overallPercent'), false);
  assert.equal(result.bytes, Buffer.byteLength(result.json, 'utf8'));
  validateServerSnapshot(snapshot);
});

test('incomplete token components stay incomplete instead of becoming a fake zero split', () => {
  const incomplete = period({
    totalTokens: 100,
    cacheReadTokens: 30,
    cacheWriteTokens: 0,
    outputTokens: 10,
    unclassifiedTokens: 20,
    capabilities: { tokenComponents: false }
  });
  const snapshot = serializeServerSnapshot(summary({ today: incomplete, month: incomplete, allTime: incomplete }), projectOptions()).snapshot;
  assert.equal(snapshot.today.unclassifiedTokens, 20);
  assert.equal(snapshot.today.capabilities.tokenComponents, false);
  assert.equal(snapshot.capabilities.tokenComponents, false);
});

test('projection recursively excludes forbidden privacy fields and non-Codex clients', () => {
  const snapshot = serializeServerSnapshot(summary({
    today: period({
      capabilities: { tokenComponents: true, modelAttribution: true },
      arbitrary: {
        sessions: { prompt: 'secret' },
        project: { cwd: 'C:\\secret' },
        auth: { credential: 'secret' }
      }
    }),
    history: {
      daily: [{ date: '2026-09-21', tokens: 1, summary: 'secret', response: 'secret', cwd: 'C:\\secret' }]
    }
  }), projectOptions()).snapshot;
  assertNoForbiddenKeys(snapshot);
  const serialized = JSON.stringify(snapshot);
  for (const secret of ['secret', 'private credential', 'private prompt', 'C:\\private', 'claude']) {
    assert.equal(serialized.includes(secret), false, `snapshot leaked ${secret}`);
  }
  assert.deepEqual(snapshot.today.clients, { codex: 120 });
});

test('history is capped at 30 days and large model attribution trims before the budget fails', () => {
  const models = {};
  const modelCosts = {};
  const modelCacheReads = {};
  const modelCacheWrites = {};
  const modelOutputs = {};
  const clientModels = { codex: {} };
  for (let index = 0; index < 260; index += 1) {
    const model = `model-${String(index).padStart(3, '0')}-${'x'.repeat(72)}`;
    models[model] = 100;
    modelCosts[model] = 1;
    modelCacheReads[model] = 80;
    modelCacheWrites[model] = 10;
    modelOutputs[model] = 10;
    clientModels.codex[model] = 100;
  }
  const largePeriod = period({
    totalTokens: 26_000,
    cacheReadTokens: 20_800,
    cacheWriteTokens: 2_600,
    outputTokens: 2_600,
    models,
    modelCosts,
    modelCacheReads,
    modelCacheWrites,
    modelOutputs,
    clientModels,
    clientModelCosts: { codex: modelCosts }
  });
  const daily = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    tokens: 100,
    cost: 1,
    cacheReadTokens: 70,
    cacheWriteTokens: 10,
    outputTokens: 20,
    unclassifiedTokens: 0,
    tokenComponentsAvailable: true
  }));
  const result = serializeServerSnapshot(summary({
    today: largePeriod,
    month: largePeriod,
    allTime: largePeriod,
    history: { daily }
  }), projectOptions());
  assert.ok(result.bytes <= 12 * 1024);
  assert.ok(result.snapshot.history.daily.length <= 30);
  assert.equal(result.trimmed.history, true);
  assert.equal(result.snapshot.capabilities.modelAttribution, false);
  assert.ok(Object.keys(result.snapshot.today.models).length < 260);
  assert.equal(result.snapshot.today.totalTokens, 26_000);
  assert.equal(result.snapshot.today.cacheReadTokens, 20_800);
  assert.equal(result.snapshot.today.cacheWriteTokens, 2_600);
  assert.equal(result.snapshot.today.outputTokens, 2_600);
});
