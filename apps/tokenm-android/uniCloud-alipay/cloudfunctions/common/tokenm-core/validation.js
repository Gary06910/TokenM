'use strict';

const { AppError, invalidRequest } = require('./errors');

const EVENT_FIELDS = Object.freeze([
  'schemaVersion',
  'eventId',
  'event',
  'desktopId',
  'occurredAt',
  'privacyMode',
  'sessionId',
  'project',
  'model',
  'summary',
  'durationMs'
]);
const EVENT_FIELD_SET = new Set(EVENT_FIELDS);
const PRIVATE_CONTENT_FIELDS = Object.freeze(['project', 'model', 'summary', 'durationMs']);
const DESKTOP_PATTERN = /^dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TASK_PATTERN = /^tsk_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactObject(value, allowed, code = 'invalid_request') {
  if (!isPlainObject(value)) throw new AppError(code);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new AppError(code, { field: key });
  }
}

function requiredString(value, field, maxLength, minLength = 1) {
  if (
    typeof value !== 'string'
    || value.length < minLength
    || value.length > maxLength
    || value.trim() !== value
  ) {
    throw invalidRequest(field);
  }
  return value;
}

function nullableString(value, field, maxLength) {
  if (value === null) return null;
  return requiredString(value, field, maxLength);
}

function validateEvent(value, nowMs) {
  if (!isPlainObject(value)) throw invalidRequest();
  const unknown = Object.keys(value).find((key) => !EVENT_FIELD_SET.has(key));
  if (unknown) {
    const code = value.privacyMode === true ? 'privacy_payload_rejected' : 'invalid_request';
    throw new AppError(code, { field: unknown });
  }
  if (value.schemaVersion !== 1) throw invalidRequest('schemaVersion');
  const eventId = requiredString(value.eventId, 'eventId', 240);
  if (!/^evt:[\x21-\x7e]+$/.test(eventId)) throw invalidRequest('eventId');
  if (value.event !== 'codex.task.completed') throw invalidRequest('event');
  const desktopId = requiredString(value.desktopId, 'desktopId', 255);
  if (!DESKTOP_PATTERN.test(desktopId)) throw invalidRequest('desktopId');
  const occurredAt = requiredString(value.occurredAt, 'occurredAt', 40);
  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs) || new Date(occurredAtMs).toISOString() !== occurredAt) {
    throw invalidRequest('occurredAt');
  }
  if (occurredAtMs > nowMs + 5 * 60_000) {
    throw invalidRequest('occurredAt');
  }
  if (typeof value.privacyMode !== 'boolean') throw invalidRequest('privacyMode');
  const sessionId = requiredString(value.sessionId, 'sessionId', 240);
  if (!/^[\x21-\x7e]+$/.test(sessionId)) throw invalidRequest('sessionId');

  let project = value.project ?? null;
  let model = value.model ?? null;
  let summary = value.summary ?? null;
  let durationMs = value.durationMs ?? null;
  if (value.privacyMode) {
    for (const field of PRIVATE_CONTENT_FIELDS) {
      if (value[field] !== undefined && value[field] !== null) {
        throw new AppError('privacy_payload_rejected', { field });
      }
    }
    project = null;
    model = null;
    summary = null;
    durationMs = null;
  } else {
    project = nullableString(project, 'project', 80);
    model = nullableString(model, 'model', 80);
    summary = nullableString(summary, 'summary', 600);
    if (
      durationMs !== null
      && (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 7 * 24 * 60 * 60_000)
    ) {
      throw invalidRequest('durationMs');
    }
  }

  return {
    schemaVersion: 1,
    eventId,
    event: value.event,
    desktopId,
    occurredAt,
    privacyMode: value.privacyMode,
    sessionId,
    project,
    model,
    summary,
    durationMs
  };
}

function eventsEqual(left, right) {
  return EVENT_FIELDS.every((field) => Object.is(left[field] ?? null, right[field] ?? null));
}

function desktopName(value) {
  return requiredString(value, 'name', 80);
}

function assertDesktopId(value) {
  const parsed = requiredString(value, 'desktopId', 255);
  if (!DESKTOP_PATTERN.test(parsed)) throw invalidRequest('desktopId');
  return parsed;
}

function assertTaskId(value) {
  const parsed = requiredString(value, 'taskId', 255);
  if (!TASK_PATTERN.test(parsed)) throw invalidRequest('taskId');
  return parsed;
}

function positivePageSize(value, fallback = 20) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw invalidRequest('limit');
  return value;
}

module.exports = {
  EVENT_FIELDS,
  assertDesktopId,
  assertExactObject,
  assertTaskId,
  desktopName,
  eventsEqual,
  isPlainObject,
  positivePageSize,
  requiredString,
  validateEvent
};
