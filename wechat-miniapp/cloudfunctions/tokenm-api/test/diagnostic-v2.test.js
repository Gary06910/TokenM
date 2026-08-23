'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, test } = require('node:test');

const tcb = require('@cloudbase/node-sdk');
const { createLogger } = require('../lib/logger');
const { createMemoryRepository } = require('../lib/repository');
const {
  classifyProviderError,
  classifyProviderResult,
  describeProviderError
} = require('../lib/sender');
const { COLLECTIONS, createService } = require('../lib/service');
const { applyPatch, verifyPatchedSource } = require('../patches/wx-server-sdk+4.0.2-tokenm-diagnostic-v2');

const REQUEST_ID = 'req_diagnostic_v2';
const USER = { appId: 'wx-test-app', openid: 'openid-test-only' };
const ELAPSED_BUCKETS = new Set(['0_99', '100_249', '250_499', '500_999', '1000_1999', '2000_4999', '5000_plus']);
const originalTcbInit = tcb.init;
let lowerHandler = async () => { throw new Error('handler not configured'); };
let lowerCalls = 0;
let lowerArguments = [];

tcb.init = () => ({
  async callCompatibleWxOpenApi(options) {
    lowerCalls += 1;
    lowerArguments.push(options);
    return lowerHandler(options);
  },
  logger() {}
});
delete require.cache[require.resolve('wx-server-sdk')];
const patchedCloud = require('wx-server-sdk').createNewInstance({ env: 'offline-diagnostic-v2' });

after(() => {
  tcb.init = originalTcbInit;
});

function resetLower(handler) {
  lowerHandler = handler;
  lowerCalls = 0;
  lowerArguments = [];
}

async function callPatchedSdk() {
  try {
    await patchedCloud.openapi.subscribeMessage.send({
      touser: 'offline-openid',
      templateId: 'offline-template',
      data: { thing1: { value: 'offline-value' } },
      miniprogramState: 'developer',
      lang: 'zh_CN'
    });
  } catch (error) {
    return error;
  }
  assert.fail('expected the offline lower-level stub to reject');
}

function serviceConfig() {
  return {
    pairingPepper: 'pairing-pepper-for-tests-only-32-bytes-long',
    devicePepper: 'device-pepper-for-tests-only-32-bytes-long',
    cursorKey: 'cursor-key-for-tests-only-32-bytes-long',
    templateId: 'synthetic-template-id',
    templateIdHash: crypto.createHash('sha256').update('synthetic-template-id').digest('hex'),
    templateKeywords: { completion: { key: 'thing1', type: 'thing' } },
    publicOrigin: 'https://tokenm.test',
    miniprogramState: 'developer',
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
    grantRateWindowMs: 600000
  };
}

function serviceHarness(send, logger) {
  const repo = createMemoryRepository();
  const sends = [];
  const sender = {
    async send(context) {
      sends.push(context);
      return send(context);
    }
  };
  const service = createService({
    repo,
    sender,
    config: serviceConfig(),
    clock: () => new Date('2026-08-23T08:38:31.000Z'),
    randomInt: () => 7,
    randomBytes: (size) => Buffer.alloc(size, 1),
    logger
  });
  return { repo, sends, service };
}

async function prepareAndComplete(h, eventId = 'evt-v2-1') {
  await h.service.bootstrap(USER);
  const pairing = await h.service.createPairingCode(USER, REQUEST_ID);
  const desktop = await h.service.claimPairing({
    code: pairing.code,
    deviceName: 'offline desktop',
    networkSubject: 'offline-network',
    requestId: REQUEST_ID
  });
  const intent = await h.service.prepareSubscriptionGrant(USER, REQUEST_ID);
  await h.service.recordSubscriptionOutcome(USER, intent.grantIntentId, 'accept', REQUEST_ID);
  const event = {
    schemaVersion: 1,
    eventId,
    event: 'codex.task.completed',
    desktopId: desktop.desktop.desktopId,
    occurredAt: '2026-08-23T08:38:31.000Z',
    privacyMode: true,
    sessionId: 'session-v2',
    project: null,
    model: null,
    summary: null,
    durationMs: null
  };
  const result = await h.service.createEvent(desktop.credential, event, REQUEST_ID);
  return { desktop, event, result };
}

function captureLogger() {
  const lines = [];
  const output = Object.fromEntries(['info', 'warn', 'error', 'log'].map((level) => [level, (line) => lines.push(line)]));
  return { lines, logger: createLogger(output) };
}

function normalizedSnapshot(h, delivery, state) {
  return {
    calls: h.sends.length,
    status: delivery.status,
    providerErrcode: delivery.providerErrcode,
    providerErrmsgCode: delivery.providerErrmsgCode,
    attemptCount: delivery.attemptCount,
    quotaReserved: delivery.quotaReserved,
    available: state.available,
    reserved: state.reserved,
    consumedTotal: state.consumedTotal,
    releasedTotal: state.releasedTotal,
    grantedTotal: state.grantedTotal
  };
}

test('V2-01 preserves a structured TCB code and safe request identifier before normalization', async () => {
  resetLower(async () => ({ code: 'SYS_ERR', message: 'SECRET_BACKEND_TEXT', requestId: 'tcb:req_123' }));
  const error = await callPatchedSdk();
  assert.equal(error.errCode, -501001);
  assert.deepEqual({ ...error.upstreamEvidence, elapsedMsBucket: null }, {
    originKind: 'tcb_response_code',
    innerCodeSafe: 'SYS_ERR',
    upstreamRequestIdSafe: 'tcb:req_123',
    httpStatusSafe: null,
    transportCodeSafe: null,
    sdkSeqIdSafe: null,
    elapsedMsBucket: null
  });
  assert.equal(ELAPSED_BUCKETS.has(error.upstreamEvidence.elapsedMsBucket), true);
  assert.equal(Object.keys(error).includes('upstreamEvidence'), false);
});

test('V2-02 classifies a structured HTTP 5xx status without parsing message text', async () => {
  resetLower(async () => { throw Object.assign(new Error('SECRET_HTTP_TEXT'), { code: 503, statusCode: 503 }); });
  const error = await callPatchedSdk();
  assert.equal(error.upstreamEvidence.originKind, 'http_status');
  assert.equal(error.upstreamEvidence.httpStatusSafe, 503);
  assert.equal(error.upstreamEvidence.innerCodeSafe, 503);
});

test('V2-03 preserves allowlisted ECONNRESET as a transport error', async () => {
  resetLower(async () => { throw Object.assign(new Error('SECRET_NETWORK_TEXT'), { code: 'ECONNRESET' }); });
  const error = await callPatchedSdk();
  assert.equal(error.upstreamEvidence.originKind, 'transport_error');
  assert.equal(error.upstreamEvidence.transportCodeSafe, 'ECONNRESET');
  assert.equal(error.upstreamEvidence.innerCodeSafe, 'ECONNRESET');
});

test('V2-04 drops an unknown string code instead of treating it as transport metadata', async () => {
  resetLower(async () => { throw Object.assign(new Error('SECRET'), { code: 'SECRET_USER_TEXT' }); });
  const error = await callPatchedSdk();
  assert.equal(error.upstreamEvidence.originKind, 'unknown');
  assert.equal(error.upstreamEvidence.transportCodeSafe, null);
  assert.equal(error.upstreamEvidence.innerCodeSafe, null);
});

test('V2-05 retains only bounded request identifiers with allowed characters', async () => {
  for (const [requestId, expected] of [
    ['safe.req_1:part-2', 'safe.req_1:part-2'],
    ['unsafe/request', null],
    ['x'.repeat(129), null]
  ]) {
    resetLower(async () => { throw Object.assign(new Error('SECRET'), { code: 'SYS_ERR', requestId }); });
    const error = await callPatchedSdk();
    assert.equal(error.upstreamEvidence.upstreamRequestIdSafe, expected);
  }
});

test('V2-06 excludes raw message, errMsg, stack, openid, and credential from the diagnostic log', () => {
  const capture = captureLogger();
  const error = Object.assign(new Error('SECRET_X'), {
    errCode: -501001,
    errMsg: 'SECRET_Y',
    stack: 'SECRET_Z',
    openid: 'SECRET_OPENID',
    credential: 'SECRET_CRED'
  });
  Object.defineProperty(error, 'upstreamEvidence', {
    value: {
      originKind: 'transport_error',
      innerCodeSafe: 'ECONNRESET',
      upstreamRequestIdSafe: 'safe:req-1',
      httpStatusSafe: null,
      transportCodeSafe: 'ECONNRESET',
      sdkSeqIdSafe: null,
      elapsedMsBucket: '100_249'
    }
  });
  const diagnostic = describeProviderError(error);
  capture.logger.warn({ event: 'wechat_provider_throw_unclassified', upstreamEvidence: diagnostic.upstreamEvidence });
  const serialized = capture.lines.join('\n');
  for (const secret of ['SECRET_X', 'SECRET_Y', 'SECRET_Z', 'SECRET_OPENID', 'SECRET_CRED']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes('ECONNRESET'), true);
});

test('V2-07 never recursively traverses or emits arbitrary nested objects', () => {
  const capture = captureLogger();
  const error = { errCode: -501001, nested: { deeper: { prompt: 'SECRET_NESTED_PROMPT' } } };
  Object.defineProperty(error, 'upstreamEvidence', {
    value: { originKind: 'unknown', nested: { responseBody: 'SECRET_RESPONSE_BODY' } }
  });
  const diagnostic = describeProviderError(error);
  capture.logger.warn({ event: 'wechat_provider_throw_unclassified', upstreamEvidence: diagnostic.upstreamEvidence });
  const serialized = capture.lines.join('\n');
  assert.equal(serialized.includes('SECRET_NESTED_PROMPT'), false);
  assert.equal(serialized.includes('SECRET_RESPONSE_BODY'), false);
});

test('V2-08 returned WeChat errcode 0 remains sent', () => {
  assert.deepEqual(classifyProviderResult({ errcode: 0 }), { status: 'sent', errcode: 0, errmsgCode: null });
});

test('V2-09 returned WeChat errcode 43101 remains failed', () => {
  assert.deepEqual(classifyProviderResult({ errcode: 43101 }), { status: 'failed', errcode: 43101, errmsgCode: 'wechat_43101' });
});

test('V2-10 thrown WeChat errCode 43101 remains failed', () => {
  assert.deepEqual(classifyProviderError({ errCode: 43101, errMsg: 'redacted' }), {
    status: 'failed', errcode: 43101, errmsgCode: 'wechat_43101'
  });
});

test('V2-11 thrown -501001 remains unknown and holds the live reservation', async () => {
  const capture = captureLogger();
  const h = serviceHarness(async () => {
    const error = { errCode: -501001, errMsg: 'SECRET' };
    Object.defineProperty(error, 'upstreamEvidence', {
      value: {
        originKind: 'tcb_response_code',
        innerCodeSafe: 'SYS_ERR',
        upstreamRequestIdSafe: 'tcb:req_501001',
        httpStatusSafe: null,
        transportCodeSafe: null,
        sdkSeqIdSafe: null,
        elapsedMsBucket: '100_249'
      }
    });
    throw error;
  }, capture.logger);
  const { result } = await prepareAndComplete(h);
  const delivery = (await h.repo.snapshot(COLLECTIONS.deliveries))[0];
  const state = (await h.repo.snapshot(COLLECTIONS.states))[0];
  assert.equal(result.notificationStatus, 'unknown');
  assert.deepEqual(normalizedSnapshot(h, delivery, state), {
    calls: 1,
    status: 'unknown',
    providerErrcode: null,
    providerErrmsgCode: 'provider_call_uncertain',
    attemptCount: 1,
    quotaReserved: true,
    available: 0,
    reserved: 1,
    consumedTotal: 0,
    releasedTotal: 0,
    grantedTotal: 1
  });
  const log = JSON.parse(capture.lines[0]);
  assert.equal(log.event, 'wechat_provider_throw_unclassified');
  assert.deepEqual(log.upstreamEvidence, {
    originKind: 'tcb_response_code',
    innerCodeSafe: 'SYS_ERR',
    upstreamRequestIdSafe: 'tcb:req_501001',
    httpStatusSafe: null,
    transportCodeSafe: null,
    sdkSeqIdSafe: null,
    elapsedMsBucket: '100_249'
  });
});

test('V2-12 duplicate event remains one task, one delivery, and one provider attempt', async () => {
  const h = serviceHarness(async () => { throw { errCode: -501001, errMsg: 'SECRET' }; });
  const first = await prepareAndComplete(h, 'evt-v2-duplicate');
  const duplicate = await h.service.createEvent(first.desktop.credential, first.event, REQUEST_ID);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal((await h.repo.snapshot(COLLECTIONS.tasks)).length, 1);
  assert.equal((await h.repo.snapshot(COLLECTIONS.deliveries)).length, 1);
  assert.equal((await h.repo.snapshot(COLLECTIONS.deliveries))[0].attemptCount, 1);
  assert.equal(h.sends.length, 1);
});

test('V2-13 instrumentation makes exactly one lower provider call and adds no retry', async () => {
  resetLower(async () => { throw Object.assign(new Error('SECRET'), { code: 'ETIMEDOUT' }); });
  await callPatchedSdk();
  assert.equal(lowerCalls, 1);
  assert.equal(lowerArguments.length, 1);
  assert.equal(lowerArguments[0].apiName, 'subscribeMessage.send');
  assert.equal(Buffer.isBuffer(lowerArguments[0].requestData), true);
  assert.deepEqual(Object.keys(lowerArguments[0]).sort(), ['apiName', 'cgiName', 'requestData']);
});

test('V2-14 success path preserves sender input, final delivery, and ledger semantics', async () => {
  const before = serviceHarness(async () => ({ errcode: 0 }));
  const after = serviceHarness(async () => ({ errcode: 0 }));
  await prepareAndComplete(before, 'evt-v2-success');
  await prepareAndComplete(after, 'evt-v2-success');
  const beforeDelivery = (await before.repo.snapshot(COLLECTIONS.deliveries))[0];
  const afterDelivery = (await after.repo.snapshot(COLLECTIONS.deliveries))[0];
  const beforeState = (await before.repo.snapshot(COLLECTIONS.states))[0];
  const afterState = (await after.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual(after.sends, before.sends);
  assert.deepEqual(normalizedSnapshot(after, afterDelivery, afterState), normalizedSnapshot(before, beforeDelivery, beforeState));
});

test('V2-15 definite business failure preserves final delivery and ledger semantics', async () => {
  const returned = serviceHarness(async () => ({ errcode: 43101, errmsg: 'SECRET' }));
  const thrown = serviceHarness(async () => { throw { errCode: 43101, errMsg: 'SECRET' }; });
  await prepareAndComplete(returned, 'evt-v2-failed');
  await prepareAndComplete(thrown, 'evt-v2-failed');
  const returnedDelivery = (await returned.repo.snapshot(COLLECTIONS.deliveries))[0];
  const thrownDelivery = (await thrown.repo.snapshot(COLLECTIONS.deliveries))[0];
  const returnedState = (await returned.repo.snapshot(COLLECTIONS.states))[0];
  const thrownState = (await thrown.repo.snapshot(COLLECTIONS.states))[0];
  assert.deepEqual(normalizedSnapshot(thrown, thrownDelivery, thrownState), normalizedSnapshot(returned, returnedDelivery, returnedState));
});

test('PATCH-01 version mismatch and source drift fail closed while an applied patch is idempotent', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const installedSource = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'wx-server-sdk', 'index.js'), 'utf8');
  assert.equal(verifyPatchedSource(installedSource), true);
  assert.deepEqual(applyPatch(installedSource, '4.0.2'), { source: installedSource, changed: false });
  assert.throws(() => applyPatch(installedSource, '4.0.3'), /requires 4\.0\.2/u);
  assert.throws(() => applyPatch('unrecognized upstream source', '4.0.2'), /anchor missing/u);
});
