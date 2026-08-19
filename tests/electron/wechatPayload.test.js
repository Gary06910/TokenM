'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWeChatCompletionPayload, validateWeChatCompletionPayload } = require('../../src/electron/wechatPayload');

const DESKTOP = 'dev_abcdefghijklmnopqrstuv';
const completion = {
  eventId: `evt_${'a'.repeat(43)}`,
  sessionId: 'session-1',
  occurredAt: '2026-08-18T08:00:00.000Z',
  project: 'fallback-project',
  durationMs: 42
};

test('privacy payload is an exact content-free allowlist', () => {
  const payload = buildWeChatCompletionPayload({
    completion,
    desktopId: DESKTOP,
    privacyMode: true,
    rawInput: {
      cwd: 'C:\\secret\\project',
      prompt: 'never upload',
      last_assistant_message: 'also secret',
      model: 'gpt-secret'
    }
  });
  assert.deepEqual(payload, {
    schemaVersion: 1,
    eventId: completion.eventId,
    event: 'codex.task.completed',
    desktopId: DESKTOP,
    occurredAt: completion.occurredAt,
    privacyMode: true,
    sessionId: completion.sessionId,
    project: null,
    model: null,
    summary: null,
    durationMs: null
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret|prompt|cwd|conversation|source/i);
});

test('explicit full payload sanitizes only allowed Stop fields and caps summary', () => {
  const payload = buildWeChatCompletionPayload({
    completion,
    desktopId: DESKTOP,
    privacyMode: false,
    rawInput: {
      cwd: 'C:\\work\\token-m\\',
      model: 'gpt-5.6\u0000-sol',
      last_assistant_message: `done\n${'x'.repeat(700)}`,
      prompt: 'never upload',
      messages: ['never upload']
    }
  });
  assert.equal(payload.project, 'token-m');
  assert.equal(payload.model, 'gpt-5.6 -sol');
  assert.equal(Array.from(payload.summary).length, 600);
  assert.doesNotMatch(payload.summary, /[\r\n]/);
  assert.equal(payload.durationMs, 42);
  assert.deepEqual(Object.keys(payload).sort(), [
    'desktopId', 'durationMs', 'event', 'eventId', 'model', 'occurredAt',
    'privacyMode', 'project', 'schemaVersion', 'sessionId', 'summary'
  ]);
});

test('validator rejects content in privacy mode and unknown fields', () => {
  const payload = buildWeChatCompletionPayload({ completion, desktopId: DESKTOP });
  assert.throws(() => validateWeChatCompletionPayload({ ...payload, summary: 'leak' }), /privacy payload/);
  assert.throws(() => validateWeChatCompletionPayload({ ...payload, prompt: 'leak' }), /not allowed/);
});
