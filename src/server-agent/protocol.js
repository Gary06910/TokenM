'use strict';

const { PROFILE_ID_RE } = require('./config');

const MESSAGE_TYPES = Object.freeze({
  READY: 'worker.ready',
  SNAPSHOT: 'worker.snapshot',
  DIAGNOSTIC: 'worker.diagnostic',
  ERROR: 'worker.error',
  STOP: 'worker.stop',
  STOPPED: 'worker.stopped'
});

const SAFE_CODE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SAFE_STAGE_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

function isSafeProfileId(value) {
  return typeof value === 'string' && PROFILE_ID_RE.test(value);
}

function safeCode(value, fallback = 'unknown') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return SAFE_CODE_RE.test(normalized) ? normalized : fallback;
}

function safeStage(value, fallback = 'runtime') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return SAFE_STAGE_RE.test(normalized) ? normalized : fallback;
}

function baseMessage(type, profileId) {
  if (!Object.values(MESSAGE_TYPES).includes(type)) throw new TypeError(`unknown worker message type: ${type}`);
  if (!isSafeProfileId(profileId)) throw new TypeError('worker message profileId is invalid');
  return { type, profileId };
}

function readyMessage(profileId) {
  return { ...baseMessage(MESSAGE_TYPES.READY, profileId), clients: 'codex' };
}

function snapshotMessage(profileId, snapshot) {
  return { ...baseMessage(MESSAGE_TYPES.SNAPSHOT, profileId), snapshot };
}

function diagnosticMessage(profileId, stage, code) {
  return {
    ...baseMessage(MESSAGE_TYPES.DIAGNOSTIC, profileId),
    stage: safeStage(stage),
    code: safeCode(code)
  };
}

function errorMessage(profileId, code, stage = 'runtime') {
  return {
    ...baseMessage(MESSAGE_TYPES.ERROR, profileId),
    stage: safeStage(stage),
    code: safeCode(code)
  };
}

function stoppedMessage(profileId) {
  return baseMessage(MESSAGE_TYPES.STOPPED, profileId);
}

function stopMessage(profileId) {
  return baseMessage(MESSAGE_TYPES.STOP, profileId);
}

function validateWorkerMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  if (!Object.values(MESSAGE_TYPES).includes(message.type) || !isSafeProfileId(message.profileId)) return false;
  if (message.type === MESSAGE_TYPES.READY) return message.clients === undefined || message.clients === 'codex';
  if (message.type === MESSAGE_TYPES.SNAPSHOT) return Boolean(message.snapshot && typeof message.snapshot === 'object');
  if (message.type === MESSAGE_TYPES.DIAGNOSTIC || message.type === MESSAGE_TYPES.ERROR) {
    return SAFE_STAGE_RE.test(String(message.stage || '')) && SAFE_CODE_RE.test(String(message.code || ''));
  }
  return true;
}

module.exports = {
  MESSAGE_TYPES,
  diagnosticMessage,
  errorMessage,
  readyMessage,
  snapshotMessage,
  stopMessage,
  stoppedMessage,
  validateWorkerMessage
};
