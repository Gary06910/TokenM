'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseServerAgentConfig } = require('../../src/server-agent/config');
const {
  createServerAgentSupervisor,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_START_TIMEOUT_MS,
  SNAPSHOT_TIMEOUT_GRACE_MS
} = require('../../src/server-agent/supervisor');
const { run } = require('../../src/server-agent/cli');
const { errorMessage, readyMessage, snapshotMessage, stoppedMessage, MESSAGE_TYPES } = require('../../src/server-agent/protocol');
const { serializeServerSnapshot } = require('../../src/server-agent/snapshot');
const { createServerAgentPaths } = require('../../src/server-agent/paths');

async function settle() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

function createFakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = [];

  function setTimeoutFake(fn, delay) {
    const timer = { id: ++nextId, at: now + delay, fn };
    timers.push(timer);
    return timer.id;
  }

  function clearTimeoutFake(id) {
    const index = timers.findIndex((timer) => timer.id === id);
    if (index !== -1) timers.splice(index, 1);
  }

  function advance(ms) {
    const target = now + ms;
    while (true) {
      timers.sort((left, right) => left.at - right.at || left.id - right.id);
      const timer = timers[0];
      if (!timer || timer.at > target) break;
      timers.shift();
      now = timer.at;
      timer.fn();
    }
    now = target;
  }

  return { advance, clearTimeout: clearTimeoutFake, now: () => now, setTimeout: setTimeoutFake };
}

class FakeWorker extends EventEmitter {
  constructor(profileId) {
    super();
    this.profileId = profileId;
    this.connected = true;
    this.exited = false;
  }

  send(message) {
    if (message?.type !== MESSAGE_TYPES.STOP) return;
    this.connected = false;
    this.emit('message', stoppedMessage(this.profileId));
    if (!this.exited) {
      this.exited = true;
      this.emit('exit', 0, null);
    }
  }

  kill() {
    this.connected = false;
    if (!this.exited) {
      this.exited = true;
      this.emit('exit', null, 'SIGTERM');
    }
  }
}

function makeSnapshot(profileId, tokens = 1) {
  return serializeServerSnapshot({
    updatedAt: '2026-09-22T00:00:00.000Z',
    today: { totalTokens: tokens },
    month: { totalTokens: tokens },
    allTime: { totalTokens: tokens },
    history: { daily: [] }
  }, {
    profile: { id: profileId, name: profileId },
    platform: 'linux-x64',
    agentVersion: '1.0.0',
    deviceName: 'test-server'
  }).snapshot;
}

function cleanupRoot(root) {
  const stateDir = path.join(root, 'state');
  try { fs.rmdirSync(stateDir); } catch (_) {}
  try { fs.rmdirSync(root); } catch (_) {}
}

function createSupervisorFixture(t, profileIds, plans = {}, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-server-agent-timeout-'));
  const stateDir = path.join(root, 'state');
  const profiles = profileIds.map((id) => ({
    id,
    name: id,
    codexHome: path.join(root, id),
    enabled: true
  }));
  const config = parseServerAgentConfig({ version: 1, profiles });
  const paths = {
    profileStateDir: () => stateDir,
    supervisorPidPath: path.join(stateDir, 'server-agent.pid')
  };
  const clock = createFakeClock();
  const children = [];
  const supervisor = createServerAgentSupervisor({
    config,
    paths,
    env: { ...process.env, ...(options.env || {}) },
    once: true,
    pidFile: false,
    platform: 'linux-x64',
    startTimeoutMs: options.startTimeoutMs,
    stopTimeoutMs: 1_000,
    commandTimeoutMs: options.commandTimeoutMs,
    snapshotTimeoutMs: options.snapshotTimeoutMs
  }, {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    fork: (_workerPath, _args, forkOptions) => {
      const profileId = forkOptions.env.TO_KNOW_PROFILE_ID;
      const plan = plans[profileId] || {};
      const child = new FakeWorker(profileId);
      children.push({ child, profileId, env: forkOptions.env });
      clock.setTimeout(() => child.emit('message', readyMessage(profileId)), plan.readyDelayMs ?? 0);
      if (Object.hasOwn(plan, 'snapshotDelayMs') && plan.snapshotDelayMs !== null) {
        clock.setTimeout(() => child.emit('message', snapshotMessage(profileId, makeSnapshot(profileId, plan.tokens || 1))), plan.snapshotDelayMs);
      }
      if (plan.errorDelayMs !== undefined) {
        clock.setTimeout(() => {
          child.emit('message', errorMessage(profileId, plan.errorCode || 'worker-failed', 'runtime'));
          child.connected = false;
          if (!child.exited) {
            child.exited = true;
            child.emit('exit', 1, null);
          }
        }, plan.errorDelayMs);
      }
      return child;
    }
  });
  t.after(async () => {
    await supervisor.stop();
    cleanupRoot(root);
  });
  return { children, clock, config, root, supervisor };
}

async function startSupervisor(fixture) {
  const starting = fixture.supervisor.start();
  await settle();
  fixture.clock.advance(0);
  await settle();
  await starting;
}

function createCliFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-server-agent-cli-timeout-'));
  const paths = createServerAgentPaths({ root });
  const profiles = ['codex', 'codex-srj'].map((id) => ({
    id,
    name: id,
    codexHome: path.join(root, id),
    enabled: true
  }));
  fs.mkdirSync(paths.configRoot, { recursive: true });
  fs.writeFileSync(paths.configFile, `${JSON.stringify({ version: 1, profiles })}\n`, 'utf8');
  t.after(() => {
    try { fs.unlinkSync(paths.configFile); } catch (_) {}
    try { fs.rmdirSync(paths.configRoot); } catch (_) {}
    try { fs.rmdirSync(path.join(root, 'config')); } catch (_) {}
    cleanupRoot(root);
  });
  return { paths, root };
}

async function captureStdout(callback) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    const value = await callback();
    return { output, value };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test('startup and snapshot budgets are separate and command timeout binding is strict', (t) => {
  const defaultFixture = createSupervisorFixture(t, ['codex']);
  const defaults = defaultFixture.supervisor.getTimeouts();
  assert.equal(defaults.startTimeoutMs, DEFAULT_START_TIMEOUT_MS);
  assert.equal(defaults.effectiveCommandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS);
  assert.equal(defaults.snapshotTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS + SNAPSHOT_TIMEOUT_GRACE_MS);
  assert.notEqual(defaults.startTimeoutMs, defaults.snapshotTimeoutMs);

  const custom = createSupervisorFixture(t, ['codex'], {}, { commandTimeoutMs: 240_000 });
  assert.equal(custom.supervisor.getTimeouts().effectiveCommandTimeoutMs, 240_000);
  assert.equal(custom.supervisor.getTimeouts().snapshotTimeoutMs, 270_000);
  assert.equal(custom.supervisor._buildWorkerEnv(custom.config.profiles[0]).TO_KNOW_TOKSCALE_TIMEOUT_MS, '240000');

  const explicitSnapshot = createSupervisorFixture(t, ['codex'], {}, {
    commandTimeoutMs: 240_000,
    snapshotTimeoutMs: 123_000
  });
  assert.equal(explicitSnapshot.supervisor.getTimeouts().snapshotTimeoutMs, 123_000);

  const fromEnv = createSupervisorFixture(t, ['codex'], {}, { env: { TO_KNOW_TOKSCALE_TIMEOUT_MS: '240000' } });
  assert.equal(fromEnv.supervisor.getTimeouts().effectiveCommandTimeoutMs, 240_000);
  assert.equal(fromEnv.supervisor.getTimeouts().snapshotTimeoutMs, 270_000);

  for (const invalid of ['garbage', 'NaN', 'Infinity', '-1', '0', '1.5']) {
    const fixture = createSupervisorFixture(t, ['codex'], {}, { env: { TO_KNOW_TOKSCALE_TIMEOUT_MS: invalid } });
    const timeouts = fixture.supervisor.getTimeouts();
    assert.equal(timeouts.effectiveCommandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, invalid);
    assert.equal(timeouts.snapshotTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS + SNAPSHOT_TIMEOUT_GRACE_MS, invalid);
    assert.equal(fixture.supervisor._buildWorkerEnv(fixture.config.profiles[0]).TO_KNOW_TOKSCALE_TIMEOUT_MS, '120000', invalid);
  }
});

test('slow valid snapshot survives the startup budget and completes within the independent snapshot budget', async (t) => {
  const fixture = createSupervisorFixture(t, ['codex'], { codex: { snapshotDelayMs: 50_000 } });
  await startSupervisor(fixture);
  const waiting = fixture.supervisor.waitForSnapshots();
  let completed = false;
  void waiting.then(() => { completed = true; });

  fixture.clock.advance(10_000);
  await settle();
  assert.equal(completed, false);
  assert.deepEqual(fixture.supervisor.getAllSnapshots(), {});

  fixture.clock.advance(40_000);
  const snapshots = await waiting;
  assert.equal(snapshots.codex.profile.id, 'codex');
});

test('two profiles at controlled 30s and 51s delays both complete without a 10s early return', async (t) => {
  const fixture = createSupervisorFixture(t, ['codex', 'codex-srj'], {
    codex: { snapshotDelayMs: 30_000, tokens: 30 },
    'codex-srj': { snapshotDelayMs: 51_000, tokens: 51 }
  });
  await startSupervisor(fixture);
  const waiting = fixture.supervisor.waitForSnapshots();

  fixture.clock.advance(10_000);
  await settle();
  assert.deepEqual(fixture.supervisor.getAllSnapshots(), {});

  fixture.clock.advance(20_000);
  await settle();
  assert.deepEqual(Object.keys(fixture.supervisor.getAllSnapshots()), ['codex']);

  fixture.clock.advance(21_000);
  const snapshots = await waiting;
  assert.deepEqual(Object.keys(snapshots).sort(), ['codex', 'codex-srj']);
  assert.equal(snapshots['codex-srj'].today.totalTokens, 51);
});

test('snapshot timeout returns partial diagnostics internally but once rejects the empty result', async (t) => {
  const fixture = createSupervisorFixture(t, ['codex'], { codex: { snapshotDelayMs: null } });
  await startSupervisor(fixture);
  const waiting = fixture.supervisor.waitForSnapshots();
  fixture.clock.advance(149_999);
  await settle();
  let completed = false;
  void waiting.then(() => { completed = true; });
  assert.equal(completed, false);
  fixture.clock.advance(1);
  assert.deepEqual(await waiting, {});

  const cliFixture = createCliFixture(t);
  let stopped = 0;
  const result = await captureStdout(async () => {
    await assert.rejects(
      () => run(['once', '--root', cliFixture.root], {
        createServerAgentSupervisor: () => ({
          config: fixture.config,
          start: async () => {},
          waitForSnapshots: async () => {},
          getAllSnapshots: () => ({}),
          stop: async () => { stopped += 1; }
        })
      }),
      (error) => error?.code === 'snapshot_incomplete'
    );
  });
  assert.equal(result.output, '');
  assert.equal(stopped, 1);
});

test('once rejects a valid snapshot plus a worker error instead of reporting partial success', async (t) => {
  const cliFixture = createCliFixture(t);
  const partial = { codex: makeSnapshot('codex', 30) };
  let stopped = 0;
  const result = await captureStdout(async () => {
    await assert.rejects(
      () => run(['once', '--root', cliFixture.root], {
        createServerAgentSupervisor: () => ({
          start: async () => {},
          waitForSnapshots: async () => {},
          getAllSnapshots: () => partial,
          getDiagnostics: () => ({ profiles: { 'codex-srj': { lastErrorCode: 'worker-failed' } } }),
          stop: async () => { stopped += 1; }
        })
      }),
      (error) => error?.code === 'snapshot_incomplete'
    );
  });
  assert.equal(result.output, '');
  assert.equal(stopped, 1);
});

test('once prints JSON only after every enabled profile has a valid snapshot', async (t) => {
  const cliFixture = createCliFixture(t);
  const complete = { codex: makeSnapshot('codex', 30), 'codex-srj': makeSnapshot('codex-srj', 51) };
  let stopped = 0;
  const result = await captureStdout(() => run(['once', '--root', cliFixture.root], {
    createServerAgentSupervisor: () => ({
      start: async () => {},
      waitForSnapshots: async () => {},
      getAllSnapshots: () => complete,
      stop: async () => { stopped += 1; }
    })
  }));
  assert.deepEqual(Object.keys(result.value).sort(), ['codex', 'codex-srj']);
  assert.deepEqual(Object.keys(JSON.parse(result.output)).sort(), ['codex', 'codex-srj']);
  assert.equal(stopped, 1);
});
