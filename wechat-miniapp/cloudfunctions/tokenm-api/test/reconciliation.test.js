const assert = require('node:assert/strict');
const test = require('node:test');
const { buildReconciliationPlan } = require('../lib/reconciliation');

test('operator reconciliation plan is explicit, safe, and computes failed quota release', () => {
  const plan = buildReconciliationPlan({
    delivery: { _id: 'dly_12345678901234567890', taskId: 'tsk_12345678901234567890', ownerId: 'owner_12345678901234567890', status: 'unknown', quotaReserved: true, providerErrcode: null, providerErrmsgCode: 'provider_call_uncertain' },
    task: { _id: 'tsk_12345678901234567890', ownerId: 'owner_12345678901234567890' },
    state: { _id: 'owner_12345678901234567890', available: 0, reserved: 3, consumedTotal: 1, releasedTotal: 0, grantedTotal: 4 },
    outcome: 'failed'
  });
  assert.equal(plan.deliveryId, 'dly_12345678901234567890');
  assert.equal(plan.ownerId, 'owner_12…7890');
  assert.deepEqual(plan.quotaAfter, { available: 1, reserved: 2, consumedTotal: 1, releasedTotal: 1, grantedTotal: 4 });
});

test('operator reconciliation plan rejects non-uncertain or non-unknown deliveries', () => {
  assert.throws(() => buildReconciliationPlan({ delivery: { status: 'failed' }, outcome: 'failed' }), /eligible/);
});

test('operator reconciliation plans can be chained with cumulative quota state', () => {
  const base = { _id: 'owner_12345678901234567890', available: 0, reserved: 3, consumedTotal: 1, releasedTotal: 0, grantedTotal: 4 };
  const make = (id, taskId) => ({ _id: id, taskId, ownerId: base._id, status: 'unknown', quotaReserved: true, providerErrmsgCode: 'provider_call_uncertain' });
  const first = buildReconciliationPlan({ delivery: make('dly_1', 'tsk_1'), task: { _id: 'tsk_1', ownerId: base._id }, state: base, outcome: 'failed' });
  const second = buildReconciliationPlan({ delivery: make('dly_2', 'tsk_2'), task: { _id: 'tsk_2', ownerId: base._id }, state: { ...base, ...first.quotaAfter }, outcome: 'failed' });
  assert.deepEqual(second.quotaBefore, { available: 1, reserved: 2, consumedTotal: 1, releasedTotal: 1, grantedTotal: 4 });
  assert.deepEqual(second.quotaAfter, { available: 2, reserved: 1, consumedTotal: 1, releasedTotal: 2, grantedTotal: 4 });
});
