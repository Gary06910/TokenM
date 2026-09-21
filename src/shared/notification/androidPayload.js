'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const EVENT = 'codex.task.completed';
const DESKTOP_ID_RE = /^dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MAX_ID_LENGTH = 128;
const MAX_EVENT_ID_LENGTH = 240;
const ALLOWED_FIELDS = new Set([
  'schemaVersion', 'eventId', 'event', 'desktopId', 'occurredAt', 'privacyMode',
  'sessionId', 'project', 'model', 'summary', 'durationMs'
]);

function cleanId(value, name) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!ID_RE.test(result)) throw new TypeError(`${name} is invalid`);
  return result;
}

function cleanProfileId(value) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!PROFILE_ID_RE.test(result)) throw new TypeError('profileId is invalid');
  return result;
}

function digestFor(...parts) {
  return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

function boundedProfileSessionId(profileId, rawSessionId) {
  const profile = cleanProfileId(profileId);
  const session = cleanId(rawSessionId, 'sessionId');
  const direct = `${profile}.${session}`;
  if (direct.length <= MAX_ID_LENGTH && ID_RE.test(direct)) return direct;
  const digest = digestFor(profile, session);
  const prefixLength = MAX_ID_LENGTH - profile.length - digest.length - 2;
  if (prefixLength < 1) throw new TypeError('profile-scoped sessionId is invalid');
  return `${profile}.${session.slice(0, prefixLength)}.${digest}`;
}

function boundedTurnId(profileId, sessionId, rawTurnId, maxLength) {
  const turn = cleanId(rawTurnId, 'turnId');
  if (turn.length <= maxLength) return turn;
  const digest = digestFor(profileId, sessionId, turn);
  const prefixLength = maxLength - digest.length - 1;
  if (prefixLength < 1) throw new TypeError('turnId is invalid');
  return `${turn.slice(0, prefixLength)}.${digest}`;
}

function explicitEventId(sessionId, turnId, options = {}) {
  const rawSessionId = cleanId(sessionId, 'sessionId');
  const profileId = options.profileId;
  const scopedSessionId = profileId === undefined || profileId === null
    ? rawSessionId
    : boundedProfileSessionId(profileId, rawSessionId);
  const eventPrefix = `evt:${scopedSessionId}:`;
  const rawTurnId = cleanId(turnId, 'turnId');
  if (profileId === undefined || profileId === null) {
    const eventId = `${eventPrefix}${rawTurnId}`;
    if (eventId.length > MAX_EVENT_ID_LENGTH) throw new TypeError('eventId is invalid');
    return eventId;
  }
  const bounded = boundedTurnId(profileId, scopedSessionId, rawTurnId, MAX_EVENT_ID_LENGTH - eventPrefix.length);
  const eventId = `${eventPrefix}${bounded}`;
  if (eventId.length > MAX_EVENT_ID_LENGTH) throw new TypeError('eventId is invalid');
  return eventId;
}

function canonicalTime(value, now = Date.now) {
  const candidate = value ?? (typeof now === 'function' ? now() : now);
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) throw new TypeError('occurredAt is invalid');
  return date.toISOString();
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

function projectFromCwd(value) {
  const cwd = typeof value === 'string' ? value.trim().replace(/[\\/]+$/, '') : '';
  if (!cwd) return null;
  const windows = path.win32.basename(cwd);
  const basename = windows === cwd ? path.posix.basename(cwd) : windows;
  return cleanText(basename, 80);
}

function cleanDuration(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('durationMs is invalid');
  return value;
}

function buildAndroidCompletionPayload({ rawInput, desktopId, privacyMode = true, profileId, now = Date.now }) {
  if (!DESKTOP_ID_RE.test(desktopId || '')) throw new TypeError('desktopId is invalid');
  const fields = fieldsFromInput(rawInput);
  const sessionId = cleanId(fields.sessionId, 'sessionId');
  const privateMode = privacyMode !== false;
  return {
    schemaVersion: 1,
    eventId: explicitEventId(sessionId, fields.turnId, { profileId }),
    event: EVENT,
    desktopId,
    occurredAt: canonicalTime(fields.occurredAt, now),
    privacyMode: privateMode,
    sessionId: profileId === undefined || profileId === null
      ? sessionId
      : boundedProfileSessionId(profileId, sessionId),
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
  if (!eventId.startsWith(prefix) || eventId.length > MAX_EVENT_ID_LENGTH) throw new TypeError('eventId identity is invalid');
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
  boundedProfileSessionId,
  explicitEventId,
  validateAndroidCompletionPayload
};
