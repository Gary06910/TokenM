'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createNotificationOutbox } = require('../../src/electron/notificationOutbox');
const { normalizeCodexCompletion } = require('../../src/shared/codexCompletion');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-outbox-'));
  const filePath = path.join(directory, 'outbox.json');
  t.after(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.rmdirSync(directory);
  });
  return filePath;
}

function event(extra = {}) {
  return {
    ...normalizeCodexCompletion({
      hook_event_name: 'Stop', session_id: 'thr_1', turn_id: 'turn_1', cwd: '/work/token-m'
    }, {
      deviceId: 'dev_0123456789012345678901',
      now: () => new Date('2026-08-17T10:00:00.000Z')
    }),
    ...extra
  };
}

test('durably enqueues privacy-safe events and recovers after restart', async (t) => {
  const filePath = fixture(t);
  const first = createNotificationOutbox({ filePath, send: async () => ({ ok: true }) });
  await first.enqueue(event({
    transcript_path: 'C:\\private\\transcript.jsonl',
    last_assistant_message: 'private response'
  }));
  assert.equal(first.snapshot().pending, 1);
  const persisted = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(persisted, /transcript|private response/);

  const sent = [];
  const recovered = createNotificationOutbox({ filePath, send: async (value) => sent.push(value) });
  assert.equal(recovered.snapshot().pending, 1);
  await recovered.flush();
  assert.equal(recovered.snapshot().pending, 0);
  assert.equal(sent.length, 1);
});

test('serializes sends and retries transient failures with exponential timing', async (t) => {
  const filePath = fixture(t);
  let now = 10_000;
  let active = 0;
  let maximumActive = 0;
  let attempts = 0;
  const outbox = createNotificationOutbox({
    filePath,
    now: () => now,
    random: () => 0.5,
    send: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      attempts += 1;
      await Promise.resolve();
      active -= 1;
      if (attempts === 1) throw Object.assign(new Error('retry'), { status: 503, code: 'push_retry_required' });
      return { ok: true };
    }
  });
  await outbox.enqueue(event());
  await Promise.all([outbox.flush(), outbox.flush()]);
  assert.equal(attempts, 1);
  assert.equal(maximumActive, 1);
  assert.equal(outbox.snapshot().items[0].nextAttemptAt, 11_000);
  assert.equal(outbox.snapshot().items[0].lastError, 'push_retry_required');

  now = 11_000;
  await outbox.flush();
  assert.equal(attempts, 2);
  assert.equal(outbox.snapshot().pending, 0);
});

test('retains client and credential failures as visible suspended items', async (t) => {
  const filePath = fixture(t);
  const outbox = createNotificationOutbox({
    filePath,
    send: async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); }
  });
  await outbox.enqueue(event());
  await outbox.flush();
  assert.equal(outbox.snapshot().pending, 1);
  assert.equal(outbox.snapshot().items[0].suspended, 'credential');
  assert.equal(outbox.snapshot().items[0].lastError, 'http_401');
});

test('never replaces a corrupt persisted outbox with an empty document', async (t) => {
  const filePath = fixture(t);
  fs.writeFileSync(filePath, '{broken');
  const outbox = createNotificationOutbox({ filePath, send: async () => ({ ok: true }) });
  assert.throws(() => outbox.snapshot(), /JSON/);
  await assert.rejects(() => outbox.enqueue(event()), /JSON/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
});
