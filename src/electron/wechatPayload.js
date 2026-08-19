'use strict';

const path = require('node:path');

const EVENT = 'codex.task.completed';
const ID_RE = /^[^\u0000-\u001f\u007f-\u009f]{1,128}$/;
const DESKTOP_ID_RE = /^dev_[A-Za-z0-9_-]{22}$/;

function cleanId(value, name) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!ID_RE.test(result)) throw new TypeError(`${name} is invalid`);
  return result;
}

function cleanText(value, limit) {
  if (value === undefined || value === null) return null;
  const singleLine = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/[\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!singleLine) return null;
  return Array.from(singleLine).slice(0, limit).join('');
}

function projectFromInput(input, fallback) {
  const cwd = typeof input?.cwd === 'string' ? input.cwd.trim().replace(/[\\/]+$/, '') : '';
  if (!cwd) return cleanText(fallback, 80);
  const windows = path.win32.basename(cwd);
  const basename = windows === cwd ? path.posix.basename(cwd) : windows;
  return cleanText(basename, 80);
}

function modelFromInput(input) {
  return cleanText(
    input?.model
      ?? input?.model_name
      ?? input?.modelName
      ?? input?.metadata?.model,
    80
  );
}

function summaryFromInput(input) {
  return cleanText(input?.last_assistant_message ?? input?.lastAssistantMessage, 600);
}

function duration(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('durationMs is invalid');
  return value;
}

function occurredAt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('occurredAt is invalid');
  return date.toISOString();
}

function buildWeChatCompletionPayload({ completion, desktopId, privacyMode = true, rawInput = null }) {
  if (!completion || typeof completion !== 'object' || Array.isArray(completion)) {
    throw new TypeError('completion is required');
  }
  if (!DESKTOP_ID_RE.test(desktopId || '')) throw new TypeError('desktopId is invalid');
  const payload = {
    schemaVersion: 1,
    eventId: cleanId(completion.eventId, 'eventId'),
    event: EVENT,
    desktopId,
    occurredAt: occurredAt(completion.occurredAt),
    privacyMode: privacyMode !== false,
    sessionId: cleanId(completion.sessionId, 'sessionId'),
    project: null,
    model: null,
    summary: null,
    durationMs: null
  };
  if (!payload.privacyMode) {
    payload.project = projectFromInput(rawInput, completion.project);
    payload.model = modelFromInput(rawInput);
    payload.summary = summaryFromInput(rawInput);
    payload.durationMs = duration(completion.durationMs);
  }
  return payload;
}

function validateWeChatCompletionPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('payload is invalid');
  const allowed = new Set([
    'schemaVersion', 'eventId', 'event', 'desktopId', 'occurredAt', 'privacyMode',
    'sessionId', 'project', 'model', 'summary', 'durationMs'
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`payload field ${key} is not allowed`);
  }
  if (value.schemaVersion !== 1 || value.event !== EVENT || !DESKTOP_ID_RE.test(value.desktopId || '')) {
    throw new TypeError('payload identity is invalid');
  }
  const clean = {
    schemaVersion: 1,
    eventId: cleanId(value.eventId, 'eventId'),
    event: EVENT,
    desktopId: value.desktopId,
    occurredAt: occurredAt(value.occurredAt),
    privacyMode: value.privacyMode === true,
    sessionId: cleanId(value.sessionId, 'sessionId'),
    project: null,
    model: null,
    summary: null,
    durationMs: null
  };
  if (value.privacyMode !== true && value.privacyMode !== false) throw new TypeError('privacyMode is invalid');
  if (!clean.privacyMode) {
    clean.project = cleanText(value.project, 80);
    clean.model = cleanText(value.model, 80);
    clean.summary = cleanText(value.summary, 600);
    clean.durationMs = duration(value.durationMs);
  } else if ([value.project, value.model, value.summary, value.durationMs].some((item) => item !== null && item !== undefined)) {
    throw new TypeError('privacy payload contains content');
  }
  return clean;
}

module.exports = {
  EVENT,
  buildWeChatCompletionPayload,
  validateWeChatCompletionPayload
};
