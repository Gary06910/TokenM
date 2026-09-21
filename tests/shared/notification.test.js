'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const notificationRoot = path.resolve(__dirname, '../../src/shared/notification');
const {
  buildAndroidCompletionPayload,
  validateAndroidCompletionPayload
} = require('../../src/shared/notification/androidPayload');

function rawInput(sessionId, turnId) {
  return {
    hook_event_name: 'Stop',
    session_id: sessionId,
    turn_id: turnId,
    occurred_at: '2026-09-21T10:00:00.000Z',
    cwd: 'C:\\private\\project',
    model: 'private-model',
    last_assistant_message: 'private assistant message',
    duration_ms: 123
  };
}

test('shared notification modules contain no Electron dependency', () => {
  for (const name of fs.readdirSync(notificationRoot)) {
    if (!name.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(notificationRoot, name), 'utf8');
    assert.doesNotMatch(source, /(?:require|from)\s*\(?.*electron/i, name);
  }
});

test('profile-scoped server identity is deterministic, bounded, and absent from the Android schema', () => {
  const sessionId = 's'.repeat(128);
  const turnId = 't'.repeat(128);
  const desktopId = 'dev_11111111-1111-4111-8111-111111111111';
  const business = buildAndroidCompletionPayload({
    rawInput: rawInput(sessionId, turnId),
    desktopId,
    profileId: 'business'
  });
  const businessAgain = buildAndroidCompletionPayload({
    rawInput: rawInput(sessionId, turnId),
    desktopId,
    profileId: 'business'
  });
  const personal = buildAndroidCompletionPayload({
    rawInput: rawInput(sessionId, turnId),
    desktopId,
    profileId: 'personal'
  });

  assert.equal(business.eventId, businessAgain.eventId);
  assert.equal(business.sessionId, businessAgain.sessionId);
  assert.notEqual(business.eventId, personal.eventId);
  assert.notEqual(business.sessionId, personal.sessionId);
  assert.ok(business.sessionId.length <= 128);
  assert.ok(business.eventId.length <= 240);
  assert.equal(Object.hasOwn(business, 'profileId'), false);
  assert.equal(business.project, null);
  assert.equal(business.model, null);
  assert.equal(business.summary, null);
  assert.equal(business.durationMs, null);
  assert.doesNotMatch(JSON.stringify(business), /private|C:\\private/i);
  assert.doesNotThrow(() => validateAndroidCompletionPayload(business));
});

test('desktop payload without profileId remains byte-for-byte compatible', () => {
  const payload = buildAndroidCompletionPayload({
    rawInput: rawInput('session-1', 'turn-1'),
    desktopId: 'dev_11111111-1111-4111-8111-111111111111'
  });
  assert.deepEqual(payload, {
    schemaVersion: 1,
    eventId: 'evt:session-1:turn-1',
    event: 'codex.task.completed',
    desktopId: 'dev_11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-09-21T10:00:00.000Z',
    privacyMode: true,
    sessionId: 'session-1',
    project: null,
    model: null,
    summary: null,
    durationMs: null
  });
});
