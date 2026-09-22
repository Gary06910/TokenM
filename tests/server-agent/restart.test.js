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
  WORKER_RESTART_INITIAL_MS,
  WORKER_RESTART_MAX_MS
} = require('../../src/server-agent/supervisor');
const {
  errorMessage,
  readyMessage,
  snapshotMessage,
  stoppedMessage,
  MESSAGE_TYPES
} = require('../../src/server-agent/protocol');
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

  return { advance, clearTimeout: clearTimeoutFake, setTimeout: setTimeoutFake };
}

class FakeWorker extends EventEmitter {
  constructor(profileId, generation) {
    super();
    this.profileId = profileId;
    this.generation = generation;
    this.connected = true;
    this.exited = false;
  }

  send(message) {
    if (message?.type !== MESSAGE_TYPES.STOP) return;
    this.connected = false;
    this.emit('message', stoppedMessage(this.profileId));
    this.exit(0, null);
  }

  kill() {
    this.connected = false;
    this.exit(null, 'SIGTERM');
  }

  exit(code, signal) {
    if (this.exited) return;
    this.exited = true;
    this.emit('exit', code, signal);
  }

  crash(code = 1, signal = null) {
    this.connected = false;
    this.exit(code, signal);
  }
}

function makeSnapshot(profileId, tokens = 1) {
  return serializeServerSnapshot({
    updatedAt: '2026-09-23T00:00:00.000Z',
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

function createFixture({ profileIds = ['codex'], forkPlan, onSnapshot, onDiagnostic, onError } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-server-agent-restart-'));
  const paths = createServerAgentPaths({ root });
  const profiles = profileIds.map((id) => {
    const codexHome = path.join(root, id);
    fs.mkdirSync(codexHome, { recursive: true });
    return { id, name: id, codexHome, enabled: true };
  });
  const config = parseServerAgentConfig({ version: 1, profiles });
  const clock = createFakeClock();
  const children = [];
  const notificationCalls = [];
  const usageCalls = [];
  let forkCalls = 0;

  const supervisor = createServerAgentSupervisor({
    config,
    paths,
    once: false,
    pidFile: false,
    platform: 'linux-x64',
    startTimeoutMs: 5_000,
    stopTimeoutMs: 1_000,
    snapshotTimeoutMs: 100_000,
    onSnapshot,
    onDiagnostic,
    onError
  }, {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createNotificationRuntime: () => ({
      start: async () => {
        notificationCalls.push('start');
        return { state: 'ready' };
      },
      stop: async () => {
        notificationCalls.push('stop');
        return { state: 'stopped' };
      },
      status: () => ({ state: 'ready' })
    }),
    createUsageSyncRuntime: () => ({
      start: async () => {
        usageCalls.push('start');
        return { state: 'ready' };
      },
      stop: async () => {
        usageCalls.push('stop');
        return { state: 'stopped' };
      },
      accept: (profileId, snapshot) => usageCalls.push({ profileId, snapshot }),
      status: () => ({ state: 'ready' })
    }),
    fork: (_workerPath, _args, forkOptions) => {
      forkCalls += 1;
      const profileId = forkOptions.env.TO_KNOW_PROFILE_ID;
      const plan = typeof forkPlan === 'function' ? forkPlan({ forkCalls, profileId }) : undefined;
      if (plan?.throw) throw Object.assign(new Error('spawn failed'), { code: 'EAGAIN' });
      const child = new FakeWorker(profileId, forkCalls);
      children.push({ child, profileId, env: forkOptions.env });
      return child;
    }
  });

  return { children, clock, forkCalls: () => forkCalls, notificationCalls, paths, supervisor, usageCalls };
}

async function startFixture(fixture) {
  const starting = fixture.supervisor.start();
  await settle();
  for (const entry of fixture.children) entry.child.emit('message', readyMessage(entry.profileId));
  await settle();
  await starting;
}

function publishSnapshot(entry, tokens = 1) {
  entry.child.emit('message', snapshotMessage(entry.profileId, makeSnapshot(entry.profileId, tokens)));
}

test('unexpected exit, including exit code 0, schedules an independent 1s restart', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);

  fixture.children[0].child.crash(0);
  assert.deepEqual(fixture.supervisor.getDiagnostics().profiles.codex, {
    state: 'failed',
    ready: true,
    stopped: false,
    exited: true,
    exitCode: 0,
    signal: null,
    lastErrorCode: 'worker-exited',
    lastSnapshotAt: null,
    restartCount: 1,
    restartPending: true,
    diagnostics: [{ stage: 'process', code: 'worker-exited' }]
  });

  fixture.clock.advance(WORKER_RESTART_INITIAL_MS - 1);
  assert.equal(fixture.children.length, 1);
  fixture.clock.advance(1);
  assert.equal(fixture.children.length, 2);
  assert.equal(fixture.children[1].profileId, 'codex');
});

test('consecutive failures use exponential backoff and cap at 30 seconds', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);

  const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
  for (const [index, delay] of delays.entries()) {
    fixture.children.at(-1).child.crash(1);
    const diagnostics = fixture.supervisor.getDiagnostics().profiles.codex;
    assert.equal(diagnostics.restartCount, index + 1);
    assert.equal(diagnostics.restartPending, true);
    fixture.clock.advance(delay - 1);
    assert.equal(fixture.children.length, index + 1);
    fixture.clock.advance(1);
    assert.equal(fixture.children.length, index + 2);
  }
  assert.equal(WORKER_RESTART_MAX_MS, 30_000);
});

test('a valid snapshot resets backoff only after the restarted worker publishes it', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);

  fixture.children[0].child.emit('message', readyMessage('codex'));
  fixture.children[0].child.crash(1);
  fixture.clock.advance(WORKER_RESTART_INITIAL_MS);
  const restarted = fixture.children[1];
  restarted.child.emit('message', readyMessage('codex'));
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 1);
  publishSnapshot(restarted, 42);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 0);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartPending, false);

  restarted.child.crash(1);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 1);
});

test('profile failure is isolated while usage sync and notification runtimes remain active', async (t) => {
  const fixture = createFixture({ profileIds: ['codex', 'codex-srj'] });
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);
  publishSnapshot(fixture.children[0], 10);
  publishSnapshot(fixture.children[1], 20);

  const codexChild = fixture.children[0].child;
  fixture.children[1].child.crash(1);
  fixture.clock.advance(1_000);

  assert.equal(fixture.children.length, 3);
  assert.equal(fixture.children[0].child, codexChild);
  assert.equal(fixture.children[2].profileId, 'codex-srj');
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.state, 'running');
  assert.equal(fixture.supervisor.getDiagnostics().profiles['codex-srj'].restartCount, 1);
  assert.equal(fixture.supervisor.getDiagnostics().notification.state, 'ready');
  assert.equal(fixture.supervisor.getDiagnostics().usageSync.state, 'ready');
  assert.deepEqual(fixture.usageCalls.filter((item) => typeof item === 'object').map((item) => item.profileId), ['codex', 'codex-srj']);
  assert.deepEqual(fixture.notificationCalls, ['start']);
});

test('spawn failures enter the same bounded retry path without crashing the supervisor', async (t) => {
  const fixture = createFixture({ forkPlan: ({ forkCalls }) => ({ throw: forkCalls < 3 }) });
  t.after(() => fixture.supervisor.stop());
  await fixture.supervisor.start();

  assert.equal(fixture.forkCalls(), 1);
  assert.equal(fixture.supervisor.getDiagnostics().state, 'running');
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 1);
  fixture.clock.advance(1_000);
  assert.equal(fixture.forkCalls(), 2);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 2);
  fixture.clock.advance(2_000);
  assert.equal(fixture.forkCalls(), 3);
  assert.equal(fixture.children.length, 1);
  fixture.children[0].child.emit('message', readyMessage('codex'));
  publishSnapshot(fixture.children[0], 7);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 0);
});

test('an error followed by exit schedules only one restart', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);

  const original = fixture.children[0].child;
  original.emit('error', new Error('private process detail'));
  original.emit('exit', 1, null);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 1);
  fixture.clock.advance(1_000);
  assert.equal(fixture.children.length, 2);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 1);
});

test('late events from an old generation cannot overwrite the replacement worker', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);

  const original = fixture.children[0].child;
  original.crash(1);
  fixture.clock.advance(1_000);
  const replacement = fixture.children[1];
  replacement.child.emit('message', readyMessage('codex'));
  publishSnapshot(replacement, 99);

  original.emit('message', snapshotMessage('codex', makeSnapshot('codex', 1)));
  original.emit('error', new Error('late old error'));
  original.emit('exit', 1, null);

  assert.equal(fixture.supervisor.getSnapshot('codex').today.totalTokens, 99);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.state, 'running');
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartCount, 0);
  assert.equal(fixture.children.length, 2);
});

test('stop cancels pending restarts and never respawns during shutdown', async (t) => {
  const fixture = createFixture();
  await startFixture(fixture);
  fixture.children[0].child.crash(1);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartPending, true);

  await fixture.supervisor.stop();
  fixture.clock.advance(WORKER_RESTART_MAX_MS * 2);
  assert.equal(fixture.children.length, 1);
  assert.equal(fixture.supervisor.getDiagnostics().state, 'stopped');
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartPending, false);
  t.after(() => fixture.supervisor.stop());
});

test('worker error diagnostics stay at safe stage/code fields', async (t) => {
  const diagnostics = [];
  const errors = [];
  const fixture = createFixture({
    onDiagnostic: (item) => diagnostics.push(item),
    onError: (item) => errors.push(item)
  });
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);
  fixture.children[0].child.emit('error', new Error('CODEX_HOME=/private/secret prompt=do-not-log'));
  assert.deepEqual(diagnostics, [{ profileId: 'codex', stage: 'process', code: 'worker-process-error' }]);
  assert.deepEqual(errors, [{ profileId: 'codex', stage: 'process', code: 'worker-process-error' }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /CODEX_HOME|private|prompt|secret/i);
});

test('worker error messages remain compatible with the normal failure path', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.supervisor.stop());
  await startFixture(fixture);
  fixture.children[0].child.emit('message', errorMessage('codex', 'collector-failed', 'collector'));
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.lastErrorCode, 'collector-failed');
  fixture.children[0].child.emit('message', stoppedMessage('codex'));
  fixture.children[0].child.crash(0);
  assert.equal(fixture.supervisor.getDiagnostics().profiles.codex.restartPending, false);
});
