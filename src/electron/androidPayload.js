'use strict';

const path = require('node:path');

const EVENT = 'codex.task.completed';
const DESKTOP_ID_RE = /^dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ALLOWED_FIELDS = new Set([
  'schemaVersion', 'eventId', 'event', 'desktopId', 'occurredAt', 'privacyMode',
  'sessionId', 'project', 'model', 'summary', 'durationMs'
]);

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

function fieldsFromInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Codex completion input must be an object');
  }
  if (input.hook_event_name === 'Stop') {
    return {
      sessionId: input.session_id,
      turnId: input.turn_id,
      cwd: input.cwd,
      occurredAt: input.occurred_at,
      durationMs: input.duration_ms,
      model: input.model ?? input.model_name ?? input.modelName ?? input.metadata?.model,
      summary: input.last_assistant_message ?? input.lastAssistantMessage
    };
  }
  const params = input.params;
  const turn = params?.turn;
  if (input.method !== 'turn/completed' || !params || !turn) {
    throw new TypeError('Unsupported Codex completion input');
  }
  if (turn.status !== undefined && turn.status !== 'completed') {
    throw new TypeError('Only completed Codex turns are supported');
  }
  return {
    sessionId: params.threadId ?? params.thread_id,
    turnId: turn.id ?? params.turnId ?? params.turn_id,
    cwd: params.cwd ?? turn.cwd,
    occurredAt: turn.completedAt ?? turn.completed_at ?? params.completedAt,
    durationMs: turn.durationMs ?? turn.duration_ms ?? params.durationMs,
    model: turn.model ?? params.model ?? params.modelName,
    summary: turn.lastAssistantMessage ?? turn.last_assistant_message
      ?? params.lastAssistantMessage ?? params.last_assistant_message
  };
}

function explicitEventId(sessionId, turnId) {
  const eventId = `evt:${cleanId(sessionId, 'sessionId')}:${cleanId(turnId, 'turnId')}`;
  if (eventId.length > 240) throw new TypeError('eventId is invalid');
  return eventId;
}

function canonicalTime(value, now = Date.now) {
  const candidate = value ?? (typeof now === 'function' ? now() : now);
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) throw new TypeError('occurredAt is invalid');
  return date.toISOString();
}

function cleanDuration(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('durationMs is invalid');
  return value;
}

function projectFromCwd(value) {
  const cwd = typeof value === 'string' ? value.trim().replace(/[\\/]+$/, '') : '';
  if (!cwd) return null;
  const windows = path.win32.basename(cwd);
  const basename = windows === cwd ? path.posix.basename(cwd) : windows;
  return cleanText(basename, 80);
}

function buildAndroidCompletionPayload({ rawInput, desktopId, privacyMode = true, now = Date.now }) {
  if (!DESKTOP_ID_RE.test(desktopId || '')) throw new TypeError('desktopId is invalid');
  const fields = fieldsFromInput(rawInput);
  const sessionId = cleanId(fields.sessionId, 'sessionId');
  const privateMode = privacyMode !== false;
  return {
    schemaVersion: 1,
    eventId: explicitEventId(sessionId, fields.turnId),
    event: EVENT,
    desktopId,
    occurredAt: canonicalTime(fields.occurredAt, now),
    privacyMode: privateMode,
    sessionId,
    project: privateMode ? null : projectFromCwd(fields.cwd),
    model: privateMode ? null : cleanText(fields.model, 80),
    summary: privateMode ? null : cleanText(fields.summary, 600),
    durationMs: privateMode ? null : cleanDuration(fields.durationMs)
  };
}

function validateAndroidCompletionPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('payload is invalid');
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) throw new TypeError(`payload field ${key} is not allowed`);
  }
  if (value.schemaVersion !== 1 || value.event !== EVENT || !DESKTOP_ID_RE.test(value.desktopId || '')) {
    throw new TypeError('payload identity is invalid');
  }
  if (value.privacyMode !== true && value.privacyMode !== false) {
    throw new TypeError('privacyMode is invalid');
  }
  const sessionId = cleanId(value.sessionId, 'sessionId');
  const eventId = typeof value.eventId === 'string' ? value.eventId : '';
  const prefix = `evt:${sessionId}:`;
  if (!eventId.startsWith(prefix) || eventId.length > 240) throw new TypeError('eventId identity is invalid');
  cleanId(eventId.slice(prefix.length), 'turnId');
  const clean = {
    schemaVersion: 1,
    eventId,
    event: EVENT,
    desktopId: value.desktopId,
    occurredAt: canonicalTime(value.occurredAt),
    privacyMode: value.privacyMode,
    sessionId,
    project: null,
    model: null,
    summary: null,
    durationMs: null
  };
  if (clean.privacyMode) {
    if ([value.project, value.model, value.summary, value.durationMs]
      .some((item) => item !== undefined && item !== null)) {
      throw new TypeError('privacy payload contains content');
    }
  } else {
    clean.project = cleanText(value.project, 80);
    clean.model = cleanText(value.model, 80);
    clean.summary = cleanText(value.summary, 600);
    clean.durationMs = cleanDuration(value.durationMs);
  }
  return clean;
}

module.exports = {
  EVENT,
  buildAndroidCompletionPayload,
  explicitEventId,
  validateAndroidCompletionPayload
};
