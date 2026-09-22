'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REMOTE_USAGE_MANUAL_DEBOUNCE_MS,
  createRemoteUsageRuntime
} = require('../../src/electron/remoteUsageRuntime');

const DESKTOP_A = 'dev_11111111-1111-4111-8111-111111111111';
const DESKTOP_B = 'dev_22222222-2222-4222-8222-222222222222';

function credential(desktopId) {
  return `tm_uc_d1.${desktopId}.${'a'.repeat(43)}`;
}

function period(totalTokens = 1) {
  return {
    totalTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: totalTokens,
    outputTokens: 0,
    unclassifiedTokens: 0,
    costUsd: 0,
    clients: { codex: totalTokens },
    clientCosts: { codex: 0 },
    clientCacheReads: {},
    clientCacheWrites: { codex: totalTokens },
    clientOutputs: {},
    clientUnclassifiedTokens: {},
    models: {},
    modelCosts: {},
    modelCacheReads: {},
    modelCacheWrites: {},
    modelOutputs: {},
    modelUnclassifiedTokens: {},
    clientModels: { codex: {} },
    clientModelCosts: { codex: {} },
    capabilities: { tokenComponents: true, modelAttribution: true }
  };
}

function item(desktopId, profileId = 'codex', receivedAt = '2026-09-23T12:00:00.000Z') {
  const snapshot = {
    schemaVersion: 1,
    deviceName: 'A800 Server',
    profile: { id: profileId, name: profileId },
    platform: 'linux-a800',
    agentVersion: '1.0.0',
    updatedAt: receivedAt,
    periodWindows: {},
    today: period(10),
    month: period(10),
    allTime: period(10),
    history: { daily: [] },
    capabilities: { tokenComponents: true, modelAttribution: true, history: false }
  };
  return {
    source: { desktopId, name: 'A800 Server' },
    profile: { id: profileId, name: profileId },
    receivedAt,
    snapshot
  };
}

function makeRuntime({ getConfig, listSnapshots, now = () => Date.parse('2026-09-23T12:01:00.000Z'), onUpdate } = {}) {
  return createRemoteUsageRuntime({
    getConfig,
    listSnapshots,
    clientFactory: ({ baseUrl, credential: token }) => ({ baseUrl, token }),
    now,
    onUpdate
  });
}

test('starts with immediate fetch, self-excludes, and debounces manual refresh', async () => {
  let calls = 0;
  const states = [];
  const runtime = makeRuntime({
    getConfig: () => ({ baseUrl: 'https://cloud.example.test', credential: credential(DESKTOP_A) }),
    listSnapshots: async (_client, options) => {
      calls += 1;
      assert.equal(options.excludeSelf, true);
      assert.equal(options.desktopId, DESKTOP_A);
      return [item(DESKTOP_A), item(DESKTOP_B)];
    },
    onUpdate: (state) => states.push(state)
  });
  runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(runtime.getState().status, 'ready');
  assert.equal(runtime.getCompositionState().items.length, 1);
  assert.equal(Object.hasOwn(runtime.getState(), 'credential'), false);
  assert.equal(Object.hasOwn(runtime.getState(), 'localDesktopId'), false);

  await runtime.refresh({ force: true, reason: 'manual' });
  const callsAfterFirstManual = calls;
  await runtime.refresh({ force: true, reason: 'manual' });
  assert.equal(calls, callsAfterFirstManual);
  assert.ok(states.some((state) => state.profileCount === 1));
  runtime.stop();
});

test('retains last-good data on network failure and marks it stale', async () => {
  let fail = false;
  const runtime = makeRuntime({
    getConfig: () => ({ baseUrl: 'https://cloud.example.test', credential: credential(DESKTOP_A) }),
    listSnapshots: async () => {
      if (fail) throw Object.assign(new Error('network'), { code: 'network_error' });
      return [item(DESKTOP_B)];
    }
  });
  runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.getState().status, 'ready');
  fail = true;
  await runtime.refresh({ force: true, reason: 'manual' });
  assert.equal(runtime.getState().status, 'stale');
  assert.equal(runtime.getState().hasCachedData, true);
  assert.equal(runtime.getCompositionState().items.length, 1);
  runtime.stop();
});

test('401 becomes unauthenticated and changing credential clears the old owner cache', async () => {
  let owner = 'a';
  let config = { baseUrl: 'https://cloud.example.test', credential: credential(DESKTOP_A) };
  const runtime = makeRuntime({
    getConfig: () => config,
    listSnapshots: async () => {
      if (owner === 'a') return [item(DESKTOP_B)];
      throw Object.assign(new Error('unauthorized'), { status: 401, code: 'unauthorized' });
    }
  });
  runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.getCompositionState().items.length, 1);

  owner = 'b';
  config = { baseUrl: 'https://cloud.example.test', credential: credential(DESKTOP_B) };
  runtime.configure(config);
  assert.equal(runtime.getCompositionState().items.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.getState().status, 'unauthenticated');
  assert.equal(runtime.getState().hasCachedData, false);
  runtime.stop();
});

test('manual debounce constant remains bounded below the normal cadence', () => {
  const runtime = createRemoteUsageRuntime({ getConfig: () => ({}) });
  assert.ok(REMOTE_USAGE_MANUAL_DEBOUNCE_MS < runtime.constants.normalRefreshMs);
  runtime.stop();
});
