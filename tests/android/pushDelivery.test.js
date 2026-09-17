'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const core = require('../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core');

const NOW = Date.parse('2026-09-04T08:00:00.000Z');
const OWNER = 'uid-phase2-owner';
const DEVICE_ID = 'device-phase2-primary';

function fixture(sendTaskCompletedNotification) {
  const repository = new core.MemoryRepository();
  const application = new core.TokenMApplication({
    repository,
    credentialKey: Buffer.alloc(32, 7),
    now: () => NOW,
    sendTaskCompletedNotification
  });
  return { application, repository };
}

async function pairDesktop(application, ownerId = OWNER) {
  await application.bootstrap(ownerId);
  const pairing = await application.createPairingCode(ownerId);
  return application.pair({
    schemaVersion: 1,
    code: pairing.code,
    deviceName: 'LAPTOP-0Q9SBHOE'
  }, { rateSubject: 'client-ip:203.0.113.91' });
}

function completionEvent(desktopId, suffix = '1', extra = {}) {
  return {
    schemaVersion: 1,
    eventId: `evt:phase2-session:turn-${suffix}`,
    event: 'codex.task.completed',
    desktopId,
    occurredAt: new Date(NOW).toISOString(),
    privacyMode: true,
    sessionId: `phase2-session-${suffix}`,
    project: null,
    model: null,
    summary: null,
    durationMs: null,
    ...extra
  };
}

async function enableOwner(application, ownerId = OWNER) {
  await application.updatePrivacyConsent(ownerId, { version: core.CURRENT_PRIVACY_VERSION });
  await application.updateSettings(ownerId, { notificationsEnabled: true });
}

async function registerBusinessDevice(application, {
  ownerId = OWNER,
  deviceId = DEVICE_ID,
  enabled = true,
  platform = 'app-android',
  permission = 'authorized',
  registration = 'ready'
} = {}) {
  return application.registerMobileDevice(ownerId, {
    enabled,
    deviceLabel: 'Primary Android',
    pushRegistrationStatus: registration,
    notificationPermissionState: permission
  }, {
    deviceId,
    platform,
    appVersion: '1.0.0'
  });
}

async function addOfficialIdentity(repository, {
  id = 'identity-primary',
  ownerId = OWNER,
  deviceId = DEVICE_ID,
  appId = core.TOKEN_M_DCLOUD_APP_ID,
  expiresAt = NOW + 60_000,
  cid = 'controlled-test-cid-primary'
} = {}) {
  await repository.insert(core.IDENTITY_COLLECTIONS.devices, {
    _id: id,
    user_id: ownerId,
    device_id: deviceId,
    appid: appId,
    token_expired: expiresAt,
    push_clientid: cid
  });
}

async function makeEligible(target, options = {}) {
  await enableOwner(target.application, options.ownerId);
  await registerBusinessDevice(target.application, options);
  await addOfficialIdentity(target.repository, options);
}

function onlyTask(repository) {
  const tasks = repository.snapshot(core.COLLECTIONS.tasks);
  assert.equal(tasks.length, 1);
  return tasks[0];
}

test('provider forensic stages survive the HTTP boundary without repeating a failed event', async () => {
  const { createHttpHandler } = require('../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/tokenm-desktop-http/http-contract');
  const failure = () => Object.assign(new Error('Push application unavailable.'), { errCode: 20001 });
  const scenarios = [
    { name: 'manager throw', stage: 'get_push_manager', code: '20001', runtime: { getPushManager() { throw failure(); } } },
    { name: 'extension absent', stage: 'get_push_manager', code: null, runtime: {} },
    { name: 'send throw', stage: 'send_message', code: '20001', send() { throw failure(); } },
    { name: 'send rejection', stage: 'send_message', code: '20001', send: async () => { throw failure(); } },
    { name: 'timeout', stage: 'provider_timeout', code: null, send: () => new Promise(() => {}) },
    { name: 'nonzero response', stage: 'provider_response', code: '20001', send: async () => ({ errCode: 20001, errMsg: 'Push application unavailable.' }) },
    { name: 'missing response', stage: 'provider_response', code: null, send: async () => undefined },
    { name: 'success', stage: 'provider_response', code: '0', send: async () => ({ errCode: 0, errMsg: 'ok' }) }
  ];
  for (const scenario of scenarios) {
    let attempts = 0;
    const sender = core.createTaskCompletedPushSender({
      runtime: scenario.runtime ?? { getPushManager: () => ({ sendMessage: scenario.send }) },
      timeoutMs: 10
    });
    const target = fixture(async (input) => {
      attempts += 1;
      assert.equal(onlyTask(target.repository).notificationStatus, 'pending');
      return sender(input);
    });
    const paired = await pairDesktop(target.application);
    await makeEligible(target);
    const handle = createHttpHandler({ application: target.application });
    const event = {
      httpMethod: 'POST', path: '/v1/desktop/events',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${paired.credential}` },
      body: JSON.stringify(completionEvent(paired.desktop.desktopId))
    };
    const first = await handle(event);
    const duplicate = await handle(event);
    assert.equal(first.statusCode, 201, scenario.name);
    assert.equal(duplicate.statusCode, 200, scenario.name);
    const task = onlyTask(target.repository);
    assert.equal(task.notificationStatus, scenario.code === '0' ? 'submitted' : 'failed', scenario.name);
    assert.equal(task.notificationProviderStage, scenario.stage, scenario.name);
    assert.equal(task.notificationProviderCode, scenario.code, scenario.name);
    if (scenario.code !== '0') assert.equal(task.notificationReason, 'provider_error');
    if (scenario.code === '20001') assert.equal(task.notificationProviderMessage, 'Push application unavailable.');
    assert.equal(attempts, 1, scenario.name);
    // A fresh application instance must not retry the historical failed event.
    const restarted = new core.TokenMApplication({
      repository: target.repository, credentialKey: Buffer.alloc(32, 7), now: () => NOW,
      sendTaskCompletedNotification: () => { throw new Error('Historical event retried'); }
    });
    assert.equal((await restarted.events(paired.credential, JSON.parse(event.body))).status, 'duplicate');
  }
});

test('persisted diagnostics exclude provider request, CID, credential and task content', async () => {
  for (const resolved of [false, true]) {
    const target = fixture(core.createTaskCompletedPushSender({
      runtime: { getPushManager: () => ({ sendMessage(request) {
        const message = JSON.stringify({ ...request, token: 'FORBIDDEN_TOKEN', summary: 'FORBIDDEN_SUMMARY' });
        if (resolved) return { errCode: 20001, errMsg: message, data: request };
        throw Object.assign(new Error(message), { code: 20001, request, token: 'FORBIDDEN_TOKEN' });
      } }) }
    }));
    const paired = await pairDesktop(target.application);
    await makeEligible(target);
    await target.application.events(paired.credential, completionEvent(paired.desktop.desktopId));
    const task = onlyTask(target.repository);
    const diagnostics = Object.fromEntries(Object.entries(task).filter(([key]) => key.startsWith('notificationProvider')));
    assert.equal(diagnostics.notificationProviderCode, '20001');
    assert.equal(diagnostics.notificationProviderMessage, '[provider detail omitted]');
    assert.doesNotMatch(JSON.stringify(diagnostics), /controlled-test-cid|FORBIDDEN|payload|push_clientid|LAPTOP|stack/);
  }
});

test('outcome persistence failure keeps the committed task and emits a safe persistence stage', async (t) => {
  const messages = [];
  t.mock.method(console, 'error', (...args) => messages.push(args));
  const target = fixture(async () => ({ accepted: true, providerCode: '0' }));
  const paired = await pairDesktop(target.application);
  await makeEligible(target);
  const update = target.repository.updateWhere.bind(target.repository);
  target.repository.updateWhere = (collection, criteria, patch) => {
    if (patch.notificationStatus === 'submitted') throw new Error('FORBIDDEN database request');
    return update(collection, criteria, patch);
  };
  const event = completionEvent(paired.desktop.desktopId);
  assert.equal((await target.application.events(paired.credential, event)).status, 'created');
  assert.equal(onlyTask(target.repository).notificationStatus, 'pending');
  assert.equal((await target.application.events(paired.credential, event)).status, 'duplicate');
  assert.equal(messages[0][1].stage, 'provider_persist');
  assert.doesNotMatch(JSON.stringify(messages), /FORBIDDEN|controlled-test-cid|payload|stack/);
});

test('notification setting and privacy consent are independent eligibility gates after persistence', async () => {
  for (const scenario of [
    {
      name: 'notifications disabled',
      prepare: async () => {},
      reason: 'notifications_disabled'
    },
    {
      name: 'privacy consent missing',
      prepare: async ({ application }) => {
        await application.updateSettings(OWNER, { notificationsEnabled: true });
      },
      reason: 'privacy_consent_required'
    }
  ]) {
    let calls = 0;
    const target = fixture(async () => {
      calls += 1;
      return { accepted: true, providerCode: '0' };
    });
    const paired = await pairDesktop(target.application);
    await scenario.prepare(target);
    const result = await target.application.events(
      paired.credential,
      completionEvent(paired.desktop.desktopId)
    );
    const task = onlyTask(target.repository);
    assert.equal(result.status, 'created', scenario.name);
    assert.equal(result.notificationStatus, core.DELIVERY_STATUS.SKIPPED_DISABLED, scenario.name);
    assert.equal(task.notificationStatus, core.DELIVERY_STATUS.SKIPPED_DISABLED, scenario.name);
    assert.equal(task.notificationReason, scenario.reason, scenario.name);
    assert.equal(task.notificationTargetCount, 0, scenario.name);
    assert.equal(calls, 0, scenario.name);
  }
});

test('missing, denied, inactive, wrong-platform, and unregistered targets never call Push', async () => {
  const cases = [
    { name: 'CID missing', device: {}, reason: 'cid_unavailable' },
    { name: 'permission denied', device: { permission: 'denied' }, reason: 'no_eligible_device' },
    { name: 'permission unknown', device: { permission: 'notDetermined' }, reason: 'no_eligible_device' },
    { name: 'registration error', device: { registration: 'error' }, reason: 'no_eligible_device' },
    { name: 'device disabled', device: { enabled: false }, reason: 'no_eligible_device' },
    { name: 'wrong platform', device: { platform: 'web' }, reason: 'no_eligible_device' }
  ];
  for (const [index, scenario] of cases.entries()) {
    let calls = 0;
    const target = fixture(async () => {
      calls += 1;
      return { accepted: true, providerCode: '0' };
    });
    const paired = await pairDesktop(target.application);
    await enableOwner(target.application);
    await registerBusinessDevice(target.application, scenario.device);
    const result = await target.application.events(
      paired.credential,
      completionEvent(paired.desktop.desktopId, `${index + 1}`)
    );
    const task = onlyTask(target.repository);
    assert.equal(result.notificationStatus, core.DELIVERY_STATUS.SKIPPED_NO_TARGET, scenario.name);
    assert.equal(task.notificationReason, scenario.reason, scenario.name);
    assert.equal(task.notificationTargetCount, 0, scenario.name);
    assert.equal(calls, 0, scenario.name);
  }
});

test('official CID must match authenticated owner, trusted device, AppID, and current token', async () => {
  const mismatches = [
    { name: 'other owner', identity: { ownerId: 'uid-someone-else' } },
    { name: 'other device', identity: { deviceId: 'device-someone-else' } },
    { name: 'other AppID', identity: { appId: '__UNI__OTHER' } },
    { name: 'expired token', identity: { expiresAt: NOW } },
    { name: 'empty CID', identity: { cid: '' } }
  ];
  for (const [index, scenario] of mismatches.entries()) {
    let calls = 0;
    const target = fixture(async () => {
      calls += 1;
      return { accepted: true, providerCode: '0' };
    });
    const paired = await pairDesktop(target.application);
    await enableOwner(target.application);
    await registerBusinessDevice(target.application);
    await addOfficialIdentity(target.repository, {
      id: `identity-mismatch-${index}`,
      ...scenario.identity
    });
    const result = await target.application.events(
      paired.credential,
      completionEvent(paired.desktop.desktopId, `mismatch-${index}`)
    );
    assert.equal(result.notificationStatus, core.DELIVERY_STATUS.SKIPPED_NO_TARGET, scenario.name);
    assert.equal(onlyTask(target.repository).notificationReason, 'cid_unavailable', scenario.name);
    assert.equal(calls, 0, scenario.name);
  }
});

test('eligible event is persisted and atomically claimed before one minimal submission', async () => {
  let calls = 0;
  let submittedInput = null;
  const target = fixture(async (input) => {
    calls += 1;
    submittedInput = structuredClone(input);
    const persisted = onlyTask(target.repository);
    assert.equal(persisted.notificationStatus, core.DELIVERY_STATUS.PENDING);
    assert.equal(persisted.notificationTargetCount, 1);
    return { accepted: true, providerCode: '0' };
  });
  const paired = await pairDesktop(target.application);
  await makeEligible(target, { cid: 'controlled-shared-cid' });
  await registerBusinessDevice(target.application, { deviceId: 'device-phase2-secondary' });
  await addOfficialIdentity(target.repository, {
    id: 'identity-secondary',
    deviceId: 'device-phase2-secondary',
    cid: 'controlled-shared-cid'
  });

  const result = await target.application.events(
    paired.credential,
    completionEvent(paired.desktop.desktopId)
  );
  const task = onlyTask(target.repository);
  assert.equal(result.notificationStatus, core.DELIVERY_STATUS.SUBMITTED);
  assert.equal(task.notificationStatus, core.DELIVERY_STATUS.SUBMITTED);
  assert.equal(task.notificationTargetCount, 1);
  assert.equal(task.notificationAttemptedAtMs, NOW);
  assert.equal(task.notificationSubmittedAtMs, NOW);
  assert.equal(task.notificationProviderCode, '0');
  assert.equal(Object.hasOwn(task, 'notificationReason'), false);
  assert.equal(calls, 1);
  assert.deepEqual(submittedInput, {
    taskId: task._id,
    desktopName: 'LAPTOP-0Q9SBHOE',
    pushClientIds: ['controlled-shared-cid']
  });
});

test('provider rejection and provider exception remain accepted persisted events', async () => {
  for (const scenario of [
    {
      name: 'provider rejection',
      sender: async () => ({ accepted: false, providerCode: '30005' }),
      reason: 'provider_error',
      providerCode: '30005'
    },
    {
      name: 'non-DCloud success code',
      sender: async () => ({ accepted: true, providerCode: '200' }),
      reason: 'provider_error',
      providerCode: '200'
    },
    {
      name: 'provider exception',
      sender: async () => { throw new Error('controlled provider failure'); },
      reason: 'provider_error',
      providerCode: null
    }
  ]) {
    let calls = 0;
    const target = fixture(async (input) => {
      calls += 1;
      return scenario.sender(input);
    });
    const paired = await pairDesktop(target.application);
    await makeEligible(target);
    const event = completionEvent(paired.desktop.desktopId);
    const first = await target.application.events(paired.credential, event);
    const duplicate = await target.application.events(paired.credential, event);
    const task = onlyTask(target.repository);
    assert.equal(first.status, 'created', scenario.name);
    assert.equal(first.notificationStatus, core.DELIVERY_STATUS.FAILED, scenario.name);
    assert.equal(duplicate.status, 'duplicate', scenario.name);
    assert.equal(duplicate.notificationStatus, core.DELIVERY_STATUS.FAILED, scenario.name);
    assert.equal(task.notificationStatus, core.DELIVERY_STATUS.FAILED, scenario.name);
    assert.equal(task.notificationReason, scenario.reason, scenario.name);
    assert.equal(task.notificationProviderCode, scenario.providerCode, scenario.name);
    assert.equal(calls, 1, scenario.name);
  }
});

test('the conditional pending claim allows at most one provider call under a race', async () => {
  let calls = 0;
  const target = fixture(async () => {
    calls += 1;
    await Promise.resolve();
    return { accepted: true, providerCode: '0' };
  });
  const paired = await pairDesktop(target.application);
  await makeEligible(target);
  const task = {
    _id: 'tsk_11111111-1111-4111-8111-111111111111',
    ownerId: OWNER,
    ...completionEvent(paired.desktop.desktopId, 'claim'),
    notificationStatus: core.DELIVERY_STATUS.NOT_REQUESTED,
    createdAtMs: NOW,
    updatedAtMs: NOW
  };
  await target.repository.insert(core.COLLECTIONS.tasks, task);
  const outcomes = await Promise.all([
    target.application.processTaskNotification(task, { name: 'LAPTOP-0Q9SBHOE' }),
    target.application.processTaskNotification(task, { name: 'LAPTOP-0Q9SBHOE' })
  ]);
  assert.equal(calls, 1);
  assert.equal(outcomes.includes(core.DELIVERY_STATUS.SUBMITTED), true);
  assert.equal(onlyTask(target.repository).notificationStatus, core.DELIVERY_STATUS.SUBMITTED);
});

test('business device registration upserts one owner/device row and rejects client ownership or CID fields', async () => {
  const target = fixture(async () => ({ accepted: true, providerCode: '0' }));
  await target.application.bootstrap(OWNER);
  await enableOwner(target.application);
  await registerBusinessDevice(target.application, { permission: 'notDetermined', registration: 'notStarted' });
  await registerBusinessDevice(target.application, { permission: 'authorized', registration: 'ready' });
  const devices = target.repository.snapshot(core.COLLECTIONS.mobileDevices);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].ownerId, OWNER);
  assert.equal(devices[0].deviceId, DEVICE_ID);
  assert.equal(devices[0].notificationPermissionState, 'authorized');
  assert.equal(devices[0].pushRegistrationStatus, 'ready');

  await assert.rejects(target.application.registerMobileDevice(OWNER, {
    enabled: true,
    ownerId: 'uid-attacker'
  }, {
    deviceId: DEVICE_ID,
    platform: 'app-android',
    appVersion: '1.0.0'
  }), (error) => error.code === 'invalid_request');
  await assert.rejects(target.application.registerMobileDevice(OWNER, {
    enabled: true,
    pushCid: 'client-supplied-cid'
  }, {
    deviceId: DEVICE_ID,
    platform: 'app-android',
    appVersion: '1.0.0'
  }), (error) => error.code === 'invalid_request');
});

test('Desktop event payload cannot inject a CID and invalid event persists nothing', async () => {
  let calls = 0;
  const target = fixture(async () => {
    calls += 1;
    return { accepted: true, providerCode: '0' };
  });
  const paired = await pairDesktop(target.application);
  await makeEligible(target);
  await assert.rejects(target.application.events(
    paired.credential,
    completionEvent(paired.desktop.desktopId, 'cid-injection', { pushCid: 'desktop-cid' })
  ), (error) => error.code === 'privacy_payload_rejected');
  assert.equal(target.repository.snapshot(core.COLLECTIONS.tasks).length, 0);
  assert.equal(calls, 0);
});

test('UniCloud repository conditional update uses one where-update and rejects transactional use', async () => {
  const calls = [];
  const database = {
    collection(name) {
      return {
        where(criteria) {
          return {
            async update(patch) {
              calls.push({ name, criteria, patch });
              return { updated: 1 };
            }
          };
        }
      };
    }
  };
  const repository = new core.UniCloudRepository({ database });
  const count = await repository.updateWhere('tokenm-tasks', {
    _id: 'tsk_11111111-1111-4111-8111-111111111111',
    notificationStatus: 'not_requested'
  }, { notificationStatus: 'pending' });
  assert.equal(count, 1);
  assert.deepEqual(calls, [{
    name: 'tokenm-tasks',
    criteria: {
      _id: 'tsk_11111111-1111-4111-8111-111111111111',
      notificationStatus: 'not_requested'
    },
    patch: { notificationStatus: 'pending' }
  }]);
  const transactional = new core.UniCloudRepository({ database, transaction: true });
  await assert.rejects(
    transactional.updateWhere('tokenm-tasks', {}, {}),
    /事务内条件更新未启用/
  );
});


test('deleted full task keeps identity and every notification field; replay never pushes again', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { errCode: 0 }; });
  const paired = await pairDesktop(f.application);
  await makeEligible(f);
  const event = completionEvent(paired.desktop.desktopId, 'deleted', { privacyMode: false, project: 'project', model: 'model', summary: 'private body', durationMs: 45 });
  const created = await f.application.events(paired.credential, event);
  const before = await f.repository.findById(core.COLLECTIONS.tasks, created.taskId);
  await assert.rejects(f.application.deleteTask('another-owner', { taskId: created.taskId }), { code: 'task_not_found' });
  await assert.rejects(f.application.deleteTask(OWNER, { taskId: created.taskId, ownerId: 'another-owner' }));
  await f.application.deleteTask(OWNER, { taskId: created.taskId });
  const after = await f.repository.findById(core.COLLECTIONS.tasks, created.taskId);
  assert.equal(after.userDeletedAtMs, NOW);
  for (const key of ['project','model','summary','durationMs']) assert.equal(after[key], null);
  assert.equal(after.sessionId, '');
  for (const key of Object.keys(before).filter(k => k.startsWith('notification'))) assert.deepEqual(after[key], before[key]);
  assert.equal((await f.application.listTasks(OWNER)).tasks.length, 0);
  await assert.rejects(f.application.getTask(OWNER, { taskId: created.taskId }), { code: 'task_not_found' });
  const home = await f.application.getDashboard(OWNER);
  assert.equal(home.latestTask, null); assert.equal(home.counts.tasks, 0); assert.equal(home.counts.todayTasks, 0);
  const callsBeforeReplay = calls;
  assert.equal((await f.application.events(paired.credential, event)).status, 'duplicate');
  assert.equal(calls, callsBeforeReplay);
  assert.equal(f.repository.snapshot(core.COLLECTIONS.tasks).length, 1);
  await f.application.deleteTask(OWNER, { taskId: created.taskId });
  assert.equal((await f.repository.findById(core.COLLECTIONS.tasks, created.taskId)).userDeletedAtMs, NOW);
});

test('delete and clear never reset any notification status', async () => {
  for (const status of ['not_requested','pending','submitted','failed','skipped_disabled','skipped_no_target']) {
    const f = fixture(() => { throw Error('must not push'); });
    await f.application.bootstrap(OWNER);
    const id = core.randomId('task');
    await f.repository.insert(core.COLLECTIONS.tasks, { _id: id, ownerId: OWNER, desktopId: 'desktop', eventId: status, createdAtMs: NOW, notificationStatus: status });
    await f.application.deleteTask(OWNER, { taskId: id });
    await f.application.clearTasks(OWNER, { confirmation: 'CLEAR' });
    assert.equal((await f.repository.findById(core.COLLECTIONS.tasks,id)).notificationStatus,status);
  }
});
