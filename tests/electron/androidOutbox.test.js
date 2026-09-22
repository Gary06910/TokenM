'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { classifyAndroidDelivery, createAndroidOutbox } = require('../../src/electron/androidOutbox');

function payload(eventId = 'evt:session-1:turn-1') {
  return {
    schemaVersion: 1,
    eventId,
    event: 'codex.task.completed',
    desktopId: 'dev_11111111-1111-4111-8111-111111111111',
    occurredAt: new Date().toISOString(),
    privacyMode: true,
    sessionId: 'session-1',
    project: null,
    model: null,
    summary: null,
    durationMs: null
  };
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-android-outbox-'));
  const filePath = path.join(
    directory,
    'token-m-android-outbox-dev_11111111-1111-4111-8111-111111111111.json'
  );
  t.after(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.rmdirSync(directory);
  });
  return filePath;
}

test('Android outbox uses an independent file and deduplicates the same event across restart', async (t) => {
  const filePath = fixture(t);
  assert.equal(
    path.basename(filePath),
    'token-m-android-outbox-dev_11111111-1111-4111-8111-111111111111.json'
  );
  assert.notEqual(path.basename(filePath), 'token-m-wechat-outbox.json');
  const first = createAndroidOutbox({ filePath, send: async () => ({ status: 201 }) });
  await first.enqueue(payload());
  await first.enqueue(payload());
  assert.equal(first.snapshot().pending, 1);
  const recovered = createAndroidOutbox({ filePath, send: async () => ({ status: 200 }) });
  assert.equal(recovered.snapshot().pending, 1);
  await recovered.flush();
  assert.equal(recovered.snapshot().pending, 0);
});

test('Android outbox retries transport failures with the identical explicit eventId', async (t) => {
  let now = 10_000;
  const sent = [];
  let attempt = 0;
  const outbox = createAndroidOutbox({
    filePath: fixture(t),
    now: () => now,
    random: () => 0.25,
    send: async (value) => {
      sent.push(value);
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('offline'), { code: 'network_error' });
      return { status: 200 };
    }
  });
  await outbox.enqueue(payload());
  await outbox.flush();
  const waiting = outbox.snapshot().items[0];
  assert.equal(waiting.eventId, 'evt:session-1:turn-1');
  now = waiting.nextAttemptAt;
  await outbox.flush();
  assert.deepEqual(sent.map((value) => value.eventId), [
    'evt:session-1:turn-1',
    'evt:session-1:turn-1'
  ]);
  assert.equal(outbox.snapshot().pending, 0);
});

test('Android retry classification preserves credential and terminal suspension', () => {
  assert.equal(classifyAndroidDelivery(null, { status: 429 }).kind, 'retry');
  assert.equal(classifyAndroidDelivery(null, { status: 401 }).kind, 'credential');
  assert.equal(classifyAndroidDelivery(null, { status: 409 }).kind, 'terminal');
  assert.equal(classifyAndroidDelivery({ status: 200 }).kind, 'success');
});

test('Android outbox accepts a Phase 2 submitted result without retrying the Desktop event', async (t) => {
  let sent = 0;
  const outbox = createAndroidOutbox({
    filePath: fixture(t),
    send: async () => {
      sent += 1;
      return { status: 'created', notificationStatus: 'submitted' };
    }
  });
  await outbox.enqueue(payload());
  await outbox.flush();
  assert.equal(sent, 1);
  assert.equal(outbox.snapshot().pending, 0);
});

test('Android outbox pauses without deleting queued events and reaches a bounded retry terminal state', async (t) => {
  const filePath = fixture(t);
  const outbox = createAndroidOutbox({
    filePath,
    maxAttempts: 3,
    now: () => 10_000,
    random: () => 0,
    send: async () => { throw Object.assign(new Error('offline'), { code: 'network_error' }); }
  });
  await outbox.enqueue(payload());
  outbox.pause('invalid_response');
  await outbox.flush();
  assert.equal(outbox.snapshot().pending, 1);
  assert.equal(outbox.snapshot().pausedReason, 'invalid_response');

  await outbox.start();
  await outbox.flush();
  await outbox.flush();
  await outbox.flush();
  const final = outbox.snapshot();
  assert.equal(final.pending, 0);
  assert.equal(final.failed, 1);
  assert.equal(final.items[0].attemptCount, 3);
  assert.equal(final.items[0].suspended, 'terminal');
  assert.equal(final.items[0].lastError, 'retry_exhausted');
});

test('Android outbox recovers its operation lane after a rejected enqueue', async (t) => {
  const outbox = createAndroidOutbox({ filePath: fixture(t), send: async () => ({ status: 201 }) });
  await assert.rejects(outbox.enqueue({ bad: true }), /payload/i);
  await outbox.enqueue(payload());
  assert.equal(outbox.snapshot().pending, 1);
});
const { MAX_ITEMS, ACTIVE_TTL_MS, FAILED_RETENTION_MS, MAX_FAILED_ITEMS } = require('../../src/electron/androidOutbox');

for (const [status, count] of [[401, 'blocked'], [400, 'failed']]) {
  test(`Android ${status} is undelivered, not pending`, async (t) => {
    const filePath = fixture(t);
    const queue = createAndroidOutbox({ filePath, send: async () => ({ status }) });
    await queue.enqueue(payload());
    await queue.flush();
    assert.equal(queue.snapshot().pending, 0);
    assert.equal(queue.snapshot()[count], 1);
    await queue.enqueue(payload('evt:session-1:pending'));
    await queue.clearUndelivered();
    assert.equal(queue.snapshot().pending, 1);
    assert.equal(queue.snapshot().total, 1);
    assert.equal(JSON.parse(fs.readFileSync(filePath)).items.length, 1);
    await queue.clearOutbox();
    assert.equal(JSON.parse(fs.readFileSync(filePath)).items.length, 0);
  });
}

test('clear waits for in-flight flush and preserves later enqueue ordering', async (t) => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const queue = createAndroidOutbox({ filePath: fixture(t), send: () => {
    entered();
    return new Promise((resolve) => { release = resolve; });
  } });
  await queue.enqueue(payload());
  const flush = queue.flush();
  await started;
  const clear = queue.clearOutbox();
  const enqueue = queue.enqueue(payload('evt:session-1:later'));
  release({ status: 500 });
  await Promise.all([flush, clear, enqueue]);
  assert.equal(queue.snapshot().total, 1);
  assert.equal(queue.snapshot().items[0].eventId, 'evt:session-1:later');
});

test('v1 migrates, old active notifications expire, and retention removes old failures', async (t) => {
  const filePath = fixture(t);
  const event = payload();
  const base = Date.parse(event.occurredAt);
  let now = base + ACTIVE_TTL_MS;
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, items: [{ payload: event, suspended: null }] }));
  let sends = 0;
  const queue = createAndroidOutbox({ filePath, now: () => now, send: async () => { sends++; } });
  await queue.flush();
  assert.equal(sends, 0);
  assert.equal(queue.snapshot().failed, 1);
  assert.equal(queue.snapshot().items[0].suspended, 'expired');
  assert.equal(JSON.parse(fs.readFileSync(filePath)).version, 2);
  now += FAILED_RETENTION_MS;
  await queue.flush();
  assert.equal(queue.snapshot().total, 0);
});

test('pending expiry runs even while paused and fails before sending', async (t) => {
  let now = 100;
  let sends = 0;
  const queue = createAndroidOutbox({ filePath: fixture(t), now: () => now, send: async () => { sends++; } });
  await queue.enqueue(payload());
  queue.pause('credential');
  now += ACTIVE_TTL_MS;
  await queue.flush();
  assert.equal(queue.snapshot().failed, 1);
  assert.equal(sends, 0);
});

test('failure cap retains newest 50 without evicting pending and hard capacity returns outbox_full', async (t) => {
  const filePath = fixture(t);
  const now = Date.now();
  const items = Array.from({ length: MAX_ITEMS }, (_, i) => ({
    payload: payload(`evt:session-1:${i}`), createdAt: now, nextAttemptAt: now + 1000,
    failedAt: i < 100 ? now - 100 + i : null, suspended: i < 100 ? 'terminal' : null
  }));
  fs.writeFileSync(filePath, JSON.stringify({ version: 2, items }));
  const queue = createAndroidOutbox({ filePath, now: () => now, send: async () => ({ status: 200 }) });
  assert.equal(queue.snapshot().failed, MAX_FAILED_ITEMS);
  assert.equal(queue.snapshot().pending, 900);
  for (let i = 0; i < 50; i++) await queue.enqueue(payload(`evt:session-1:new-${i}`));
  await assert.rejects(queue.enqueue(payload('evt:session-1:overflow')), { code: 'outbox_full' });
  assert.equal(queue.snapshot().total, MAX_ITEMS);
});
