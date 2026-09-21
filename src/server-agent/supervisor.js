'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { loadServerAgentConfig, parseServerAgentConfig } = require('./config');
const { createServerAgentPaths } = require('./paths');
const {
  MESSAGE_TYPES,
  stopMessage,
  validateWorkerMessage
} = require('./protocol');
const { validateServerSnapshot } = require('./snapshot');
const { createServerNotificationRuntime } = require('./notificationRuntime');

const DEFAULT_START_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;
const MAX_DIAGNOSTICS = 32;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function boundedString(value, fallback, maxLength = 256) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength && !/[\r\n\p{Cc}\p{Cf}]/u.test(normalized)
    ? normalized
    : fallback;
}

function safeEnvValue(value, fallback = '') {
  return boundedString(String(value ?? ''), fallback, 512);
}

function safeNotificationCode(error, fallback = 'notification_start_failed') {
  const code = String(error?.code || fallback);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : fallback;
}

function createServerAgentSupervisor(options = {}, deps = {}) {
  const config = options.config
    ? parseServerAgentConfig(options.config, options.configValidation || {})
    : loadServerAgentConfig(options.configPath, options.configValidation || {});
  const paths = options.paths || createServerAgentPaths(options.pathOptions || {});
  const forkWorker = deps.fork || fork;
  const workerPath = options.workerPath || path.join(__dirname, 'profileWorker.js');
  const inheritedEnv = { ...(options.env || process.env) };
  const startTimeoutMs = options.startTimeoutMs || DEFAULT_START_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs || DEFAULT_STOP_TIMEOUT_MS;
  const workers = new Map();
  const latestSnapshots = new Map();
  const makeNotificationRuntime = deps.createNotificationRuntime || createServerNotificationRuntime;
  let lifecycle = 'created';
  let startPromise = null;
  let stopPromise = null;
  let pidFileWritten = false;
  let notificationRuntime = null;
  let notificationStatus = { state: options.once === true ? 'skipped_once' : 'not_started' };

  function enabledProfiles() {
    return config.profiles.filter((profile) => profile.enabled);
  }

  function buildWorkerEnv(profile) {
    const profileStateDir = paths.profileStateDir(profile.id);
    const env = {
      ...inheritedEnv,
      CODEX_HOME: profile.codexHome,
      TOKEN_MONITOR_SHARED_DIR: profileStateDir,
      TOKEN_MONITOR_CLIENTS: 'codex',
      TOKEN_MONITOR_LIMITS_ENABLED: '0',
      TO_KNOW_PROFILE_ID: profile.id,
      TO_KNOW_PROFILE_NAME: profile.name,
      TO_KNOW_DEVICE_NAME: safeEnvValue(config.deviceName, 'To Know Server'),
      TO_KNOW_AGENT_VERSION: safeEnvValue(options.agentVersion || process.env.npm_package_version, '1.0.0'),
      TO_KNOW_SERVER_AGENT_ONCE: options.once === true ? '1' : '0',
      TO_KNOW_WATCH_ENABLED: options.watchEnabled === false ? '0' : '1',
      TO_KNOW_HISTORY_ENABLED: options.historyEnabled === false ? '0' : '1',
      TO_KNOW_PROJECTS_ENABLED: options.projectsEnabled === true ? '1' : '0'
    };
    if (options.platform) env.TO_KNOW_PLATFORM = safeEnvValue(options.platform, 'unknown');
    if (options.allTimeSince) env.TO_KNOW_ALL_TIME_SINCE = safeEnvValue(options.allTimeSince, '2024-01-01');
    if (options.commandTimeoutMs) env.TO_KNOW_TOKSCALE_TIMEOUT_MS = String(options.commandTimeoutMs);
    if (options.fixtureMode === true) env.TO_KNOW_SERVER_AGENT_TEST_FIXTURE = '1';
    else delete env.TO_KNOW_SERVER_AGENT_TEST_FIXTURE;
    return env;
  }

  function recordFor(profile) {
    return {
      profile,
      child: null,
      state: 'created',
      ready: false,
      stopped: false,
      exited: false,
      exitCode: null,
      signal: null,
      lastErrorCode: null,
      lastSnapshotAt: null,
      diagnostics: []
    };
  }

  function recordDiagnostic(record, stage, code) {
    const item = { stage: boundedString(stage, 'runtime', 32), code: boundedString(code, 'unknown', 64) };
    record.diagnostics.push(item);
    if (record.diagnostics.length > MAX_DIAGNOSTICS) record.diagnostics.shift();
    options.onDiagnostic?.({ profileId: record.profile.id, ...item });
  }

  function handleWorkerMessage(record, message) {
    if (!validateWorkerMessage(message) || message.profileId !== record.profile.id) {
      recordDiagnostic(record, 'ipc', 'invalid-message');
      return;
    }
    switch (message.type) {
      case MESSAGE_TYPES.READY:
        if (message.clients !== 'codex') {
          record.lastErrorCode = 'non-codex-client-list';
          recordDiagnostic(record, 'protocol', record.lastErrorCode);
          return;
        }
        record.ready = true;
        record.state = 'ready';
        break;
      case MESSAGE_TYPES.SNAPSHOT:
        try {
          validateServerSnapshot(message.snapshot);
          latestSnapshots.set(record.profile.id, clone(message.snapshot));
          record.lastSnapshotAt = new Date().toISOString();
          record.state = 'running';
          options.onSnapshot?.(record.profile.id, clone(message.snapshot));
        } catch (error) {
          record.lastErrorCode = error.code || 'invalid-snapshot';
          recordDiagnostic(record, 'snapshot', record.lastErrorCode);
        }
        break;
      case MESSAGE_TYPES.DIAGNOSTIC:
        recordDiagnostic(record, message.stage, message.code);
        break;
      case MESSAGE_TYPES.ERROR:
        record.lastErrorCode = message.code;
        record.state = 'failed';
        recordDiagnostic(record, message.stage, message.code);
        options.onError?.({ profileId: record.profile.id, stage: message.stage, code: message.code });
        break;
      case MESSAGE_TYPES.STOPPED:
        record.stopped = true;
        record.state = 'stopped';
        break;
      default:
        break;
    }
  }

  function handleWorkerExit(record, code, signal) {
    record.exited = true;
    record.exitCode = code;
    record.signal = signal;
    record.child = null;
    if (lifecycle !== 'stopping' && lifecycle !== 'stopped') {
      record.state = code === 0 ? 'stopped' : 'failed';
      if (code !== 0 && !record.lastErrorCode) {
        record.lastErrorCode = 'worker-exited';
        recordDiagnostic(record, 'process', record.lastErrorCode);
      }
    } else {
      record.state = 'stopped';
    }
  }

  function spawnWorker(profile) {
    const record = recordFor(profile);
    workers.set(profile.id, record);
    fs.mkdirSync(paths.profileStateDir(profile.id), { recursive: true });
    const child = forkWorker(workerPath, [], {
      env: buildWorkerEnv(profile),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true
    });
    record.child = child;
    record.state = 'starting';
    child.on('message', (message) => handleWorkerMessage(record, message));
    child.on('error', (error) => {
      // Preserve the first safe worker failure. A later IPC error can be a
      // consequence of the worker already disconnecting during graceful stop.
      if (!record.lastErrorCode) {
        record.lastErrorCode = 'worker-process-error';
        recordDiagnostic(record, 'process', record.lastErrorCode);
        options.onError?.({ profileId: profile.id, stage: 'process', code: record.lastErrorCode });
      }
      if (typeof error?.message !== 'string') return;
    });
    child.on('exit', (code, signal) => handleWorkerExit(record, code, signal));
    return record;
  }

  function writeSupervisorPid() {
    if (options.pidFile === false) return;
    fs.mkdirSync(path.dirname(paths.supervisorPidPath), { recursive: true });
    fs.writeFileSync(paths.supervisorPidPath, String(process.pid), 'utf8');
    pidFileWritten = true;
  }

  function removeSupervisorPid() {
    if (!pidFileWritten) return;
    try { fs.unlinkSync(paths.supervisorPidPath); } catch (_) {}
    pidFileWritten = false;
  }

  async function startNotificationRuntime() {
    if (options.once === true) return;
    try {
      notificationRuntime = makeNotificationRuntime({
        config,
        paths,
        fetch: options.fetch,
        logger: { warn: (message, details) => options.onDiagnostic?.({ stage: 'notification', code: safeNotificationCode(details) }) }
      }, deps.notificationDeps || {});
      notificationStatus = await notificationRuntime.start();
    } catch (error) {
      notificationRuntime = null;
      notificationStatus = { state: 'degraded', configured: false, error: safeNotificationCode(error) };
      options.onDiagnostic?.({ stage: 'notification', code: notificationStatus.error });
    }
  }

  async function stopNotificationRuntime() {
    if (!notificationRuntime) return;
    try {
      notificationStatus = await notificationRuntime.stop();
    } catch (error) {
      notificationStatus = {
        ...(notificationStatus || {}),
        state: 'degraded',
        error: safeNotificationCode(error, 'notification_stop_failed')
      };
      options.onDiagnostic?.({ stage: 'notification', code: notificationStatus.error });
    }
    notificationRuntime = null;
  }

  function waitForStart() {
    const records = [...workers.values()];
    if (records.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const deadline = setTimeout(resolve, startTimeoutMs);
      const check = () => {
        if (records.every((record) => record.ready || record.exited || record.lastErrorCode)) {
          clearTimeout(deadline);
          resolve();
        }
      };
      for (const record of records) {
        const child = record.child;
        child?.on('message', check);
        child?.on('exit', check);
        child?.on('error', check);
      }
      check();
    });
  }

  async function start() {
    if (startPromise) return startPromise;
    if (lifecycle === 'stopping' || lifecycle === 'stopped') throw new Error('server-agent supervisor is stopped');
    lifecycle = 'starting';
    startPromise = (async () => {
      writeSupervisorPid();
      await startNotificationRuntime();
      for (const profile of enabledProfiles()) spawnWorker(profile);
      await waitForStart();
      if (lifecycle !== 'stopping') lifecycle = 'running';
      return getDiagnostics();
    })();
    return startPromise;
  }

  function waitForSnapshots(timeoutMs = startTimeoutMs) {
    const expected = enabledProfiles().map((profile) => profile.id);
    if (expected.length === 0 || expected.every((id) => latestSnapshots.has(id) || workers.get(id)?.lastErrorCode)) {
      return Promise.resolve(getAllSnapshots());
    }
    return new Promise((resolve) => {
      const deadline = setTimeout(() => resolve(getAllSnapshots()), timeoutMs);
      const check = () => {
        if (expected.every((id) => latestSnapshots.has(id) || workers.get(id)?.lastErrorCode)) {
          clearTimeout(deadline);
          resolve(getAllSnapshots());
        }
      };
      for (const record of workers.values()) {
        record.child?.on('message', check);
        record.child?.on('exit', check);
      }
      check();
    });
  }

  function waitForExit(record) {
    if (!record.child || record.exited) return Promise.resolve();
    return new Promise((resolve) => {
      const child = record.child;
      const timer = setTimeout(() => {
        if (!record.exited) {
          try { child.kill(); } catch (_) {}
        }
        resolve();
      }, stopTimeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      lifecycle = 'stopping';
      await stopNotificationRuntime();
      const records = [...workers.values()];
      for (const record of records) {
        if (!record.child || record.exited) continue;
        try {
          if (record.child.connected) record.child.send(stopMessage(record.profile.id));
        } catch (_) {}
      }
      await Promise.all(records.map(waitForExit));
      removeSupervisorPid();
      lifecycle = 'stopped';
      return getDiagnostics();
    })();
    return stopPromise;
  }

  function getSnapshot(profileId) {
    return clone(latestSnapshots.get(profileId) || null);
  }

  function getAllSnapshots() {
    return Object.fromEntries([...latestSnapshots.entries()].map(([id, snapshot]) => [id, clone(snapshot)]));
  }

  function getDiagnostics() {
    const profiles = {};
    for (const [id, record] of workers.entries()) {
      profiles[id] = {
        state: record.state,
        ready: record.ready,
        stopped: record.stopped,
        exited: record.exited,
        exitCode: record.exitCode,
        signal: record.signal,
        lastErrorCode: record.lastErrorCode,
        lastSnapshotAt: record.lastSnapshotAt,
        diagnostics: clone(record.diagnostics)
      };
    }
    return {
      state: lifecycle,
      workerModel: 'child_process',
      clientList: 'codex',
      profileCount: enabledProfiles().length,
      notification: clone(notificationStatus),
      profiles
    };
  }

  return {
    config,
    paths,
    start,
    stop,
    waitForSnapshots,
    getSnapshot,
    getAllSnapshots,
    getDiagnostics,
    getNotificationStatus: () => clone(notificationStatus),
    _buildWorkerEnv: buildWorkerEnv
  };
}

module.exports = {
  DEFAULT_START_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
  createServerAgentSupervisor
};
