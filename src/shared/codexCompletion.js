'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const EVENT_TYPE = 'codex.turn.completed';
const EVENT_STATUS = 'completed';
const SUMMARY = 'Codex task completed';
const ID_LIMIT = 128;

function cleanId(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const result = value.trim();
  if (!result || result.length > ID_LIMIT || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new TypeError(`${name} is invalid`);
  }
  return result;
}

function completionEventId({ deviceId, sessionId, turnId, type, status }) {
  const identity = JSON.stringify([
    1,
    cleanId(deviceId, 'deviceId'),
    cleanId(sessionId, 'sessionId'),
    cleanId(turnId, 'turnId'),
    cleanId(type, 'type'),
    cleanId(status, 'status')
  ]);
  return `evt_${crypto.createHash('sha256').update(identity).digest('base64url')}`;
}

function appServerFields(input) {
  const params = input?.params;
  const turn = params?.turn;
  if (input?.method !== 'turn/completed' || !params || !turn) return null;
  if (turn.status !== undefined && turn.status !== EVENT_STATUS) {
    throw new TypeError('Only completed Codex turns are supported');
  }
  return {
    sessionId: params.threadId ?? params.thread_id,
    turnId: turn.id ?? params.turnId ?? params.turn_id,
    cwd: params.cwd ?? turn.cwd,
    occurredAt: turn.completedAt ?? turn.completed_at ?? params.completedAt,
    durationMs: turn.durationMs ?? turn.duration_ms ?? params.durationMs
  };
}

function stopHookFields(input) {
  if (input?.hook_event_name !== 'Stop') return null;
  return {
    sessionId: input.session_id,
    turnId: input.turn_id,
    cwd: input.cwd,
    occurredAt: input.occurred_at,
    durationMs: input.duration_ms
  };
}

function cleanProject(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return 'Unknown';
  const stripped = cwd.trim().replace(/[\\/]+$/, '');
  const basename = path.win32.basename(stripped) === stripped
    ? path.posix.basename(stripped)
    : path.win32.basename(stripped);
  const clean = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'Unknown').slice(0, 80);
}

function validOccurredAt(value, now) {
  const candidate = value ?? (typeof now === 'function' ? now() : now) ?? Date.now();
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) throw new TypeError('occurredAt is invalid');
  return date.toISOString();
}

function cleanDuration(value, context) {
  let candidate = value ?? context?.durationMs;
  if (candidate === undefined && context?.startedAt !== undefined) {
    const end = new Date(context.occurredAt ?? (typeof context.now === 'function' ? context.now() : Date.now())).getTime();
    const start = new Date(context.startedAt).getTime();
    if (Number.isFinite(end) && Number.isFinite(start)) candidate = end - start;
  }
  if (candidate === undefined) return undefined;
  if (!Number.isSafeInteger(candidate) || candidate < 0) throw new TypeError('durationMs is invalid');
  return candidate;
}

function normalizeCodexCompletion(input, context = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Codex completion input must be an object');
  }
  const fields = stopHookFields(input) || appServerFields(input);
  if (!fields) throw new TypeError('Unsupported Codex completion input');

  const deviceId = cleanId(context.deviceId, 'deviceId');
  const sessionId = cleanId(fields.sessionId, 'sessionId');
  const turnId = cleanId(fields.turnId, 'turnId');
  const occurredAt = validOccurredAt(fields.occurredAt ?? context.occurredAt, context.now);
  const event = {
    eventId: completionEventId({ deviceId, sessionId, turnId, type: EVENT_TYPE, status: EVENT_STATUS }),
    type: EVENT_TYPE,
    deviceId,
    sessionId,
    turnId,
    status: EVENT_STATUS,
    project: cleanProject(fields.cwd ?? context.cwd),
    summary: SUMMARY,
    occurredAt
  };
  const durationMs = cleanDuration(fields.durationMs, { ...context, occurredAt });
  if (durationMs !== undefined) event.durationMs = durationMs;
  return event;
}

function completionEventForWire(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Completion event must be an object');
  }
  const project = String(event.project || 'Unknown').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Unknown';
  const summary = String(event.summary || SUMMARY).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || SUMMARY;
  const clean = {
    eventId: cleanId(event.eventId, 'eventId'),
    type: cleanId(event.type, 'type'),
    deviceId: cleanId(event.deviceId, 'deviceId'),
    sessionId: cleanId(event.sessionId, 'sessionId'),
    turnId: cleanId(event.turnId, 'turnId'),
    status: cleanId(event.status, 'status'),
    project,
    summary,
    occurredAt: validOccurredAt(event.occurredAt)
  };
  if (clean.type !== EVENT_TYPE || clean.status !== EVENT_STATUS) throw new TypeError('Unsupported completion event');
  const expectedId = completionEventId(clean);
  if (clean.eventId !== expectedId) throw new TypeError('Completion eventId does not match its identity');
  if (event.durationMs !== undefined) clean.durationMs = cleanDuration(event.durationMs);
  return clean;
}

module.exports = {
  completionEventForWire,
  completionEventId,
  normalizeCodexCompletion
};
