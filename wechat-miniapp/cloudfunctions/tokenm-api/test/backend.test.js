'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { createApplication } = require('../lib/app');
const { loadConfig } = require('../lib/config');
const { createLogger } = require('../lib/logger');
const { createMemoryRepository } = require('../lib/repository');
const { hmacHex } = require('../lib/security');
const { buildTemplateData, classifyProviderError, createWechatSender } = require('../lib/sender');
const { createService, COLLECTIONS, validateState } = require('../lib/service');

const REQUEST_ID = 'req_abcdefghijklmnop';
const USER_A = { appId: 'wx-test-app', openid: 'openid-a' };
const USER_B = { appId: 'wx-test-app', openid: 'openid-b' };

function config(overrides = {}) {
  const templateId = 'synthetic-template-id';
  return {
    pairingPepper: 'pairing-pepper-for-tests-only-32-bytes-long',
    devicePepper: 'device-pepper-for-tests-only-32-bytes-long',
    cursorKey: 'cursor-key-for-tests-only-32-bytes-long',
    templateId,
    templateIdHash: crypto.createHash('sha256').update(templateId).digest('hex'),
    templateKeywords: {
      completion: { key: 'thing1', type: 'thing' },
      completedAt: { key: 'time2', type: 'time' },
      desktopName: { key: 'thing3', type: 'thing' },
      status: { key: 'phrase4', type: 'phrase' }
    },
    publicOrigin: 'https://tokenm.test',
    miniprogramState: 'trial',
    lang: 'zh_CN',
    initialQuota: 0,
    pairingTtlMs: 600000,
    grantTtlMs: 300000,
    cleanupBatchSize: 50,
    pairRateLimit: 10,
    pairRateWindowMs: 600000,
    pairingSessionMaxAttempts: 5,
    eventRateLimit: 120,
    statusRateLimit: 60,
    grantRateLimit: 10,
    grantRateWindowMs: 600000,
    ...overrides
  };
}

function harness(options = {}) {
  const repo = createMemoryRepository();
  const current = { value: new Date('2026-08-18T08:00:00.000Z') };
  const sends = [];
  let nextCode = options.firstCode ?? 7;
  const sender = {
    async send(context) {
      sends.push(context);
      if (options.send) return options.send(context, sends.length);
      return { errcode: 0, errmsg: 'ok' };
    }
  };
  const cfg = config(options.config);
  const service = createService({
    repo,
    sender,
    config: cfg,
    clock: () => new Date(current.value),
    randomInt: () => nextCode++,
    randomBytes: crypto.randomBytes,
    logger: options.logger
  });
  const app = createApplication({ service, randomBytes: crypto.randomBytes });
  return { repo, current, sends, sender, config: cfg, service, app };
}

function diagnosticCapture() {
  const entries = [];
  const output = {};
  for (const level of ['info', 'warn', 'error', 'log']) {
    output[level] = (line) => entries.push({ level, payload: JSON.parse(line) });
  }
  return { entries, logger: createLogger(output) };
}

async function runProviderDiagnostic(send) {
  const capture = diagnosticCapture();
  const h = harness({ send, logger: capture.logger });
  const paired = await pair(h);
  await grantOne(h);
  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  return { capture, h, result };
}

async function bootstrap(h, identity = USER_A) {
  return h.service.bootstrap(identity);
}

async function pair(h, identity = USER_A, deviceName = '测试电脑') {
  await bootstrap(h, identity);
  const code = await h.service.createPairingCode(identity, REQUEST_ID);
  const claimed = await h.service.claimPairing({
    code: code.code,
    deviceName,
    networkSubject: `loopback-${identity.openid}`,
    requestId: REQUEST_ID
  });
  return { ...claimed, code: code.code };
}

function eventFor(desktopId, overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: overrides.eventId || 'evt-test-1',
    event: 'codex.task.completed',
    desktopId,
    occurredAt: overrides.occurredAt || '2026-08-18T08:00:00.000Z',
    privacyMode: overrides.privacyMode ?? true,
    sessionId: overrides.sessionId || 'session-1',
    project: overrides.privacyMode === false ? (overrides.project ?? 'token-m') : null,
    model: overrides.privacyMode === false ? (overrides.model ?? 'gpt-test') : null,
    summary: overrides.privacyMode === false ? (overrides.summary ?? '任务已完成') : null,
    durationMs: overrides.privacyMode === false ? (overrides.durationMs ?? 1234) : null,
    ...overrides
  };
}

async function grantOne(h, identity = USER_A) {
  const intent = await h.service.prepareSubscriptionGrant(identity, REQUEST_ID);
  return h.service.recordSubscriptionOutcome(identity, intent.grantIntentId, 'accept', REQUEST_ID);
}

async function errorCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  assert.fail('expected operation to reject');
}

test('PAIR-01 creates a zero-padded CSPRNG code and stores only its HMAC', async () => {
  const h = harness({ firstCode: 7 });
  await bootstrap(h);
  const result = await h.service.createPairingCode(USER_A, REQUEST_ID);
  assert.equal(result.code, '000007');
  assert.equal(result.ttlSeconds, 600);
  const sessions = await h.repo.snapshot(COLLECTIONS.pairs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]._id, `pair_${hmacHex(h.config.pairingPepper, result.code)}`);
  assert.equal(JSON.stringify(sessions).includes(result.code), false);
});

test('PAIR-02 supersedes old codes and expired codes use the uniform error', async () => {
  const h = harness();
  await bootstrap(h);
  const first = await h.service.createPairingCode(USER_A, REQUEST_ID);
  const second = await h.service.createPairingCode(USER_A, REQUEST_ID);
  assert.notEqual(first.code, second.code);
  assert.equal(await errorCode(h.service.claimPairing({ code: first.code, deviceName: 'A', networkSubject: 'one', requestId: REQUEST_ID })), 'pairing_invalid');
  h.current.value = new Date('2026-08-18T08:11:00.000Z');
  assert.equal(await errorCode(h.service.claimPairing({ code: second.code, deviceName: 'A', networkSubject: 'two', requestId: REQUEST_ID })), 'pairing_invalid');
});

test('PAIR-03 consumes a pairing code once under concurrent claims', async () => {
  const h = harness();
  await bootstrap(h);
  const code = await h.service.createPairingCode(USER_A, REQUEST_ID);
  const results = await Promise.allSettled([1, 2, 3].map((index) => h.service.claimPairing({
    code: code.code,
    deviceName: `电脑 ${index}`,
    networkSubject: `network-${index}`,
    requestId: REQUEST_ID
  })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.deepEqual(results.filter((result) => result.status === 'rejected').map((result) => result.reason.code), ['pairing_invalid', 'pairing_invalid']);
  assert.equal((await h.repo.snapshot(COLLECTIONS.desktops)).length, 1);
});

test('PAIR-04 rate limits before pairing lookup and never exposes code state', async () => {
  const h = harness({ config: { pairRateLimit: 1 } });
  await bootstrap(h);
  assert.equal(await errorCode(h.service.claimPairing({ code: '999999', deviceName: 'A', networkSubject: 'same', requestId: REQUEST_ID })), 'pairing_invalid');
  assert.equal(await errorCode(h.service.claimPairing({ code: '999998', deviceName: 'A', networkSubject: 'same', requestId: REQUEST_ID })), 'rate_limited');
  const security = await h.repo.snapshot(COLLECTIONS.security);
  assert.equal(JSON.stringify(security).includes('999999'), false);
});

test('AUTH-01 issues a one-time credential and authenticates only its HMAC', async () => {
  const h = harness();
  const paired = await pair(h);
  assert.match(paired.credential, /^tm_wx_d1\.dev_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u);
  const desktops = await h.service.listDesktops(USER_A);
  assert.equal(JSON.stringify(desktops).includes('credential'), false);
  const status = await h.service.getDesktopStatus(paired.credential, REQUEST_ID);
  assert.equal(status.desktop.desktopId, paired.desktop.desktopId);
  const stored = (await h.repo.snapshot(COLLECTIONS.desktops))[0];
  assert.equal(stored.credentialHash.length, 64);
  assert.equal(JSON.stringify(stored).includes(paired.credential), false);
});

test('AUTH-02 rejects tampered credentials and revocation is immediate', async () => {
  const h = harness();
  const paired = await pair(h);
  const last = paired.credential.slice(-1);
  const tampered = `${paired.credential.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
  assert.equal(await errorCode(h.service.getDesktopStatus(tampered, REQUEST_ID)), 'unauthenticated');
  const unbound = await h.service.revokeDesktopByOwner(USER_A, paired.desktop.desktopId, REQUEST_ID);
  assert.equal(unbound.alreadyRevoked, false);
  const duplicate = await h.service.revokeDesktopByOwner(USER_A, paired.desktop.desktopId, REQUEST_ID);
  assert.equal(duplicate.alreadyRevoked, true);
  assert.equal(await errorCode(h.service.getDesktopStatus(paired.credential, REQUEST_ID)), 'unauthenticated');
});

test('EVENT-01 persists an exact privacy task before returning no-quota status', async () => {
  const h = harness();
  const paired = await pair(h);
  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(result.status, 'created');
  assert.equal(result.notificationStatus, 'skipped_no_quota');
  const tasks = await h.repo.snapshot(COLLECTIONS.tasks);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].project, null);
  assert.equal(tasks[0].summary, null);
  assert.equal(h.sends.length, 0);
});

test('EVENT-02 same eventId x3 creates one task, sends once, and consumes once', async () => {
  const h = harness();
  const paired = await pair(h);
  await grantOne(h);
  const body = eventFor(paired.desktop.desktopId, { eventId: 'evt-duplicate-3x' });
  const results = await Promise.all([1, 2, 3].map(() => h.service.createEvent(paired.credential, body, REQUEST_ID)));
  assert.equal(results.filter((result) => result.status === 'created').length, 1);
  assert.equal(results.filter((result) => result.status === 'duplicate').length, 2);
  assert.equal((await h.repo.snapshot(COLLECTIONS.tasks)).length, 1);
  assert.equal((await h.repo.snapshot(COLLECTIONS.deliveries)).length, 1);
  assert.equal(h.sends.length, 1);
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual({ available: state.available, reserved: state.reserved, consumed: state.consumedTotal }, { available: 0, reserved: 0, consumed: 1 });
  validateState(state);
});

test('EVENT-03 conflicting canonical body returns 409 semantics without mutation', async () => {
  const h = harness();
  const paired = await pair(h);
  const first = eventFor(paired.desktop.desktopId, { eventId: 'evt-conflict' });
  await h.service.createEvent(paired.credential, first, REQUEST_ID);
  assert.equal(await errorCode(h.service.createEvent(paired.credential, { ...first, sessionId: 'different' }, REQUEST_ID)), 'event_conflict');
  assert.equal((await h.repo.snapshot(COLLECTIONS.tasks)).length, 1);
  const security = await h.repo.snapshot(COLLECTIONS.security);
  assert.equal(security.some((entry) => entry.reason === 'event_conflict'), true);
});

test('EVENT-04 rejects out-of-window events and HTTP enforces exact transport schema', async () => {
  const h = harness();
  const paired = await pair(h);
  assert.equal(await errorCode(h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId, { occurredAt: '2026-08-18T08:06:00.000Z' }), REQUEST_ID)), 'invalid_request');
  const response = await h.app.invokeHttp({
    httpMethod: 'POST',
    path: '/v1/desktop/events',
    headers: { authorization: `Bearer ${paired.credential}`, 'content-type': 'text/plain' },
    body: '{}'
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('QUOTA-01 only an accepted server-created intent grants one quota', async () => {
  const h = harness();
  await bootstrap(h);
  for (const result of ['reject', 'ban', 'filter']) {
    const intent = await h.service.prepareSubscriptionGrant(USER_A, REQUEST_ID);
    await h.service.recordSubscriptionOutcome(USER_A, intent.grantIntentId, result, REQUEST_ID);
  }
  let state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(state.available, 0);
  await grantOne(h);
  state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(state.available, 1);
  assert.equal(state.grantedTotal, 1);
});

test('QUOTA-02 grant finalize is single-use and expiry never grants', async () => {
  const h = harness();
  await bootstrap(h);
  const intent = await h.service.prepareSubscriptionGrant(USER_A, REQUEST_ID);
  const first = await h.service.recordSubscriptionOutcome(USER_A, intent.grantIntentId, 'accept', REQUEST_ID);
  const second = await h.service.recordSubscriptionOutcome(USER_A, intent.grantIntentId, 'accept', REQUEST_ID);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  const expired = await h.service.prepareSubscriptionGrant(USER_A, REQUEST_ID);
  h.current.value = new Date('2026-08-18T08:06:00.000Z');
  assert.equal(await errorCode(h.service.recordSubscriptionOutcome(USER_A, expired.grantIntentId, 'accept', REQUEST_ID)), 'grant_intent_expired');
  assert.equal((await h.repo.snapshot(COLLECTIONS.states))[0].available, 1);
});

test('QUOTA-03 concurrent distinct events with quota=1 never reserve below zero', async () => {
  const h = harness();
  const paired = await pair(h);
  await grantOne(h);
  const results = await Promise.all([
    h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId, { eventId: 'evt-concurrent-a' }), REQUEST_ID),
    h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId, { eventId: 'evt-concurrent-b' }), REQUEST_ID)
  ]);
  assert.deepEqual(results.map((result) => result.notificationStatus).sort(), ['sent', 'skipped_no_quota'].sort());
  assert.equal(h.sends.length, 1);
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(state.available, 0);
  assert.equal(state.reserved, 0);
  validateState(state);
});

test('QUOTA-04 explicit provider rejection releases the reservation', async () => {
  const h = harness({ send: async () => ({ errcode: 43101, errmsg: 'synthetic rejection' }) });
  const paired = await pair(h);
  await grantOne(h);
  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(result.notificationStatus, 'failed');
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual({ available: state.available, reserved: state.reserved, consumed: state.consumedTotal, released: state.releasedTotal }, { available: 1, reserved: 0, consumed: 0, released: 1 });
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.deepEqual({ status: delivery.status, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode }, { status: 'failed', providerErrcode: 43101, providerErrmsgCode: 'wechat_43101' });
  validateState(state);
});

test('QUOTA-04B thrown explicit WeChat provider rejection preserves code and releases reservation', async () => {
  const h = harness({ send: async () => {
    const error = new Error('user refuse to accept the msg');
    error.errCode = 43101;
    error.errMsg = 'openapi subscribeMessage.send:fail';
    throw error;
  } });
  const paired = await pair(h);
  await grantOne(h);
  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(result.notificationStatus, 'failed');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.deepEqual({ status: delivery.status, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode }, { status: 'failed', providerErrcode: 43101, providerErrmsgCode: 'wechat_43101' });
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual({ available: state.available, reserved: state.reserved, consumed: state.consumedTotal, released: state.releasedTotal }, { available: 1, reserved: 0, consumed: 0, released: 1 });
  validateState(state);
});

test('PROVIDER-01 generic thrown errors remain uncertain', () => {
  assert.deepEqual(classifyProviderError(new Error('synthetic timeout')), { status: 'unknown', errcode: null, errmsgCode: 'provider_call_uncertain' });
  const error = new Error('system failure');
  error.code = 'ETIMEDOUT';
  assert.deepEqual(classifyProviderError(error), { status: 'unknown', errcode: null, errmsgCode: 'provider_call_uncertain' });
});

test('DIAG-01 generic timeout remains unknown and emits one sanitized diagnostic', async () => {
  const { capture, h, result } = await runProviderDiagnostic(async () => {
    throw new Error('synthetic timeout');
  });
  assert.equal(result.notificationStatus, 'unknown');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.deepEqual(
    { status: delivery.status, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode },
    { status: 'unknown', providerErrcode: null, providerErrmsgCode: 'provider_call_uncertain' }
  );
  assert.equal(capture.entries.length, 1);
  assert.equal(capture.entries[0].payload.event, 'wechat_provider_throw_unclassified');
  const serialized = JSON.stringify(capture.entries);
  assert.equal(serialized.includes('synthetic timeout'), false);
  assert.equal(serialized.includes('stack'), false);
});

test('DIAG-02 numeric top-level code remains unknown but emits a numeric hint', async () => {
  const { capture, result } = await runProviderDiagnostic(async () => {
    const error = new Error('synthetic');
    error.code = 43101;
    throw error;
  });
  assert.equal(result.notificationStatus, 'unknown');
  assert.deepEqual(capture.entries[0].payload.providerErrorShape['top.code'], {
    present: true,
    type: 'number',
    safeInteger: true,
    numericValue: 43101
  });
});

test('DIAG-03 nested provider-looking code remains unknown but emits its path', async () => {
  const { capture, result } = await runProviderDiagnostic(async () => {
    throw { originalError: { errCode: 43101 } };
  });
  assert.equal(result.notificationStatus, 'unknown');
  assert.deepEqual(capture.entries[0].payload.providerErrorShape['originalError.errCode'], {
    present: true,
    type: 'number',
    safeInteger: true,
    numericValue: 43101
  });
});

test('DIAG-04 explicit top-level errCode remains failed and emits no unclassified diagnostic', async () => {
  const { capture, h, result } = await runProviderDiagnostic(async () => {
    throw { errCode: 43101, errMsg: 'provider rejected' };
  });
  assert.equal(result.notificationStatus, 'failed');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.deepEqual(
    { status: delivery.status, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode },
    { status: 'failed', providerErrcode: 43101, providerErrmsgCode: 'wechat_43101' }
  );
  assert.equal(capture.entries.length, 0);
});

test('DIAG-05 success emits no unclassified diagnostic', async () => {
  const { capture, result } = await runProviderDiagnostic(async () => ({ errcode: 0, errmsg: 'ok' }));
  assert.equal(result.notificationStatus, 'sent');
  assert.equal(capture.entries.length, 0);
});

test('DIAG-06 diagnostic omits messages, stack, identity-like fields, and credentials', async () => {
  const secrets = {
    message: 'private-message-sentinel',
    errMsg: 'private-errmsg-sentinel',
    stack: 'private-stack-sentinel',
    openid: 'openid-private-sentinel',
    credential: 'credential-private-sentinel'
  };
  const { capture, result } = await runProviderDiagnostic(async () => {
    const error = new Error(secrets.message);
    error.errMsg = secrets.errMsg;
    error.stack = secrets.stack;
    error.openid = secrets.openid;
    error.credential = secrets.credential;
    throw error;
  });
  assert.equal(result.notificationStatus, 'unknown');
  const serialized = JSON.stringify(capture.entries);
  for (const secret of Object.values(secrets)) assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('"message"'), false);
  assert.equal(serialized.includes('"stack"'), false);
  assert.equal(serialized.includes('"openid"'), false);
  assert.equal(serialized.includes('"credential"'), false);
  assert.equal(capture.entries[0].payload.providerErrorShape['top.errMsg'].present, true);
  assert.equal(capture.entries[0].payload.providerErrorShape['top.errMsg'].type, 'string');
});

test('SDK-01 thrown CloudBase SYS_ERR -501001 remains uncertain', () => {
  assert.deepEqual(classifyProviderError({ errCode: -501001, errMsg: 'redacted' }), {
    status: 'unknown',
    errcode: null,
    errmsgCode: 'provider_call_uncertain',
    classificationBranch: 'sdk_outer_uncertain',
    outerCode: -501001
  });
});

test('SDK-02 thrown CloudBase timeout -501002 remains uncertain', () => {
  assert.deepEqual(classifyProviderError({ errCode: -501002, errMsg: 'redacted' }), {
    status: 'unknown',
    errcode: null,
    errmsgCode: 'provider_call_uncertain',
    classificationBranch: 'sdk_outer_uncertain',
    outerCode: -501002
  });
});

test('SDK-03 thrown cloud-call timeout -604102 remains uncertain', () => {
  assert.deepEqual(classifyProviderError({ errCode: -604102, errMsg: 'redacted' }), {
    status: 'unknown',
    errcode: null,
    errmsgCode: 'provider_call_uncertain',
    classificationBranch: 'sdk_outer_uncertain',
    outerCode: -604102
  });
});

test('SDK-04 thrown positive WeChat business code 43101 remains definite failed', () => {
  assert.deepEqual(classifyProviderError({ errCode: 43101, errMsg: 'redacted' }), {
    status: 'failed',
    errcode: 43101,
    errmsgCode: 'wechat_43101'
  });
});

test('SDK-05 returned errcode 0 remains sent', async () => {
  const { capture, h, result } = await runProviderDiagnostic(async () => ({ errcode: 0, errmsg: 'ok' }));
  assert.equal(result.notificationStatus, 'sent');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.deepEqual(
    { status: delivery.status, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode },
    { status: 'sent', providerErrcode: 0, providerErrmsgCode: null }
  );
  assert.equal(capture.entries.length, 0);
});

test('SDK-06 returned errcode 43101 remains definite failed', async () => {
  const { capture, h, result } = await runProviderDiagnostic(async () => ({ errcode: 43101, errmsg: 'redacted' }));
  assert.equal(result.notificationStatus, 'failed');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.deepEqual(
    { status: delivery.status, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode },
    { status: 'failed', providerErrcode: 43101, providerErrmsgCode: 'wechat_43101' }
  );
  assert.equal(capture.entries.length, 0);
});

test('SDK-07 generic thrown timeout remains unknown on the unclassified branch', async () => {
  const { capture, h, result } = await runProviderDiagnostic(async () => {
    throw new Error('private-timeout-sentinel');
  });
  assert.equal(result.notificationStatus, 'unknown');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.equal(delivery.providerErrcode, null);
  assert.equal(capture.entries[0].payload.classificationBranch, 'throw_unclassified');
  assert.equal(JSON.stringify(capture.entries).includes('private-timeout-sentinel'), false);
});

test('SDK-08 negative SDK error emits origin and numeric shape without private values', async () => {
  const secrets = ['private-message', 'private-errmsg', 'private-stack', 'private-openid', 'private-credential'];
  const { capture, h, result } = await runProviderDiagnostic(async () => {
    const error = new Error(secrets[0]);
    error.errCode = -501001;
    error.errMsg = secrets[1];
    error.stack = secrets[2];
    error.openid = secrets[3];
    error.credential = secrets[4];
    throw error;
  });
  assert.equal(result.notificationStatus, 'unknown');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.deepEqual(
    { status: delivery.status, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode },
    { status: 'unknown', providerErrcode: null, providerErrmsgCode: 'provider_call_uncertain' }
  );
  assert.equal(capture.entries.length, 1);
  const payload = capture.entries[0].payload;
  assert.equal(payload.event, 'wechat_provider_throw_unclassified');
  assert.equal(payload.classificationBranch, 'sdk_outer_uncertain');
  assert.equal(payload.outerCode, -501001);
  assert.deepEqual(payload.providerErrorShape['top.errCode'], {
    present: true,
    type: 'number',
    safeInteger: true,
    numericValue: -501001
  });
  const serialized = JSON.stringify(capture.entries);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
  const loggerBoundary = diagnosticCapture();
  loggerBoundary.logger.warn({ event: 'synthetic', outerCode: 'private-outer-code-string' });
  assert.equal(JSON.stringify(loggerBoundary.entries).includes('private-outer-code-string'), false);
});

test('SDK-09 negative SDK uncertainty holds reservation without release', async () => {
  const h = harness({ send: async () => { throw { errCode: -501001, errMsg: 'redacted' }; } });
  const paired = await pair(h);
  await grantOne(h);
  const seeded = (await h.repo.snapshot(COLLECTIONS.states))[0];
  Object.assign(seeded, {
    available: 5,
    reserved: 0,
    grantedTotal: 11,
    consumedTotal: 6,
    releasedTotal: 6,
    version: 36
  });
  validateState(seeded);
  await h.repo.set(COLLECTIONS.states, seeded._id, seeded);

  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(result.notificationStatus, 'unknown');
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual(
    {
      available: state.available,
      reserved: state.reserved,
      consumedTotal: state.consumedTotal,
      releasedTotal: state.releasedTotal,
      grantedTotal: state.grantedTotal,
      version: state.version
    },
    { available: 4, reserved: 1, consumedTotal: 6, releasedTotal: 6, grantedTotal: 11, version: 37 }
  );
  validateState(state);
});

test('SDK-10 duplicate negative SDK event remains one task delivery and attempt', async () => {
  const h = harness({ send: async () => { throw { errCode: -501001, errMsg: 'redacted' }; } });
  const paired = await pair(h);
  await grantOne(h);
  const payload = eventFor(paired.desktop.desktopId);
  const first = await h.service.createEvent(paired.credential, payload, REQUEST_ID);
  const duplicate = await h.service.createEvent(paired.credential, payload, REQUEST_ID);
  assert.equal(first.notificationStatus, 'unknown');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.notificationStatus, 'unknown');
  assert.equal((await h.repo.snapshot(COLLECTIONS.tasks)).length, 1);
  const deliveries = await h.repo.snapshot(COLLECTIONS.deliveries);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].attemptCount, 1);
  assert.equal(h.sends.length, 1);
});

test('QUOTA-05 uncertain provider outcome retains reservation until explicit reconciliation', async () => {
  const h = harness({ send: async () => { throw new Error('synthetic timeout'); } });
  const paired = await pair(h);
  await grantOne(h);
  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(result.notificationStatus, 'unknown');
  let state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual({ available: state.available, reserved: state.reserved, consumed: state.consumedTotal }, { available: 0, reserved: 1, consumed: 0 });
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.providerErrcode, null);
  assert.equal(delivery.providerErrmsgCode, 'provider_call_uncertain');
  await h.service.reconcileUnknown(delivery._id, 'failed');
  assert.equal((await h.service.reconcileUnknown(delivery._id, 'failed')).changed, false);
  state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual({ available: state.available, reserved: state.reserved }, { available: 1, reserved: 0 });
  validateState(state);
});

test('QR-01 normal sent settlement retains quotaReserved provenance while consuming the live reservation', async () => {
  const h = harness();
  const paired = await pair(h);
  await grantOne(h);
  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(result.notificationStatus, 'sent');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.quotaReserved, true);
  assert.deepEqual(
    { available: state.available, reserved: state.reserved, consumedTotal: state.consumedTotal, releasedTotal: state.releasedTotal },
    { available: 0, reserved: 0, consumedTotal: 1, releasedTotal: 0 }
  );
  validateState(state);
});

test('QR-02 normal failed settlement retains quotaReserved provenance while releasing the live reservation', async () => {
  const h = harness({ send: async () => ({ errcode: 43101, errmsg: 'synthetic rejection' }) });
  const paired = await pair(h);
  await grantOne(h);
  const result = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(result.notificationStatus, 'failed');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(delivery.status, 'failed');
  assert.equal(delivery.quotaReserved, true);
  assert.deepEqual(
    { available: state.available, reserved: state.reserved, consumedTotal: state.consumedTotal, releasedTotal: state.releasedTotal },
    { available: 1, reserved: 0, consumedTotal: 0, releasedTotal: 1 }
  );
  validateState(state);
});

test('QR-03 unknown-to-failed reconciliation retains quotaReserved provenance and releases the live reservation', async () => {
  const h = harness({ send: async () => { throw new Error('synthetic timeout'); } });
  const paired = await pair(h);
  await grantOne(h);
  await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  const before = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  const result = await h.service.reconcileUnknown(before._id, 'failed');
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  const task = (await h.repo.snapshot(COLLECTIONS.tasks))[0];
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(result.changed, true);
  assert.deepEqual(
    { status: delivery.status, quotaReserved: delivery.quotaReserved, providerErrcode: delivery.providerErrcode, providerErrmsgCode: delivery.providerErrmsgCode },
    { status: 'failed', quotaReserved: true, providerErrcode: null, providerErrmsgCode: 'reconciled' }
  );
  assert.equal(task.notificationStatus, 'failed');
  assert.deepEqual(
    { available: state.available, reserved: state.reserved, consumedTotal: state.consumedTotal, releasedTotal: state.releasedTotal },
    { available: 1, reserved: 0, consumedTotal: 0, releasedTotal: 1 }
  );
  validateState(state);
});

test('QR-04 repeated reconciliation is idempotent by terminal status while quotaReserved provenance remains true', async () => {
  const h = harness({ send: async () => { throw new Error('synthetic timeout'); } });
  const paired = await pair(h);
  await grantOne(h);
  await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  const unknown = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  assert.equal((await h.service.reconcileUnknown(unknown._id, 'failed')).changed, true);
  const stateAfterFirst = (await h.repo.snapshot(COLLECTIONS.states))[0];
  const result = await h.service.reconcileUnknown(unknown._id, 'failed');
  const deliveryAfterSecond = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  const stateAfterSecond = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(result.changed, false);
  assert.equal(deliveryAfterSecond.status, 'failed');
  assert.equal(deliveryAfterSecond.quotaReserved, true);
  assert.deepEqual(stateAfterSecond, stateAfterFirst);
  validateState(stateAfterSecond);
});

test('PRIVACY-01 server rejects forbidden or non-null privacy content without storing it', async () => {
  const h = harness();
  const paired = await pair(h);
  const base = eventFor(paired.desktop.desktopId);
  assert.equal(await errorCode(h.service.createEvent(paired.credential, { ...base, prompt: 'secret' }, REQUEST_ID)), 'privacy_payload_rejected');
  assert.equal(await errorCode(h.service.createEvent(paired.credential, { ...base, summary: 'secret' }, REQUEST_ID)), 'privacy_payload_rejected');
  assert.equal((await h.repo.snapshot(COLLECTIONS.tasks)).length, 0);
  const logs = await h.repo.snapshot(COLLECTIONS.security);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
});

test('PRIVACY-02 full mode uses an exact allowlist and one-paragraph summary', async () => {
  const h = harness();
  const paired = await pair(h);
  const good = eventFor(paired.desktop.desktopId, { eventId: 'evt-full', privacyMode: false, project: 'token-m', summary: '完成测试' });
  const result = await h.service.createEvent(paired.credential, good, REQUEST_ID);
  assert.equal(result.status, 'created');
  assert.equal(await errorCode(h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId, { eventId: 'evt-newline', privacyMode: false, summary: 'line1\nline2' }), REQUEST_ID)), 'privacy_payload_rejected');
  assert.equal(await errorCode(h.service.createEvent(paired.credential, { ...eventFor(paired.desktop.desktopId, { eventId: 'evt-files', privacyMode: false }), files: ['a'] }, REQUEST_ID)), 'privacy_payload_rejected');
});

test('OWNERSHIP-01 task reads return the same not-found error across owners', async () => {
  const h = harness();
  const paired = await pair(h, USER_A, 'A 的电脑');
  await bootstrap(h, USER_B);
  const created = await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId), REQUEST_ID);
  assert.equal(await errorCode(h.service.getTask(USER_B, created.taskId)), 'task_not_found');
  assert.equal(await errorCode(h.service.getTask(USER_B, 'tsk_abcdefghijklmnopqrstuv')), 'task_not_found');
  assert.equal((await h.service.listTasks(USER_B)).items.length, 0);
});

test('OWNERSHIP-02 desktop mutations require owner and active state', async () => {
  const h = harness();
  const paired = await pair(h, USER_A);
  await bootstrap(h, USER_B);
  assert.equal(await errorCode(h.service.renameDesktop(USER_B, paired.desktop.desktopId, '抢占')), 'unauthorized');
  assert.equal(await errorCode(h.service.revokeDesktopByOwner(USER_B, paired.desktop.desktopId, REQUEST_ID)), 'unauthorized');
  const desktops = await h.service.listDesktops(USER_B);
  assert.equal(desktops.items.length, 0);
});

test('DELETE-01 history becomes invisible immediately and account deletion revokes auth', async () => {
  const h = harness({ config: { cleanupBatchSize: 1 } });
  const paired = await pair(h);
  await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId, { eventId: 'evt-delete-a' }), REQUEST_ID);
  await h.service.createEvent(paired.credential, eventFor(paired.desktop.desktopId, { eventId: 'evt-delete-b' }), REQUEST_ID);
  const clear = await h.service.clearTaskHistory(USER_A);
  assert.equal(clear.deletedCount, 1);
  assert.equal(clear.cleanupPending, true);
  assert.equal((await h.service.listTasks(USER_A)).items.length, 0);
  const deleted = await h.service.deleteAccount(USER_A, REQUEST_ID);
  assert.equal(deleted.cleanupPending, true);
  assert.equal(await errorCode(h.service.getDesktopStatus(paired.credential, REQUEST_ID)), 'unauthenticated');
  assert.equal(await errorCode(h.service.getDashboard(USER_A)), 'unauthorized');
});

test('miniapp dispatcher discards confirmed platform fields and rejects unknown business keys', async () => {
  const h = harness();
  const ok = await h.app.invokeMini({
    action: 'bootstrap',
    requestId: REQUEST_ID,
    tcbContext: { appId: 'untrusted-event-value' },
    userInfo: { nickName: 'untrusted-event-value' },
  }, USER_A);
  assert.equal(ok.ok, true);
  const desktops = await h.app.invokeMini({
    action: 'listDesktops',
    requestId: REQUEST_ID,
    tcbContext: {},
    userInfo: {},
  }, USER_A);
  assert.deepEqual(desktops.items, []);
  const rejected = await h.app.invokeMini({ action: 'getDashboard', requestId: REQUEST_ID, userId: ok.user.id }, USER_B);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'invalid_request');
});

test('production configuration fails closed and validates logical keyword types', () => {
  const validEnv = {
    PAIRING_CODE_PEPPER: 'pairing-pepper-for-tests-only-32-bytes-long',
    DEVICE_SECRET_PEPPER: 'device-pepper-for-tests-only-32-bytes-long',
    WECHAT_SUBSCRIBE_TEMPLATE_ID: 'synthetic-template-id',
    WECHAT_HTTP_PUBLIC_ORIGIN: 'https://tokenm.test',
    WECHAT_MINIPROGRAM_STATE: 'trial',
    WECHAT_TEMPLATE_KEYWORDS: JSON.stringify({ completion: { key: 'thing1', type: 'thing' }, status: { key: 'phrase2', type: 'phrase' } })
  };
  assert.equal(loadConfig(validEnv).miniprogramState, 'trial');
  assert.throws(() => loadConfig({ ...validEnv, MOCK_SENDER: 'true' }), (error) => error.code === 'configuration_required');
  assert.throws(() => loadConfig({ ...validEnv, WECHAT_TEMPLATE_KEYWORDS: JSON.stringify({ status: { key: 'thing1', type: 'thing' } }) }), (error) => error.code === 'configuration_required');
  assert.throws(() => loadConfig({ ...validEnv, DEVICE_SECRET_PEPPER: validEnv.PAIRING_CODE_PEPPER }), (error) => error.code === 'configuration_required');
});

test('production sender calls CloudBase openapi with bounded template values', async () => {
  const calls = [];
  const fakeCloud = { openapi: { subscribeMessage: { async send(payload) { calls.push(payload); return { errcode: 0 }; } } } };
  const cfg = config();
  const sender = createWechatSender(fakeCloud, cfg);
  const task = {
    _id: 'tsk_abcdefghijklmnopqrstuv',
    occurredAt: new Date('2026-08-18T08:00:00.000Z'),
    privacyMode: true,
    project: null,
    model: null,
    summary: null
  };
  const desktop = { name: '一台名称非常非常非常非常非常非常非常非常长的测试电脑' };
  const data = buildTemplateData(cfg, { task, desktop });
  assert.equal([...data.thing3.value].length, 20);
  await sender.send({ openid: 'synthetic-openid', task, desktop });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].touser, 'synthetic-openid');
  assert.equal(calls[0].miniprogramState, 'trial');
  assert.equal(calls[0].lang, 'zh_CN');
});
