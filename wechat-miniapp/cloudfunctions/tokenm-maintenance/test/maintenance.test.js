'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildReconciliationPlan } = require('../../tokenm-api/lib/reconciliation');
const { createMemoryRepository } = require('../../tokenm-api/lib/repository');
const { createService, validateState } = require('../../tokenm-api/lib/service');
const {
  EXPECTED_ENV_ID,
  RECOVERY_EVIDENCE,
  createMaintenanceOperator
} = require('../lib/operator');
const { detectRuntimeIdentity } = require('../lib/runtime-identity');

const IDS = Object.keys(RECOVERY_EVIDENCE);
const OWNER = 'usr_test_owner';
const DESKTOP = 'dev_test_desktop';

function stateDocument(overrides = {}) {
  return {
    _id: OWNER,
    ownerId: OWNER,
    available: 0,
    reserved: 5,
    grantedTotal: 11,
    consumedTotal: 6,
    releasedTotal: 0,
    version: 29,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-23T06:42:45.657Z'),
    ...overrides
  };
}

function deliveryDocument(deliveryId, index, overrides = {}) {
  return {
    _id: deliveryId,
    ownerId: OWNER,
    desktopId: DESKTOP,
    taskId: `tsk_allowlisted_${index}`,
    status: 'unknown',
    providerErrcode: null,
    providerErrmsgCode: 'provider_call_uncertain',
    providerAttemptId: `att_test_${index}`,
    quotaReserved: true,
    attemptCount: 1,
    createdAt: new Date(`2026-08-${20 + index}T00:00:00.000Z`),
    updatedAt: new Date('2026-08-23T06:42:45.657Z'),
    ...overrides
  };
}

function taskDocument(delivery, overrides = {}) {
  return {
    _id: delivery.taskId,
    ownerId: delivery.ownerId,
    desktopId: delivery.desktopId,
    notificationDeliveryId: delivery._id,
    notificationStatus: 'unknown',
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    ...overrides
  };
}

function baseSeed({ stateOverrides = {}, deliveryOverrides = {}, taskOverrides = {}, extras = {} } = {}) {
  const deliveries = IDS.map((id, index) => deliveryDocument(id, index + 1, deliveryOverrides[id]));
  const tasks = deliveries.map((delivery) => taskDocument(delivery, taskOverrides[delivery._id]));
  return {
    notificationState: [stateDocument(stateOverrides), ...(extras.notificationState || [])],
    notificationDeliveries: [...deliveries, ...(extras.notificationDeliveries || [])],
    tasks: [...tasks, ...(extras.tasks || [])]
  };
}

function trackingRepository(seed) {
  const base = createMemoryRepository(seed);
  let writes = 0;

  function wrap(source, transactional = false) {
    const adapter = {
      get: (...args) => source.get(...args),
      query: (...args) => source.query(...args),
      count: (...args) => source.count(...args),
      set: (...args) => { writes += 1; return source.set(...args); },
      update: (...args) => { writes += 1; return source.update(...args); },
      delete: (...args) => { writes += 1; return source.delete(...args); }
    };
    if (!transactional) adapter.transaction = (callback) => source.transaction((tx) => callback(wrap(tx, true)));
    return adapter;
  }

  const repo = wrap(base);
  repo.snapshot = (collection) => base.snapshot(collection);
  repo.writeCount = () => writes;
  return repo;
}

function harness(options = {}) {
  const repo = trackingRepository(options.seed || baseSeed(options));
  const service = createService({
    repo,
    sender: null,
    config: {},
    clock: () => new Date('2026-08-23T07:00:00.000Z'),
    logger: { info() {}, warn() {}, error() {} }
  });
  const identity = options.identity === undefined ? { envId: EXPECTED_ENV_ID } : options.identity;
  const operator = createMaintenanceOperator({
    repo,
    service,
    buildReconciliationPlan,
    validateState,
    getRuntimeIdentity: async () => identity
  });
  return { operator, repo };
}

async function snapshotOne(repo, collection, id) {
  return (await repo.snapshot(collection)).find((document) => document._id === id);
}

test('maintenance allowlist is the exact five user-confirmed incident deliveries', () => {
  assert.deepEqual(IDS, [
    'dly_La_bxg7bgoLvFksm-UX_TY',
    'dly_4dcTCg-c0r6kQgkwDRfYUI',
    'dly_EZl-e4oaPlHbUDb-epJszq',
    'dly_fG-HSjvfBqBY0ADBWtIltf',
    'dly_-eh9vf0ziDVHVdS9Jvi0Dl'
  ]);
  assert.deepEqual(RECOVERY_EVIDENCE[IDS[4]], {
    class: 'post_fix_user_confirmed_not_received',
    expectedOutcome: 'failed',
    userConfirmedNotReceived: true,
    occurredAt: '2026-08-23T06:58:53.423Z'
  });
});

test('MAINT-01 allowlisted unknown dry-run is eligible and performs zero writes', async () => {
  const h = harness();
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: false });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.eligible, true);
  assert.equal(result.wouldChange, true);
  assert.deepEqual(result.expectedQuotaAfter, { available: 1, reserved: 4, consumedTotal: 6, releasedTotal: 1, grantedTotal: 11 });
  assert.equal(h.repo.writeCount(), 0);
  assert.equal((await snapshotOne(h.repo, 'notificationDeliveries', IDS[0])).status, 'unknown');
});

test('MAINT-02 omitted apply defaults to dry-run and performs zero writes', async () => {
  const h = harness();
  const result = await h.operator.invoke({ deliveryId: IDS[0] });
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.changed, false);
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-03 strict apply reconciles unknown to failed with canonical service logic', async () => {
  const h = harness();
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.statusAfter, 'failed');
  assert.deepEqual(result.quotaAfter, { available: 1, reserved: 4, grantedTotal: 11, consumedTotal: 6, releasedTotal: 1 });
  assert.equal((await snapshotOne(h.repo, 'tasks', 'tsk_allowlisted_1')).notificationStatus, 'failed');
});

test('MAINT-04 apply preserves the ledger invariant', async () => {
  const h = harness();
  await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  const state = await snapshotOne(h.repo, 'notificationState', OWNER);
  assert.equal(state.grantedTotal, state.available + state.reserved + state.consumedTotal);
  assert.equal(state.consumedTotal, 6);
  assert.equal(state.grantedTotal, 11);
});

test('MAINT-05 non-allowlisted delivery is rejected without reads causing writes', async () => {
  const h = harness();
  const result = await h.operator.invoke({ deliveryId: 'dly_not_allowlisted', apply: true });
  assert.equal(result.code, 'NOT_ALLOWLISTED');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-06 sent delivery is rejected even when its ID is allowlisted', async () => {
  const h = harness({ deliveryOverrides: { [IDS[0]]: { status: 'sent', providerErrcode: 0, providerErrmsgCode: null } } });
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.code, 'DELIVERY_NOT_ELIGIBLE');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-07 provider metadata mismatch is rejected', async () => {
  const h = harness({ deliveryOverrides: { [IDS[0]]: { providerErrmsgCode: 'malformed_response' } } });
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.code, 'PROVIDER_METADATA_MISMATCH');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-08 quotaReserved false is rejected', async () => {
  const h = harness({ deliveryOverrides: { [IDS[0]]: { quotaReserved: false } } });
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.code, 'QUOTA_NOT_RESERVED');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-09 task ownership mismatch is rejected', async () => {
  const h = harness({ taskOverrides: { [IDS[0]]: { ownerId: 'usr_wrong_owner' } } });
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.code, 'TASK_MISMATCH');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-10 invalid ledger is rejected', async () => {
  const h = harness({ stateOverrides: { grantedTotal: 12 } });
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.code, 'LEDGER_INVALID');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-11 wrong environment fails closed before database access', async () => {
  const h = harness({ identity: { envId: 'cloud1-wrong' } });
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.code, 'ENVIRONMENT_MISMATCH');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-12 missing environment identity fails closed', async () => {
  const h = harness({ identity: {} });
  const result = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(result.code, 'ENVIRONMENT_IDENTITY_UNVERIFIED');
  assert.equal(h.repo.writeCount(), 0);
});

test('MAINT-13 duplicate apply is idempotent and does not release quota twice', async () => {
  const h = harness();
  const first = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  const writesAfterFirst = h.repo.writeCount();
  const second = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'ALREADY_RECONCILED');
  assert.equal(h.repo.writeCount(), writesAfterFirst);
  assert.deepEqual(second.quotaAfter, { available: 1, reserved: 4, grantedTotal: 11, consumedTotal: 6, releasedTotal: 1 });
});

test('MAINT-14 caller cannot override the fixed failed outcome', async () => {
  const h = harness();
  const result = await h.operator.invoke({ deliveryId: IDS[0], outcome: 'sent', apply: true });
  assert.equal(result.code, 'UNKNOWN_FIELD');
  assert.equal(h.repo.writeCount(), 0);
  assert.equal((await snapshotOne(h.repo, 'notificationDeliveries', IDS[0])).status, 'unknown');
});

test('MAINT-15 arrays and multiple delivery IDs are rejected', async () => {
  const h = harness();
  const result = await h.operator.invoke({ deliveryId: [IDS[0], IDS[1]], apply: true });
  assert.equal(result.code, 'NOT_ALLOWLISTED');
  assert.equal(h.repo.writeCount(), 0);
});

test('five-record sequential simulation reaches 5/0/11/6/5 and leaves unrelated records untouched', async () => {
  const otherOwner = 'usr_other_owner';
  const extras = {
    notificationState: [{ ...stateDocument({ _id: otherOwner, ownerId: otherOwner, available: 0, reserved: 1, grantedTotal: 1, consumedTotal: 0 }), _id: otherOwner, ownerId: otherOwner }],
    notificationDeliveries: [
      deliveryDocument('dly_other_unknown', 20, { ownerId: otherOwner, desktopId: 'dev_other', taskId: 'tsk_other_unknown' }),
      deliveryDocument('dly_sent_untouched', 21, { status: 'sent', providerErrcode: 0, providerErrmsgCode: null, quotaReserved: true, taskId: 'tsk_sent_untouched' })
    ],
    tasks: [
      taskDocument(deliveryDocument('dly_other_unknown', 20, { ownerId: otherOwner, desktopId: 'dev_other', taskId: 'tsk_other_unknown' })),
      taskDocument(deliveryDocument('dly_sent_untouched', 21, { status: 'sent', providerErrcode: 0, providerErrmsgCode: null, taskId: 'tsk_sent_untouched' }), { notificationStatus: 'sent' }),
      { _id: 'tsk_skipped_untouched', ownerId: OWNER, desktopId: DESKTOP, notificationDeliveryId: null, notificationStatus: 'skipped_no_quota' }
    ]
  };
  const seed = baseSeed({ extras });
  const h = harness({ seed });
  const protectedBefore = {
    otherDelivery: await snapshotOne(h.repo, 'notificationDeliveries', 'dly_other_unknown'),
    sentDelivery: await snapshotOne(h.repo, 'notificationDeliveries', 'dly_sent_untouched'),
    otherTask: await snapshotOne(h.repo, 'tasks', 'tsk_other_unknown'),
    skippedTask: await snapshotOne(h.repo, 'tasks', 'tsk_skipped_untouched'),
    otherState: await snapshotOne(h.repo, 'notificationState', otherOwner)
  };
  const expected = [
    [1, 4, 1],
    [2, 3, 2],
    [3, 2, 3],
    [4, 1, 4],
    [5, 0, 5]
  ];
  for (let index = 0; index < IDS.length; index += 1) {
    const dryRun = await h.operator.invoke({ deliveryId: IDS[index] });
    assert.equal(dryRun.eligible, true);
    const applied = await h.operator.invoke({ deliveryId: IDS[index], apply: true });
    assert.equal(applied.changed, true);
    const reconciledDelivery = await snapshotOne(h.repo, 'notificationDeliveries', IDS[index]);
    assert.equal(reconciledDelivery.status, 'failed');
    assert.equal(reconciledDelivery.quotaReserved, true);
    const state = await snapshotOne(h.repo, 'notificationState', OWNER);
    assert.deepEqual([state.available, state.reserved, state.releasedTotal], expected[index]);
    assert.equal(state.grantedTotal, state.available + state.reserved + state.consumedTotal);
    assert.equal(state.grantedTotal, 11);
    assert.equal(state.consumedTotal, 6);
  }
  assert.deepEqual(await snapshotOne(h.repo, 'notificationDeliveries', 'dly_other_unknown'), protectedBefore.otherDelivery);
  assert.deepEqual(await snapshotOne(h.repo, 'notificationDeliveries', 'dly_sent_untouched'), protectedBefore.sentDelivery);
  assert.deepEqual(await snapshotOne(h.repo, 'tasks', 'tsk_other_unknown'), protectedBefore.otherTask);
  assert.deepEqual(await snapshotOne(h.repo, 'tasks', 'tsk_skipped_untouched'), protectedBefore.skippedTask);
  assert.deepEqual(await snapshotOne(h.repo, 'notificationState', otherOwner), protectedBefore.otherState);
});

test('miniapp runtime identity is rejected even in the expected environment', async () => {
  const h = harness({ identity: { envId: EXPECTED_ENV_ID, openid: 'openid-client', appId: 'wx-client' } });
  const result = await h.operator.invoke({ deliveryId: IDS[0] });
  assert.equal(result.code, 'CLIENT_INVOCATION_FORBIDDEN');
  assert.equal(h.repo.writeCount(), 0);
});

test('QR-05 eligibility follows delivery state, not the immutable quotaReserved provenance marker', async () => {
  const h = harness();
  const before = await h.operator.invoke({ deliveryId: IDS[0], apply: false });
  assert.equal(before.eligible, true);
  assert.equal(before.wouldChange, true);
  assert.equal(before.quotaReservationOriginallyCreated, true);

  const applied = await h.operator.invoke({ deliveryId: IDS[0], apply: true });
  assert.equal(applied.changed, true);
  assert.equal(applied.quotaReservationOriginallyCreated, true);
  const delivery = await snapshotOne(h.repo, 'notificationDeliveries', IDS[0]);
  assert.equal(delivery.status, 'failed');
  assert.equal(delivery.quotaReserved, true);

  const stateBeforeInspection = await snapshotOne(h.repo, 'notificationState', OWNER);
  const after = await h.operator.invoke({ deliveryId: IDS[0], apply: false });
  const stateAfterInspection = await snapshotOne(h.repo, 'notificationState', OWNER);
  assert.equal(after.reason, 'ALREADY_RECONCILED');
  assert.equal(after.eligible, false);
  assert.equal(after.wouldChange, false);
  assert.equal(after.quotaReservationOriginallyCreated, true);
  assert.deepEqual(stateAfterInspection, stateBeforeInspection);
});

test('ENV-01 getWXContext ENV is accepted as a trusted platform identity', async () => {
  const identity = detectRuntimeIdentity({
    getWXContext: () => ({ ENV: EXPECTED_ENV_ID }),
    runtimeEnv: {}
  });
  const result = await harness({ identity }).operator.invoke({ deliveryId: IDS[0], apply: false });
  assert.equal(identity.envId, EXPECTED_ENV_ID);
  assert.equal(identity.identityConflict, false);
  assert.equal(result.eligible, true);
});

test('ENV-02 trusted runtime env identifies control-plane invocation when WX ENV is absent', async () => {
  const identity = detectRuntimeIdentity({
    getWXContext: () => ({}),
    runtimeEnv: { TCB_ENV: EXPECTED_ENV_ID, SCF_NAMESPACE: EXPECTED_ENV_ID }
  });
  const result = await harness({ identity }).operator.invoke({ deliveryId: IDS[0], apply: false });
  assert.equal(identity.envId, EXPECTED_ENV_ID);
  assert.equal(identity.identityConflict, false);
  assert.equal(result.eligible, true);
});

test('ENV-03 wrong trusted runtime EnvID is rejected as ENVIRONMENT_MISMATCH', async () => {
  const identity = detectRuntimeIdentity({
    getWXContext: () => ({}),
    runtimeEnv: { SCF_NAMESPACE: 'cloud1-wrong' }
  });
  const result = await harness({ identity }).operator.invoke({ deliveryId: IDS[0], apply: false });
  assert.equal(result.code, 'ENVIRONMENT_MISMATCH');
});

test('ENV-04 missing trusted identity sources remains fail closed', async () => {
  const identity = detectRuntimeIdentity({ getWXContext: () => ({}), runtimeEnv: {} });
  const result = await harness({ identity }).operator.invoke({ deliveryId: IDS[0], apply: false });
  assert.equal(result.code, 'ENVIRONMENT_IDENTITY_UNVERIFIED');
});

test('ENV-05 event-supplied envId cannot influence runtime identity', async () => {
  const identity = detectRuntimeIdentity({
    getWXContext: () => ({}),
    runtimeEnv: { SCF_NAMESPACE: 'cloud1-wrong' },
    event: { envId: EXPECTED_ENV_ID }
  });
  assert.equal(identity.envId, 'cloud1-wrong');
  const result = await harness({ identity }).operator.invoke({ deliveryId: IDS[0], apply: false, envId: EXPECTED_ENV_ID });
  assert.equal(result.code, 'UNKNOWN_FIELD');
});

test('ENV-06 conflicting trusted platform sources fail closed', async () => {
  const identity = detectRuntimeIdentity({
    getWXContext: () => ({ ENV: EXPECTED_ENV_ID }),
    runtimeEnv: { SCF_NAMESPACE: 'cloud1-conflict' }
  });
  assert.equal(identity.envId, null);
  assert.equal(identity.identityConflict, true);
  const result = await harness({ identity }).operator.invoke({ deliveryId: IDS[0], apply: false });
  assert.equal(result.code, 'ENVIRONMENT_IDENTITY_CONFLICT');
});
