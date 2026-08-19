'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { classifyWeChatDelivery, createWeChatOutbox } = require('../../src/electron/wechatOutbox');

function payload(eventId = `evt_${'a'.repeat(43)}`) {
  return {
    schemaVersion: 1,
    eventId,
    event: 'codex.task.completed',
    desktopId: 'dev_abcdefghijklmnopqrstuv',
    occurredAt: '2026-08-18T08:00:00.000Z',
    privacyMode: true,
    sessionId: 'session-1',
    project: null,
    model: null,
    summary: null,
    durationMs: null
  };
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-wechat-outbox-'));
  const filePath = path.join(directory, 'outbox.json');
  t.after(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.rmdirSync(directory);
  });
  return filePath;
}

test('durable enqueue deduplicates locally and survives restart', async (t) => {
  const filePath = fixture(t);
  const first = createWeChatOutbox({ filePath, send: async () => ({ status: 201 }) });
  await first.enqueue(payload());
  await first.enqueue(payload());
  assert.equal(first.snapshot().pending, 1);
  const recovered = createWeChatOutbox({ filePath, send: async () => ({ status: 201 }) });
  assert.equal(recovered.snapshot().pending, 1);
  await recovered.flush();
  assert.equal(recovered.snapshot().pending, 0);
});

test('retry uses bounded full jitter while credential and schema errors suspend', async (t) => {
  let now = 10_000;
  const retryPath = fixture(t);
  const retry = createWeChatOutbox({
    filePath: retryPath,
    now: () => now,
    random: () => 0.25,
    send: async () => { throw Object.assign(new Error('busy'), { status: 503, code: 'internal_error' }); }
  });
  await retry.enqueue(payload());
  await retry.flush();
  assert.equal(retry.snapshot().items[0].attemptCount, 1);
  assert.equal(retry.snapshot().items[0].nextAttemptAt, now + 250);
  assert.equal(retry.snapshot().items[0].suspended, null);

  const credentialPath = fixture(t);
  const credential = createWeChatOutbox({
    filePath: credentialPath,
    now: () => now,
    send: async () => { throw Object.assign(new Error('auth'), { status: 401, code: 'unauthenticated' }); }
  });
  await credential.enqueue(payload());
  await credential.flush();
  assert.equal(credential.snapshot().items[0].suspended, 'credential');

  const terminalPath = fixture(t);
  const terminal = createWeChatOutbox({
    filePath: terminalPath,
    now: () => now,
    send: async () => { throw Object.assign(new Error('schema'), { status: 422, code: 'privacy_payload_rejected' }); }
  });
  await terminal.enqueue(payload());
  await terminal.flush();
  assert.equal(terminal.snapshot().items[0].suspended, 'terminal');
});

test('retry classification follows the frozen contract', () => {
  assert.equal(classifyWeChatDelivery(null, { status: 429 }).kind, 'retry');
  assert.equal(classifyWeChatDelivery(null, { status: 401 }).kind, 'credential');
  assert.equal(classifyWeChatDelivery(null, { status: 409 }).kind, 'terminal');
  assert.equal(classifyWeChatDelivery({ status: 200 }).kind, 'success');
});

test('retry is explicitly bounded and exhausted events remain durably suspended', async (t) => {
  let now = 0;
  const filePath = fixture(t);
  const outbox = createWeChatOutbox({
    filePath,
    now: () => now,
    random: () => 1,
    maxAttempts: 2,
    send: async () => { throw Object.assign(new Error('offline'), { code: 'network_error' }); }
  });
  await outbox.enqueue(payload());
  await outbox.flush();
  now = outbox.snapshot().items[0].nextAttemptAt;
  await outbox.flush();
  assert.equal(outbox.snapshot().pending, 1);
  assert.equal(outbox.snapshot().items[0].attemptCount, 2);
  assert.equal(outbox.snapshot().items[0].suspended, 'terminal');
  assert.equal(outbox.snapshot().items[0].lastError, 'retry_exhausted');
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(stored.items[0].payload.eventId, payload().eventId);
});
