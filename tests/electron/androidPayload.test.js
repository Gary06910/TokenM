'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildAndroidCompletionPayload,
  validateAndroidCompletionPayload
} = require('../../src/electron/androidPayload');

const DESKTOP = 'dev_11111111-1111-4111-8111-111111111111';
const stopInput = {
  hook_event_name: 'Stop',
  session_id: 'session-1',
  turn_id: 'turn-1',
  occurred_at: '2026-08-23T08:00:00.000Z',
  duration_ms: 42,
  cwd: 'C:\\private\\token-m',
  model: 'gpt-test',
  last_assistant_message: 'completed safely',
  prompt: 'never upload',
  messages: ['never upload']
};

test('Android privacy payload derives its explicit event identity directly from session and turn IDs', () => {
  const payload = buildAndroidCompletionPayload({
    rawInput: stopInput,
    desktopId: DESKTOP,
    privacyMode: true
  });
  assert.deepEqual(payload, {
    schemaVersion: 1,
    eventId: 'evt:session-1:turn-1',
    event: 'codex.task.completed',
    desktopId: DESKTOP,
    occurredAt: stopInput.occurred_at,
    privacyMode: true,
    sessionId: 'session-1',
    project: null,
    model: null,
    summary: null,
    durationMs: null
  });
  assert.doesNotMatch(JSON.stringify(payload), /private|prompt|messages|completed safely|gpt-test/i);
});

test('Android full payload uses only the documented content allowlist', () => {
  const payload = buildAndroidCompletionPayload({
    rawInput: stopInput,
    desktopId: DESKTOP,
    privacyMode: false
  });
  assert.equal(payload.eventId, 'evt:session-1:turn-1');
  assert.equal(payload.project, 'token-m');
  assert.equal(payload.model, 'gpt-test');
  assert.equal(payload.summary, 'completed safely');
  assert.equal(payload.durationMs, 42);
  assert.deepEqual(Object.keys(payload).sort(), [
    'desktopId', 'durationMs', 'event', 'eventId', 'model', 'occurredAt',
    'privacyMode', 'project', 'schemaVersion', 'sessionId', 'summary'
  ]);
});

test('Android payload validator rejects forbidden content and conflicting explicit identity', () => {
  const privacy = buildAndroidCompletionPayload({ rawInput: stopInput, desktopId: DESKTOP, privacyMode: true });
  assert.throws(() => validateAndroidCompletionPayload({ ...privacy, summary: 'leak' }), /privacy/i);
  assert.throws(() => validateAndroidCompletionPayload({ ...privacy, prompt: 'leak' }), /not allowed|privacy/i);
  assert.throws(() => validateAndroidCompletionPayload({ ...privacy, eventId: 'evt:other:turn-1' }), /eventId|identity/i);
});

test('Android payload source stays independent from the legacy completion normalizer', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/electron/androidPayload.js'), 'utf8');
  assert.doesNotMatch(source, /codexCompletion|normalizeCodexCompletion|completionEventId/);
});
