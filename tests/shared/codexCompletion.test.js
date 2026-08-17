'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  completionEventForWire,
  completionEventId,
  normalizeCodexCompletion
} = require('../../src/shared/codexCompletion');

const context = {
  deviceId: 'dev_0123456789012345678901',
  now: () => new Date('2026-08-17T10:00:00.000Z')
};

test('normalizes official Stop input without retaining private fields', () => {
  const event = normalizeCodexCompletion({
    hook_event_name: 'Stop',
    session_id: 'thr_example',
    turn_id: 'turn_example',
    stop_hook_active: false,
    cwd: 'C:\\work\\token-m',
    transcript_path: 'C:\\private\\transcript.jsonl',
    last_assistant_message: 'secret assistant response'
  }, context);

  assert.deepEqual(event, {
    eventId: completionEventId({
      deviceId: context.deviceId,
      sessionId: 'thr_example',
      turnId: 'turn_example',
      type: 'codex.turn.completed',
      status: 'completed'
    }),
    type: 'codex.turn.completed',
    deviceId: context.deviceId,
    sessionId: 'thr_example',
    turnId: 'turn_example',
    status: 'completed',
    project: 'token-m',
    summary: 'Codex task completed',
    occurredAt: '2026-08-17T10:00:00.000Z'
  });
  assert.doesNotMatch(JSON.stringify(event), /transcript|assistant response|C:\\\\private/);
});

test('normalizes App Server turn/completed and rejects non-completed turns', () => {
  const event = normalizeCodexCompletion({
    method: 'turn/completed',
    params: {
      threadId: 'thr_app',
      cwd: '/work/app-server-project',
      turn: { id: 'turn_app', status: 'completed', durationMs: 42 }
    }
  }, context);
  assert.equal(event.sessionId, 'thr_app');
  assert.equal(event.turnId, 'turn_app');
  assert.equal(event.project, 'app-server-project');
  assert.equal(event.durationMs, 42);

  assert.throws(() => normalizeCodexCompletion({
    method: 'turn/completed',
    params: { threadId: 'thr_app', turn: { id: 'turn_app', status: 'failed' } }
  }, context), /Only completed/);
});

test('event IDs are deterministic and tuple-bound', () => {
  const identity = {
    deviceId: context.deviceId,
    sessionId: 'thr_1',
    turnId: 'turn_1',
    type: 'codex.turn.completed',
    status: 'completed'
  };
  const first = completionEventId(identity);
  assert.equal(first, completionEventId({ ...identity }));
  assert.notEqual(first, completionEventId({ ...identity, turnId: 'turn_2' }));
  assert.match(first, /^evt_[A-Za-z0-9_-]{43}$/);
});

test('wire projection drops unknown privacy-sensitive properties', () => {
  const event = normalizeCodexCompletion({
    hook_event_name: 'Stop', session_id: 'thr_1', turn_id: 'turn_1', cwd: '/work/project'
  }, context);
  const wire = completionEventForWire({
    ...event,
    transcript_path: '/private/transcript',
    last_assistant_message: 'private response',
    prompt: 'private prompt'
  });
  assert.deepEqual(wire, event);
});
