'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('./helpers/createHarness');
const { DesktopClientMock } = require('./helpers/desktopClientMock');
const { createManualClock } = require('./helpers/manualClock');
const { MockWeChatSender } = require('./helpers/mockWeChatSender');

const REQUEST_ID = 'req_p0Integration0001';

function event(desktopId, eventId, occurredAt) {
  return {
    schemaVersion: 1,
    eventId,
    event: 'codex.task.completed',
    desktopId,
    occurredAt,
    privacyMode: true,
    sessionId: `session-${eventId}`,
    project: null,
    model: null,
    summary: null,
    durationMs: null,
  };
}

async function grant(harness, openId) {
  const intent = await harness.miniCall(openId, { action: 'prepareSubscriptionGrant', requestId: REQUEST_ID });
  return harness.miniCall(openId, {
    action: 'recordSubscriptionOutcome',
    requestId: REQUEST_ID,
    grantIntentId: intent.grantIntentId,
    result: 'accept',
  });
}

test('P0-E2E bootstrap, pair, idempotency, quota exhaustion, and user isolation', async () => {
  const clock = createManualClock();
  const sender = new MockWeChatSender();
  const harness = await createHarness({ clock, sender });
  const userAOpenId = 'synthetic-openid-p0-user-a';
  const userBOpenId = 'synthetic-openid-p0-user-b';

  const userA = await harness.miniCall(userAOpenId, { action: 'bootstrap', requestId: REQUEST_ID });
  const pairing = await harness.miniCall(userAOpenId, { action: 'createPairingCode', requestId: REQUEST_ID });
  const desktop = new DesktopClientMock(harness);
  assert.equal((await desktop.pair(pairing.code, 'P0 Desktop')).statusCode, 201);

  await grant(harness, userAOpenId);
  await grant(harness, userAOpenId);
  assert.equal(harness.snapshot(userA.user.id).state.available, 2);

  const event1 = event(desktop.desktopId, 'evt_p0_1', clock.now().toISOString());
  const event1Responses = await Promise.all([
    desktop.sendEvent(event1),
    desktop.sendEvent(event1),
    desktop.sendEvent(event1),
  ]);
  assert.deepEqual(event1Responses.map((response) => response.body.status).sort(), ['created', 'duplicate', 'duplicate']);
  assert.equal(new Set(event1Responses.map((response) => response.body.taskId)).size, 1);
  assert.equal(sender.calls.length, 1);
  assert.equal(harness.snapshot(userA.user.id).state.available, 1);

  clock.advance(1_000);
  const event2Response = await desktop.sendEvent(event(desktop.desktopId, 'evt_p0_2', clock.now().toISOString()));
  assert.equal(event2Response.body.notificationStatus, 'sent');
  assert.equal(sender.calls.length, 2);
  assert.equal(harness.snapshot(userA.user.id).state.available, 0);

  clock.advance(1_000);
  const event3Response = await desktop.sendEvent(event(desktop.desktopId, 'evt_p0_3', clock.now().toISOString()));
  assert.equal(event3Response.body.notificationStatus, 'skipped_no_quota');

  const finalA = harness.snapshot(userA.user.id);
  assert.equal(finalA.tasks.length, 3);
  assert.equal(finalA.deliveries.length, 2);
  assert.equal(finalA.deliveries.filter((delivery) => delivery.attemptCount === 1).length, 2);
  assert.equal(finalA.state.available, 0);
  assert.equal(finalA.state.reserved, 0);
  assert.equal(finalA.state.consumedTotal, 2);
  assert.equal(sender.calls.length, 2);
  assert.equal(new Set(sender.calls.map((call) => call.deliveryId)).size, 2);

  await harness.miniCall(userBOpenId, { action: 'bootstrap', requestId: REQUEST_ID });
  const userBTasks = await harness.miniCall(userBOpenId, { action: 'listTasks', requestId: REQUEST_ID });
  const userBDesktops = await harness.miniCall(userBOpenId, { action: 'listDesktops', requestId: REQUEST_ID });
  assert.equal(userBTasks.items.length, 0);
  assert.equal(userBDesktops.items.length, 0);
  assert.equal((await harness.miniCall(userBOpenId, {
    action: 'getTask', requestId: REQUEST_ID, taskId: event1Responses[0].body.taskId,
  })).error.code, 'task_not_found');
});
