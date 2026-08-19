'use strict';

const { readRegularFileNoFollow, writePrivateJsonAtomic } = require('../shared/credentialStore');
const { validateWeChatCompletionPayload } = require('./wechatPayload');

const VERSION = 1;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 15 * 60 * 1_000;
const MAX_ITEMS = 1_000;
const MAX_ATTEMPTS = 20;

function timestamp(value) {
  const result = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(result)) throw new TypeError('now() must return a finite timestamp');
  return result;
}

function responseStatus(value, error) {
  const candidate = error?.status ?? value?.status;
  return Number.isInteger(candidate) ? candidate : null;
}

function classifyWeChatDelivery(value, error) {
  const status = responseStatus(value, error);
  if (!error && (status === null || (status >= 200 && status < 300))) return { kind: 'success', status };
  if (status === 401 || status === 403) return { kind: 'credential', status };
  if ([400, 404, 409, 413, 422].includes(status)) return { kind: 'terminal', status };
  if ([408, 425, 429, 500, 502, 503, 504].includes(status) || status === null || status >= 500) {
    return { kind: 'retry', status };
  }
  return { kind: 'terminal', status };
}

function safeErrorCode(error, status) {
  const code = String(error?.code || (status ? `http_${status}` : 'network_error'));
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'network_error';
}

function normalizeDocument(value) {
  if (!value || typeof value !== 'object' || value.version !== VERSION || !Array.isArray(value.items)) {
    throw new Error('Unsupported WeChat outbox document');
  }
  if (value.items.length > MAX_ITEMS) throw new Error('WeChat outbox is too large');
  const eventIds = new Set();
  return {
    version: VERSION,
    items: value.items.map((item) => {
      const payload = validateWeChatCompletionPayload(item.payload);
      if (eventIds.has(payload.eventId)) throw new Error('WeChat outbox contains duplicate event ids');
      eventIds.add(payload.eventId);
      return {
        payload,
        attemptCount: Number.isSafeInteger(item.attemptCount) && item.attemptCount >= 0 ? item.attemptCount : 0,
        nextAttemptAt: Number.isFinite(item.nextAttemptAt) ? item.nextAttemptAt : 0,
        lastError: typeof item.lastError === 'string' ? item.lastError.slice(0, 80) : null,
        suspended: ['credential', 'terminal'].includes(item.suspended) ? item.suspended : null
      };
    })
  };
}

function createWeChatOutbox({
  filePath,
  send,
  now = Date.now,
  random = Math.random,
  logger = {},
  maxAttempts = MAX_ATTEMPTS
}) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('filePath is required');
  if (typeof send !== 'function') throw new TypeError('send is required');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    throw new TypeError(`maxAttempts must be between 1 and ${MAX_ATTEMPTS}`);
  }
  let document = { version: VERSION, items: [] };
  let loaded = false;
  let running = false;
  let timer = null;
  let lane = Promise.resolve();

  function currentTime() { return timestamp(now()); }

  function load() {
    if (loaded) return;
    try {
      const raw = readRegularFileNoFollow(filePath, {
        description: 'WeChat notification outbox',
        encoding: 'utf8',
        maxBytes: 8 * 1024 * 1024,
        mode: 0o600
      });
      document = normalizeDocument(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    loaded = true;
  }

  function persist() { writePrivateJsonAtomic(filePath, document); }

  function snapshot() {
    const firstError = document.items.find((item) => item.lastError)?.lastError || null;
    return {
      pending: document.items.length,
      lastError: firstError,
      items: document.items.map((item) => ({
        eventId: item.payload.eventId,
        attemptCount: item.attemptCount,
        nextAttemptAt: item.nextAttemptAt,
        lastError: item.lastError,
        suspended: item.suspended
      }))
    };
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (!running) return;
    const eligible = document.items.filter((item) => !item.suspended);
    if (!eligible.length) return;
    const earliest = Math.min(...eligible.map((item) => item.nextAttemptAt));
    timer = setTimeout(() => {
      timer = null;
      api.flush().catch((error) => logger.warn?.('WeChat outbox flush failed', { code: safeErrorCode(error) }));
    }, Math.max(0, earliest - currentTime()));
    timer.unref?.();
  }

  async function flushDue() {
    load();
    const attempted = new Set();
    while (true) {
      const index = document.items.findIndex((item) => (
        !item.suspended && !attempted.has(item.payload.eventId) && item.nextAttemptAt <= currentTime()
      ));
      if (index < 0) break;
      const item = document.items[index];
      attempted.add(item.payload.eventId);
      let result;
      let failure;
      try { result = await send(validateWeChatCompletionPayload(item.payload)); }
      catch (error) { failure = error; }
      const outcome = classifyWeChatDelivery(result, failure);
      if (outcome.kind === 'success') {
        document.items.splice(index, 1);
      } else {
        item.attemptCount += 1;
        item.lastError = safeErrorCode(failure, outcome.status);
        if (outcome.kind === 'retry' && item.attemptCount < maxAttempts) {
          const nominal = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** Math.min(20, item.attemptCount - 1)));
          const randomValue = Number(random());
          const bounded = Number.isFinite(randomValue) ? Math.max(0, Math.min(1, randomValue)) : 0.5;
          item.nextAttemptAt = currentTime() + Math.round(nominal * bounded);
        } else {
          item.suspended = outcome.kind;
          if (outcome.kind === 'retry') {
            item.suspended = 'terminal';
            item.lastError = 'retry_exhausted';
          }
        }
      }
      persist();
    }
    schedule();
    return snapshot();
  }

  const api = {
    enqueue(payload) {
      lane = lane.then(() => {
        load();
        const clean = validateWeChatCompletionPayload(payload);
        if (!document.items.some((item) => item.payload.eventId === clean.eventId)) {
          if (document.items.length >= MAX_ITEMS) throw new Error('WeChat outbox is full');
          document.items.push({
            payload: clean,
            attemptCount: 0,
            nextAttemptAt: currentTime(),
            lastError: null,
            suspended: null
          });
          persist();
        }
        schedule();
        return snapshot();
      });
      return lane;
    },
    start() {
      running = true;
      lane = lane.then(() => { load(); schedule(); return snapshot(); });
      return lane;
    },
    flush() {
      lane = lane.then(flushDue);
      return lane;
    },
    stop() {
      running = false;
      clearTimer();
      return lane;
    },
    snapshot() { load(); return snapshot(); }
  };
  return api;
}

module.exports = {
  MAX_ATTEMPTS,
  classifyWeChatDelivery,
  createWeChatOutbox
};
