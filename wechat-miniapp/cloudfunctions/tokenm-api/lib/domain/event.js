'use strict';

const { AppError } = require('../errors');
const { assertString, canonicalDigest } = require('../security');

const ALLOWED_EVENT_KEYS = new Set([
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

function normalizeEventPayload(payload, timestamp) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('privacy_payload_rejected');
  for (const key of Object.keys(payload)) if (!ALLOWED_EVENT_KEYS.has(key)) throw new AppError('privacy_payload_rejected');
  for (const key of ['schemaVersion', 'eventId', 'event', 'desktopId', 'occurredAt', 'privacyMode', 'sessionId']) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) throw new AppError('invalid_request');
  }
  if (payload.schemaVersion !== 1 || payload.event !== 'codex.task.completed' || typeof payload.privacyMode !== 'boolean') throw new AppError('invalid_request');
  assertString(payload.eventId, { min: 1, max: 128 });
  assertString(payload.sessionId, { min: 1, max: 128 });
  if (!/^dev_[A-Za-z0-9_-]{22}$/u.test(payload.desktopId)) throw new AppError('invalid_request');
  const occurredAt = new Date(payload.occurredAt);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt > new Date(timestamp.getTime() + 5 * 60000) || occurredAt < new Date(timestamp.getTime() - 30 * 86400000)) throw new AppError('invalid_request');
  let project = null;
  let model = null;
  let summary = null;
  let durationMs = null;
  if (payload.privacyMode) {
    for (const key of ['project', 'model', 'summary', 'durationMs']) {
      if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== null) throw new AppError('privacy_payload_rejected');
    }
  } else {
    for (const key of ['project', 'model', 'summary', 'durationMs']) {
      if (!Object.prototype.hasOwnProperty.call(payload, key) || payload[key] === null) throw new AppError('privacy_payload_rejected');
    }
    try {
      project = assertString(payload.project, { min: 0, max: 80 });
      model = assertString(payload.model, { min: 0, max: 80 });
      summary = assertString(payload.summary, { min: 0, max: 600 });
    } catch {
      throw new AppError('privacy_payload_rejected');
    }
    if (/\r|\n/u.test(summary)) throw new AppError('privacy_payload_rejected');
    if (!Number.isSafeInteger(payload.durationMs) || payload.durationMs < 0) throw new AppError('invalid_request');
    durationMs = payload.durationMs;
  }
  const normalized = {
    schemaVersion: 1,
    eventId: payload.eventId,
    event: payload.event,
    desktopId: payload.desktopId,
    occurredAt: occurredAt.toISOString(),
    privacyMode: payload.privacyMode,
    sessionId: payload.sessionId,
    project,
    model,
    summary,
    durationMs
  };
  return { normalized, occurredAt, digest: canonicalDigest(normalized) };
}

module.exports = { normalizeEventPayload };
