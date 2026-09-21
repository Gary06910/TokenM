'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  androidApiOrigin,
  createAndroidClient,
  credentialDesktopId
} = require('../shared/notification/androidClient');
const { buildAndroidCompletionPayload } = require('../shared/notification/androidPayload');
const { createAndroidOutbox } = require('../shared/notification/androidOutbox');
const { createCodexHookBridge } = require('../shared/notification/codexHookBridge');
const { readRegularFileNoFollow, writePrivateJsonAtomic } = require('../shared/credentialStore');
const { normalizeProfileId } = require('./config');

const CREDENTIAL_VERSION = 1;
const MAX_CREDENTIAL_BYTES = 16 * 1024;
const DESKTOP_ID_RE = /^dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeCode(error, fallback = 'notification_error') {
  const code = String(error?.code || fallback);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : fallback;
}

function safeName(value) {
  const name = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
    : '';
  return name && Array.from(name).length <= 80 ? name : '';
}

function loadServerCredential(filePath) {
  let raw;
  try {
    raw = readRegularFileNoFollow(filePath, {
      description: 'Server notification credential',
      encoding: 'utf8',
      maxBytes: MAX_CREDENTIAL_BYTES,
      mode: 0o600
    });
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'unconfigured', credential: null };
    throw codedError('invalid_credential');
  }
  let value;
  try { value = JSON.parse(raw); } catch (_) { throw codedError('invalid_credential'); }
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== CREDENTIAL_VERSION
    || typeof value.credential !== 'string'
    || !DESKTOP_ID_RE.test(value.desktopId || '')
    || credentialDesktopId(value.credential) !== value.desktopId
    || !safeName(value.desktopName)
  ) {
    throw codedError('invalid_credential');
  }
  return {
    state: 'configured',
    credential: value.credential,
    desktopId: value.desktopId,
    desktopName: safeName(value.desktopName)
  };
}

function safeQueueSnapshot(outbox) {
  if (!outbox) return { pending: 0, blocked: 0, failed: 0, total: 0, paused: false, pausedReason: null, lastError: null };
  try {
    const snapshot = outbox.snapshot();
    return {
      pending: Number.isSafeInteger(snapshot.pending) && snapshot.pending >= 0 ? snapshot.pending : 0,
      blocked: Number.isSafeInteger(snapshot.blocked) && snapshot.blocked >= 0 ? snapshot.blocked : 0,
      failed: Number.isSafeInteger(snapshot.failed) && snapshot.failed >= 0 ? snapshot.failed : 0,
      total: Number.isSafeInteger(snapshot.total) && snapshot.total >= 0 ? snapshot.total : 0,
      paused: snapshot.paused === true,
      pausedReason: typeof snapshot.pausedReason === 'string' ? snapshot.pausedReason : null,
      lastError: typeof snapshot.lastError === 'string' ? snapshot.lastError : null
    };
  } catch (error) {
    return { pending: 0, blocked: 0, failed: 0, total: 0, paused: true, pausedReason: 'invalid_outbox', lastError: safeCode(error, 'invalid_outbox') };
  }
}

function createServerNotificationRuntime(options = {}, deps = {}) {
  const { config, paths, logger = {}, fetch = globalThis.fetch, now = Date.now, outboxOptions = {} } = options;
  if (!config || !paths) throw new TypeError('config and paths are required');
  if (typeof fetch !== 'function') throw new TypeError('fetch is required');
  const makeClient = deps.createAndroidClient || createAndroidClient;
  const makeOutbox = deps.createAndroidOutbox || createAndroidOutbox;
  const makeBridge = deps.createCodexHookBridge || createCodexHookBridge;
  const randomBytes = deps.randomBytes || crypto.randomBytes;
  const profileMap = new Map(config.profiles.map((profile) => [profile.id, profile]));
  let client = null;
  let outbox = null;
  let bridge = null;
  let running = false;
  let state = 'unconfigured';
  let lastError = null;
  let current = null;

  function notificationRuntimePath() {
    return paths.notificationRuntimePath || path.join(paths.stateRoot, 'notification', 'hook-runtime.json');
  }

  function notificationOutboxPath(desktopId) {
    if (typeof paths.notificationOutboxPath === 'function') return paths.notificationOutboxPath(desktopId);
    if (!DESKTOP_ID_RE.test(desktopId || '')) return null;
    return path.join(paths.stateRoot, 'notification', `android-outbox-${desktopId}.json`);
  }

  function readConfiguration() {
    let credential;
    try {
      credential = loadServerCredential(paths.credentialFile);
    } catch (error) {
      return { state: 'invalid_credential', error: safeCode(error, 'invalid_credential') };
    }
    if (credential.state !== 'configured') return credential;
    const endpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : '';
    if (!endpoint) return { state: 'invalid_config', error: 'invalid_config', credential };
    let normalizedEndpoint;
    try { normalizedEndpoint = androidApiOrigin(endpoint); }
    catch (_) { return { state: 'invalid_config', error: 'invalid_config', credential }; }
    return { state: 'configured', endpoint: normalizedEndpoint, ...credential };
  }

  function publicStatus() {
    const queue = safeQueueSnapshot(outbox);
    const desktop = current?.desktopId && current?.desktopName
      ? { desktopId: current.desktopId, name: current.desktopName }
      : null;
    return {
      state,
      configured: state === 'ready' || state === 'degraded' || state === 'blocked',
      privacyMode: true,
      desktop,
      bridge: { running: Boolean(bridge), host: bridge ? '127.0.0.1' : null, port: bridge?.address()?.port || null },
      outbox: queue,
      error: lastError
    };
  }

  function profileFor(profileId) {
    if (typeof profileId !== 'string' || !profileId) throw codedError('missing_profile');
    let normalized;
    try { normalized = normalizeProfileId(profileId); } catch (_) { throw codedError('invalid_profile'); }
    const profile = profileMap.get(normalized);
    if (!profile) throw codedError('unknown_profile');
    if (!profile.enabled) throw codedError('profile_disabled');
    return profile;
  }

  function pauseForCredential(error) {
    state = 'blocked';
    lastError = safeCode(error, 'credential');
    try { outbox?.pause('credential'); } catch (_) {}
  }

  async function onCompletion(input, metadata = {}) {
    if (!running || !outbox || !current) throw codedError('notification_not_configured');
    const profile = profileFor(metadata.profileId);
    const payload = buildAndroidCompletionPayload({
      rawInput: input,
      desktopId: current.desktopId,
      profileId: profile.id,
      privacyMode: true,
      now
    });
    return outbox.enqueue(payload);
  }

  async function stopBridge() {
    const active = bridge;
    bridge = null;
    if (active) await active.stop();
    const runtimePath = notificationRuntimePath();
    try {
      const stat = fs.lstatSync(runtimePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('invalid_runtime');
      fs.unlinkSync(runtimePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async function startBridge() {
    const token = randomBytes(32).toString('base64url');
    const instance = makeBridge({
      host: '127.0.0.1',
      port: 0,
      token,
      logger,
      onCompletion
    });
    const address = await instance.start();
    try {
      writePrivateJsonAtomic(notificationRuntimePath(), {
        version: 1,
        host: '127.0.0.1',
        port: address.port,
        token
      });
      bridge = instance;
    } catch (error) {
      await instance.stop();
      throw error;
    }
  }

  async function stop() {
    running = false;
    const activeOutbox = outbox;
    outbox = null;
    client = null;
    try { await stopBridge(); } finally {
      if (activeOutbox) await activeOutbox.stop();
    }
    return publicStatus();
  }

  async function start() {
    await stop();
    current = null;
    lastError = null;
    const configuration = readConfiguration();
    if (configuration.state !== 'configured') {
      state = configuration.state;
      lastError = configuration.error || null;
      return publicStatus();
    }
    try {
      const outboxPath = notificationOutboxPath(configuration.desktopId);
      if (!outboxPath) throw codedError('invalid_credential');
      client = makeClient({
        baseUrl: configuration.endpoint,
        credential: configuration.credential,
        fetch,
        timeoutMs: 5_000
      });
      outbox = makeOutbox({
        ...outboxOptions,
        filePath: outboxPath,
        send: (payload) => client.sendEvent(payload),
        onDeliveryFailure: ({ error, outcome }) => {
          if (outcome?.kind === 'credential') pauseForCredential(error);
        },
        logger
      });
      outbox.load();
      await outbox.start();
      current = {
        desktopId: configuration.desktopId,
        desktopName: configuration.desktopName,
        endpoint: configuration.endpoint
      };
      running = true;
      await startBridge();
      state = 'ready';
    } catch (error) {
      state = error?.code === 'invalid_credential' || error?.code === 'invalid_outbox'
        ? 'invalid_credential'
        : 'degraded';
      lastError = safeCode(error, state === 'degraded' ? 'bridge_start_failed' : 'invalid_credential');
      try { await stop(); } catch (_) {}
      if (state === 'invalid_credential') current = null;
    }
    return publicStatus();
  }

  return {
    get outboxPath() { return current ? notificationOutboxPath(current.desktopId) : null; },
    get runtimePath() { return notificationRuntimePath(); },
    configuration: readConfiguration,
    publicStatus,
    start,
    stop,
    flush() { return outbox ? outbox.flush() : Promise.resolve(publicStatus()); },
    enqueue(input, profileId) { return onCompletion(input, { profileId }); },
    profileFor,
    shutdownSync() {
      running = false;
      const active = bridge;
      bridge = null;
      if (active) void active.stop();
      try {
        const stat = fs.lstatSync(notificationRuntimePath());
        if (!stat.isSymbolicLink() && stat.isFile()) fs.unlinkSync(notificationRuntimePath());
      } catch (_) {}
      const activeOutbox = outbox;
      outbox = null;
      client = null;
      if (activeOutbox) void activeOutbox.stop();
    }
  };
}

module.exports = {
  CREDENTIAL_VERSION,
  MAX_CREDENTIAL_BYTES,
  createServerNotificationRuntime,
  loadServerCredential
};
