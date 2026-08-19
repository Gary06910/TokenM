'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('./helpers/createHarness');
const { DesktopClientMock } = require('./helpers/desktopClientMock');
const { createManualClock } = require('./helpers/manualClock');
const { MockWeChatSender } = require('./helpers/mockWeChatSender');

const REQUEST_ID = 'req_contractTest000001';

function privacyEvent(desktopId, eventId = 'evt_contract_1') {
  return {
    schemaVersion: 1,
    eventId,
    event: 'codex.task.completed',
    desktopId,
    occurredAt: '2026-08-18T08:00:00.000Z',
    privacyMode: true,
    sessionId: `session-${eventId}`,
    project: null,
    model: null,
    summary: null,
    durationMs: null,
  };
}

async function acceptGrant(harness, openId) {
  const prepared = await harness.miniCall(openId, { action: 'prepareSubscriptionGrant', requestId: REQUEST_ID });
  return harness.miniCall(openId, {
    action: 'recordSubscriptionOutcome',
    requestId: REQUEST_ID,
    grantIntentId: prepared.grantIntentId,
    result: 'accept',
  });
}

async function pairedHarness({ quota = 0, senderResults = [] } = {}) {
  const clock = createManualClock();
  const sender = new MockWeChatSender(senderResults);
  const harness = await createHarness({ clock, sender });
  const openId = 'synthetic-openid-user-a';
  const bootstrap = await harness.miniCall(openId, { action: 'bootstrap', requestId: REQUEST_ID });
  for (let index = 0; index < quota; index += 1) await acceptGrant(harness, openId);
  const pairing = await harness.miniCall(openId, { action: 'createPairingCode', requestId: REQUEST_ID });
  const desktop = new DesktopClientMock(harness);
  const paired = await desktop.pair(pairing.code);
  assert.equal(paired.statusCode, 201);
  return { bootstrap, clock, desktop, harness, openId, sender };
}

test('PAIR-01 valid code creates one active desktop and one credential', async () => {
  const { desktop, harness, openId } = await pairedHarness();
  assert.match(desktop.credential, /^tm_wx_d1\.dev_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  const listed = await harness.miniCall(openId, { action: 'listDesktops', requestId: REQUEST_ID });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].status, 'active');
  assert.equal('credential' in listed.items[0], false);
});

test('PAIR-02 expired code returns uniform pairing_invalid without credential', async () => {
  const clock = createManualClock();
  const harness = await createHarness({ clock, sender: new MockWeChatSender() });
  await harness.miniCall('synthetic-openid-a', { action: 'bootstrap', requestId: REQUEST_ID });
  const pairing = await harness.miniCall('synthetic-openid-a', { action: 'createPairingCode', requestId: REQUEST_ID });
  clock.advance(600_001);
  const response = await new DesktopClientMock(harness).pair(pairing.code);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error.code, 'pairing_invalid');
  assert.equal('credential' in response.body, false);
});

test('PAIR-03 pairing code is single-use', async () => {
  const clock = createManualClock();
  const harness = await createHarness({ clock, sender: new MockWeChatSender() });
  await harness.miniCall('synthetic-openid-a', { action: 'bootstrap', requestId: REQUEST_ID });
  const pairing = await harness.miniCall('synthetic-openid-a', { action: 'createPairingCode', requestId: REQUEST_ID });
  assert.equal((await new DesktopClientMock(harness).pair(pairing.code)).statusCode, 201);
  const replay = await new DesktopClientMock(harness).pair(pairing.code);
  assert.equal(replay.statusCode, 404);
  assert.equal(replay.body.error.code, 'pairing_invalid');
});

test('PAIR-04 wrong code has no credential and does not enumerate state', async () => {
  const clock = createManualClock();
  const harness = await createHarness({ clock, sender: new MockWeChatSender() });
  await harness.miniCall('synthetic-openid-a', { action: 'bootstrap', requestId: REQUEST_ID });
  const wrong = await new DesktopClientMock(harness).pair('999999');
  clock.advance(600_001);
  const absent = await new DesktopClientMock(harness).pair('888888');
  assert.equal(wrong.statusCode, 404);
  assert.deepEqual(wrong.body, absent.body);
  assert.equal(JSON.stringify(wrong).includes('credential'), false);
});

test('AUTH-01 bad secret is rejected', async () => {
  const { desktop } = await pairedHarness();
  const response = await desktop.status(`${desktop.credential.slice(0, -1)}x`);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.code, 'unauthenticated');
});

test('AUTH-02 revoked desktop credential is rejected immediately', async () => {
  const { desktop, harness, openId } = await pairedHarness();
  const unbound = await harness.miniCall(openId, {
    action: 'unbindDesktop', requestId: REQUEST_ID, desktopId: desktop.desktopId, confirmation: 'UNBIND',
  });
  assert.equal(unbound.ok, true);
  assert.equal((await desktop.status()).statusCode, 401);
});

test('EVENT-01 completion creates one task', async () => {
  const { bootstrap, desktop, harness } = await pairedHarness();
  const response = await desktop.sendEvent(privacyEvent(desktop.desktopId));
  assert.equal(response.statusCode, 201);
  assert.equal(harness.snapshot(bootstrap.user.id).tasks.length, 1);
});

test('EVENT-02 same event x3 creates one task', async () => {
  const { bootstrap, desktop, harness } = await pairedHarness({ quota: 1 });
  const event = privacyEvent(desktop.desktopId);
  const responses = await Promise.all([desktop.sendEvent(event), desktop.sendEvent(event), desktop.sendEvent(event)]);
  assert.deepEqual(responses.map((response) => response.body.status).sort(), ['created', 'duplicate', 'duplicate']);
  assert.equal(harness.snapshot(bootstrap.user.id).tasks.length, 1);
});

test('EVENT-03 duplicate event never sends a second message', async () => {
  const { desktop, sender } = await pairedHarness({ quota: 1 });
  const event = privacyEvent(desktop.desktopId);
  await desktop.sendEvent(event);
  await desktop.sendEvent(event);
  await desktop.sendEvent(event);
  assert.equal(sender.calls.length, 1);
});

test('EVENT-04 duplicate event never mutates quota twice', async () => {
  const { bootstrap, desktop, harness } = await pairedHarness({ quota: 2 });
  const event = privacyEvent(desktop.desktopId);
  await desktop.sendEvent(event);
  const afterFirst = harness.snapshot(bootstrap.user.id).state;
  await desktop.sendEvent(event);
  await desktop.sendEvent(event);
  assert.deepEqual(harness.snapshot(bootstrap.user.id).state, afterFirst);
  assert.equal(afterFirst.available, 1);
  assert.equal(afterFirst.consumedTotal, 1);
});

test('QUOTA-01 accepted grant adds exactly one and replay adds zero', async () => {
  const harness = await createHarness({ clock: createManualClock(), sender: new MockWeChatSender() });
  const bootstrap = await harness.miniCall('synthetic-openid-a', { action: 'bootstrap', requestId: REQUEST_ID });
  const prepared = await harness.miniCall('synthetic-openid-a', { action: 'prepareSubscriptionGrant', requestId: REQUEST_ID });
  const request = {
    action: 'recordSubscriptionOutcome', requestId: REQUEST_ID,
    grantIntentId: prepared.grantIntentId, result: 'accept',
  };
  assert.equal((await harness.miniCall('synthetic-openid-a', request)).quota.available, 1);
  assert.equal((await harness.miniCall('synthetic-openid-a', request)).duplicate, true);
  assert.equal(harness.snapshot(bootstrap.user.id).state.available, 1);
});

test('QUOTA-02 successful delivery consumes one reservation', async () => {
  const { bootstrap, desktop, harness } = await pairedHarness({ quota: 1 });
  assert.equal((await desktop.sendEvent(privacyEvent(desktop.desktopId))).body.notificationStatus, 'sent');
  assert.deepEqual(harness.snapshot(bootstrap.user.id).state, {
    available: 0, reserved: 0, grantedTotal: 1, consumedTotal: 1, releasedTotal: 0, version: 4,
  });
});

test('QUOTA-03 explicit provider failure releases reservation without consumption', async () => {
  const { bootstrap, desktop, harness } = await pairedHarness({
    quota: 1,
    senderResults: [{ kind: 'failure', errcode: 43101 }],
  });
  assert.equal((await desktop.sendEvent(privacyEvent(desktop.desktopId))).body.notificationStatus, 'failed');
  const state = harness.snapshot(bootstrap.user.id).state;
  assert.equal(state.available, 1);
  assert.equal(state.reserved, 0);
  assert.equal(state.consumedTotal, 0);
  assert.equal(state.releasedTotal, 1);
});

test('QUOTA-04 quota zero still persists task as skipped', async () => {
  const { bootstrap, desktop, harness, sender } = await pairedHarness();
  const response = await desktop.sendEvent(privacyEvent(desktop.desktopId));
  const snapshot = harness.snapshot(bootstrap.user.id);
  assert.equal(response.body.notificationStatus, 'skipped_no_quota');
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.deliveries.length, 0);
  assert.equal(sender.calls.length, 0);
});

test('QUOTA-05 concurrent events never make quota negative', async () => {
  const { bootstrap, desktop, harness, sender } = await pairedHarness({ quota: 1 });
  const responses = await Promise.all([
    desktop.sendEvent(privacyEvent(desktop.desktopId, 'evt_concurrent_1')),
    desktop.sendEvent(privacyEvent(desktop.desktopId, 'evt_concurrent_2')),
  ]);
  const snapshot = harness.snapshot(bootstrap.user.id);
  assert.equal(responses.filter((response) => response.body.notificationStatus === 'sent').length, 1);
  assert.equal(responses.filter((response) => response.body.notificationStatus === 'skipped_no_quota').length, 1);
  assert.ok(snapshot.state.available >= 0);
  assert.ok(snapshot.state.reserved >= 0);
  assert.equal(sender.calls.length, 1);
});

test('PRIVACY-01 forbidden privacy payload is denied without persistence', async () => {
  const { bootstrap, desktop, harness, sender } = await pairedHarness({ quota: 1 });
  const event = { ...privacyEvent(desktop.desktopId), prompt: 'synthetic forbidden prompt' };
  const response = await desktop.sendEvent(event);
  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, 'privacy_payload_rejected');
  assert.equal(harness.snapshot(bootstrap.user.id).tasks.length, 0);
  assert.equal(sender.calls.length, 0);
});

test('PRIVACY-02 full mode accepts only the frozen allowlist', async () => {
  const { desktop, harness, openId } = await pairedHarness();
  const event = {
    ...privacyEvent(desktop.desktopId, 'evt_full_1'),
    privacyMode: false,
    project: 'token-monitor', model: 'gpt-5.6', summary: 'Synthetic result.', durationMs: 1234,
  };
  const created = await desktop.sendEvent(event);
  const detail = await harness.miniCall(openId, {
    action: 'getTask', requestId: REQUEST_ID, taskId: created.body.taskId,
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(
    { project: detail.task.project, model: detail.task.model, summary: detail.task.summary, durationMs: detail.task.durationMs },
    { project: 'token-monitor', model: 'gpt-5.6', summary: 'Synthetic result.', durationMs: 1234 },
  );
});

test('OWNERSHIP-01 user A task is uniformly hidden from user B', async () => {
  const { desktop, harness, openId } = await pairedHarness();
  const created = await desktop.sendEvent(privacyEvent(desktop.desktopId));
  await harness.miniCall('synthetic-openid-user-b', { action: 'bootstrap', requestId: REQUEST_ID });
  const foreign = await harness.miniCall('synthetic-openid-user-b', {
    action: 'getTask', requestId: REQUEST_ID, taskId: created.body.taskId,
  });
  const missing = await harness.miniCall(openId, {
    action: 'getTask', requestId: REQUEST_ID, taskId: 'tsk_0000000000000000000000',
  });
  assert.equal(foreign.error.code, 'task_not_found');
  assert.deepEqual(foreign.error, missing.error);
  assert.equal((await harness.miniCall('synthetic-openid-user-b', {
    action: 'listTasks', requestId: REQUEST_ID,
  })).items.length, 0);
});

test('OWNERSHIP-02 desktop A cannot write an event for desktop B', async () => {
  const { desktop: desktopA, harness } = await pairedHarness({ quota: 1 });
  await harness.miniCall('synthetic-openid-user-b', { action: 'bootstrap', requestId: REQUEST_ID });
  const pairB = await harness.miniCall('synthetic-openid-user-b', { action: 'createPairingCode', requestId: REQUEST_ID });
  const desktopB = new DesktopClientMock(harness);
  await desktopB.pair(pairB.code, 'User B Desktop');
  const response = await desktopA.sendEvent(privacyEvent(desktopB.desktopId));
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, 'unauthorized');
  assert.equal((await harness.miniCall('synthetic-openid-user-b', {
    action: 'listTasks', requestId: REQUEST_ID,
  })).items.length, 0);
});

test('DELETE-01 clear history hides tasks immediately and reports cleanup state', async () => {
  const { bootstrap, desktop, harness, openId } = await pairedHarness();
  await desktop.sendEvent(privacyEvent(desktop.desktopId));
  const cleared = await harness.miniCall(openId, {
    action: 'clearTaskHistory', requestId: REQUEST_ID, confirmation: 'CLEAR',
  });
  const listed = await harness.miniCall(openId, { action: 'listTasks', requestId: REQUEST_ID });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.deletedCount, 1);
  assert.equal(cleared.cleanupPending, true);
  assert.equal(listed.items.length, 0);
  assert.equal(harness.snapshot(bootstrap.user.id).tasks.length, 1, 'physical cleanup may remain pending');
});
