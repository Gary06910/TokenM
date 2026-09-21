'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseServerAgentConfig } = require('../../src/server-agent/config');
const { createServerAgentPaths } = require('../../src/server-agent/paths');
const { createServerAgentSupervisor } = require('../../src/server-agent/supervisor');

function makePeriod(model, tokens) {
  return {
    capabilities: { tokenComponents: true },
    totalTokens: tokens,
    costUsd: 0.01,
    cacheReadTokens: Math.floor(tokens / 2),
    cacheWriteTokens: 0,
    outputTokens: Math.floor(tokens / 2),
    unclassifiedTokens: 0,
    clients: { codex: tokens },
    clientCosts: { codex: 0.01 },
    clientCacheReads: { codex: Math.floor(tokens / 2) },
    clientCacheWrites: { codex: 0 },
    clientOutputs: { codex: Math.floor(tokens / 2) },
    clientUnclassifiedTokens: { codex: 0 },
    models: { [model]: tokens },
    modelCosts: { [model]: 0.01 },
    modelCacheReads: { [model]: Math.floor(tokens / 2) },
    modelCacheWrites: { [model]: 0 },
    modelOutputs: { [model]: Math.floor(tokens / 2) },
    modelUnclassifiedTokens: { [model]: 0 },
    clientModels: { codex: { [model]: tokens } },
    clientModelCosts: { codex: { [model]: 0.01 } }
  };
}

function makeFixture(marker, model, tokens, overrides = {}) {
  return {
    marker,
    platform: 'linux-x64',
    updatedAt: '2026-09-21T10:00:00.000Z',
    periodWindows: {
      today: { key: '2026-09-21' },
      month: { key: '2026-09' },
      allTime: { key: 'all-time' }
    },
    today: makePeriod(model, tokens),
    month: makePeriod(model, tokens),
    allTime: makePeriod(model, tokens),
    history: { daily: [] },
    ...overrides
  };
}

function createFixtureSupervisor({ fault = false, once = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-server-agent-isolation-'));
  const paths = createServerAgentPaths({ root });
  const codexA = path.join(root, 'codex-a');
  const codexB = path.join(root, 'codex-b');
  fs.mkdirSync(codexA, { recursive: true });
  fs.mkdirSync(codexB, { recursive: true });
  fs.writeFileSync(
    path.join(codexA, 'server-agent-fixture.json'),
    JSON.stringify(makeFixture('A', 'model-a', 100)),
    'utf8'
  );
  fs.writeFileSync(
    path.join(codexB, 'server-agent-fixture.json'),
    JSON.stringify(makeFixture('B', 'model-b', 200, fault ? { fail: true } : {})),
    'utf8'
  );
  const config = parseServerAgentConfig({
    version: 1,
    deviceName: 'To Know Server',
    profiles: [
      { id: 'business', name: 'Business', codexHome: codexA, enabled: true },
      { id: 'personal', name: 'Personal', codexHome: codexB, enabled: true }
    ]
  });
  const parentEnv = {
    ...process.env,
    CODEX_HOME: path.join(root, 'parent-codex-home'),
    TOKEN_MONITOR_CLIENTS: 'claude,cursor,codex'
  };
  const supervisor = createServerAgentSupervisor({
    config,
    paths,
    env: parentEnv,
    fixtureMode: true,
    once,
    platform: 'linux-x64',
    watchEnabled: false,
    startTimeoutMs: 4000,
    stopTimeoutMs: 1000
  });
  return { root, paths, codexA, codexB, supervisor, parentEnv };
}

test('two profile workers run concurrently with fixed independent environments and state', async () => {
  const setup = createFixtureSupervisor();
  const before = {
    codeHome: process.env.CODEX_HOME,
    clients: process.env.TOKEN_MONITOR_CLIENTS
  };
  await setup.supervisor.start();
  const snapshots = await setup.supervisor.waitForSnapshots(4000);
  await setup.supervisor.stop();

  assert.deepEqual(Object.keys(snapshots).sort(), ['business', 'personal']);
  assert.equal(snapshots.business.profile.id, 'business');
  assert.equal(snapshots.personal.profile.id, 'personal');
  assert.equal(snapshots.business.today.totalTokens, 100);
  assert.equal(snapshots.personal.today.totalTokens, 200);
  assert.deepEqual(Object.keys(snapshots.business.today.models), ['model-a']);
  assert.deepEqual(Object.keys(snapshots.personal.today.models), ['model-b']);
  assert.equal(JSON.stringify(snapshots.business).includes('model-b'), false);
  assert.equal(JSON.stringify(snapshots.personal).includes('model-a'), false);
  assert.equal(snapshots.business.capabilities.tokenComponents, true);
  assert.equal(snapshots.business.capabilities.modelAttribution, true);
  assert.equal(JSON.stringify(snapshots.business).includes('claude'), false);
  assert.equal(JSON.stringify(snapshots.business).includes('cursor'), false);

  const stateA = JSON.parse(fs.readFileSync(path.join(setup.paths.profileStateDir('business'), 'worker-fixture-state.json'), 'utf8'));
  const stateB = JSON.parse(fs.readFileSync(path.join(setup.paths.profileStateDir('personal'), 'worker-fixture-state.json'), 'utf8'));
  assert.deepEqual(stateA, { profileId: 'business', clients: 'codex', marker: 'A' });
  assert.deepEqual(stateB, { profileId: 'personal', clients: 'codex', marker: 'B' });
  assert.notEqual(setup.paths.profilePaths('business').collectorAnchorPath, setup.paths.profilePaths('personal').collectorAnchorPath);
  assert.notEqual(setup.paths.profilePaths('business').sessionUsageArchivePath, setup.paths.profilePaths('personal').sessionUsageArchivePath);
  assert.equal(process.env.CODEX_HOME, before.codeHome);
  assert.equal(process.env.TOKEN_MONITOR_CLIENTS, before.clients);
  assert.equal(setup.supervisor.getDiagnostics().state, 'stopped');
});

test('one failed profile worker does not corrupt the other profile', async () => {
  const setup = createFixtureSupervisor({ fault: true, once: false });
  await setup.supervisor.start();
  const snapshots = await setup.supervisor.waitForSnapshots(4000);
  assert.equal(snapshots.business.today.totalTokens, 100);
  assert.equal(Object.hasOwn(snapshots, 'personal'), false);
  const diagnostics = setup.supervisor.getDiagnostics();
  assert.equal(diagnostics.profiles.personal.lastErrorCode, 'fixture-failure');
  assert.equal(diagnostics.profiles.business.clientList, undefined);
  assert.equal(diagnostics.clientList, 'codex');
  await setup.supervisor.stop();
  assert.equal(setup.supervisor.getDiagnostics().state, 'stopped');
});

test('supervisor owns the lifecycle PID file while workers use profile state only', async () => {
  const setup = createFixtureSupervisor();
  await setup.supervisor.start();
  assert.equal(fs.readFileSync(setup.paths.supervisorPidPath, 'utf8'), String(process.pid));
  assert.equal(fs.existsSync(setup.paths.profilePaths('business').workerPidPath), false);
  await setup.supervisor.stop();
  assert.equal(fs.existsSync(setup.paths.supervisorPidPath), false);
});
