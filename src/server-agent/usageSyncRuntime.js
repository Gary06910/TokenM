'use strict';

const { createAndroidClient } = require('../shared/notification/androidClient');
const { loadServerCredential } = require('./notificationRuntime');
const { validateServerSnapshot } = require('./snapshot');
const MIN_SYNC_INTERVAL_MS = 60000;
const RETRY_INITIAL_MS = 5000;
const RETRY_MAX_MS = 300000;

function createUsageSyncRuntime(options = {}, deps = {}) {
  const now = deps.now || Date.now;
  const schedule = deps.setTimeout || setTimeout;
  const cancel = deps.clearTimeout || clearTimeout;
  const lanes = new Map();
  let state = 'unconfigured';
  let client;
  function status() { return { state }; }
  function start() {
    if (state === 'stopped' || state === 'ready' || state === 'paused_credential') return status();
    if (options.once) { state = 'skipped_once'; return status(); }
    try {
      if (!options.config?.endpoint) return status();
      const credential = (deps.loadCredential || loadServerCredential)(options.paths?.credentialFile);
      if (credential.state !== 'configured') return status();
      client = (deps.createClient || createAndroidClient)({ baseUrl: options.config.endpoint, credential: credential.credential, fetch: options.fetch });
      state = 'ready';
    } catch (_) { state = 'unconfigured'; }
    return status();
  }
  function arm(lane) {
    if (state !== 'ready' || lane.inflight || lane.timer || !lane.pending) return;
    const delay = Math.max(0, lane.nextAt - now());
    if (!delay) { send(lane); return; }
    lane.timer = schedule(() => { lane.timer = null; arm(lane); }, delay);
    lane.timer?.unref?.();
  }
  function send(lane) {
    const snapshot = lane.pending;
    lane.pending = null;
    lane.nextAt = now() + MIN_SYNC_INTERVAL_MS;
    lane.inflight = Promise.resolve().then(() => client.putUsageSnapshot(snapshot)).then(() => {
      lane.failures = 0;
    }).catch((error) => {
      if (state === 'stopped') return;
      if (error.status === 401 || error.status === 403) {
        state = 'paused_credential';
        for (const current of lanes.values()) { if (current.timer) cancel(current.timer); current.timer = null; }
        return;
      }
      if (!error.status || [408, 425, 429].includes(error.status) || error.status >= 500) {
        lane.pending ||= snapshot;
        lane.failures++;
        lane.nextAt = Math.max(lane.nextAt, now() + Math.min(RETRY_MAX_MS, RETRY_INITIAL_MS * (2 ** Math.min(lane.failures - 1, 10))));
      }
    }).finally(() => { lane.inflight = null; arm(lane); });
  }
  function accept(profileId, snapshot) {
    if (state !== 'ready') return false;
    try {
      validateServerSnapshot(snapshot);
      if (snapshot.profile.id !== profileId || !options.config.profiles.some((p) => p.enabled && p.id === profileId)) throw Error();
    } catch (_) { options.onDiagnostic?.({ stage: 'usage_sync', code: 'invalid-snapshot' }); return false; }
    if (!lanes.has(profileId)) lanes.set(profileId, { pending: null, inflight: null, timer: null, nextAt: 0, failures: 0 });
    const lane = lanes.get(profileId);
    lane.pending = structuredClone(snapshot);
    arm(lane);
    return true;
  }
  async function stop() {
    state = 'stopped';
    for (const lane of lanes.values()) { if (lane.timer) cancel(lane.timer); lane.timer = null; lane.pending = null; }
    const active = [...lanes.values()].map((lane) => lane.inflight).filter(Boolean);
    if (active.length) {
      let timer;
      try { await Promise.race([Promise.allSettled(active), new Promise((resolve) => { timer = schedule(resolve, options.stopTimeoutMs || 2000); })]); }
      finally { if (timer) cancel(timer); }
    }
    return status();
  }
  return { start, accept, stop, status };
}
module.exports = { MIN_SYNC_INTERVAL_MS, RETRY_INITIAL_MS, RETRY_MAX_MS, createUsageSyncRuntime };
