'use strict';

const EXPECTED_ENV_ID = 'cloud1-d9g3dbpl6be649e34';

const RECOVERY_EVIDENCE = Object.freeze({
  'dly_La_bxg7bgoLvFksm-UX_TY': Object.freeze({
    class: 'historical_pre_fix',
    expectedOutcome: 'failed',
    userConfirmedNotReceived: true
  }),
  'dly_4dcTCg-c0r6kQgkwDRfYUI': Object.freeze({
    class: 'historical_pre_fix',
    expectedOutcome: 'failed',
    userConfirmedNotReceived: true
  }),
  'dly_EZl-e4oaPlHbUDb-epJszq': Object.freeze({
    class: 'historical_pre_fix',
    expectedOutcome: 'failed',
    userConfirmedNotReceived: true
  }),
  'dly_fG-HSjvfBqBY0ADBWtIltf': Object.freeze({
    class: 'post_fix_user_confirmed_not_received',
    expectedOutcome: 'failed',
    userConfirmedNotReceived: true,
    occurredAt: '2026-08-23T06:42:43.332Z'
  }),
  'dly_-eh9vf0ziDVHVdS9Jvi0Dl': Object.freeze({
    class: 'post_fix_user_confirmed_not_received',
    expectedOutcome: 'failed',
    userConfirmedNotReceived: true,
    occurredAt: '2026-08-23T06:58:53.423Z'
  })
});

const EVENT_KEYS = new Set(['deliveryId', 'apply']);

class MaintenanceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function reject(code) {
  throw new MaintenanceError(code);
}

function parseEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) reject('INVALID_EVENT');
  for (const key of Object.keys(event)) if (!EVENT_KEYS.has(key)) reject('UNKNOWN_FIELD');
  if (typeof event.deliveryId !== 'string' || !RECOVERY_EVIDENCE[event.deliveryId]) reject('NOT_ALLOWLISTED');
  if (Object.hasOwn(event, 'apply') && typeof event.apply !== 'boolean') reject('INVALID_APPLY');
  return { deliveryId: event.deliveryId, apply: event.apply === true };
}

function quotaView(state) {
  return {
    available: state.available,
    reserved: state.reserved,
    grantedTotal: state.grantedTotal,
    consumedTotal: state.consumedTotal,
    releasedTotal: state.releasedTotal
  };
}

function assertLedger(validateState, state) {
  try {
    validateState(state);
  } catch {
    reject('LEDGER_INVALID');
  }
}

function assertRelationships(deliveryId, delivery, task, state) {
  if (!task) reject('TASK_NOT_FOUND');
  if (!state) reject('STATE_NOT_FOUND');
  if (
    task._id !== delivery.taskId ||
    task.notificationDeliveryId !== deliveryId ||
    task.ownerId !== delivery.ownerId ||
    task.desktopId !== delivery.desktopId
  ) reject('TASK_MISMATCH');
  if (state._id !== delivery.ownerId || state.ownerId !== delivery.ownerId) reject('STATE_MISMATCH');
}

function alreadyReconciled(delivery, task) {
  return delivery.status === 'failed' &&
    delivery.providerErrcode === null &&
    delivery.providerErrmsgCode === 'reconciled' &&
    task.notificationStatus === 'failed';
}

function assertEligible(delivery, task, state) {
  if (delivery.status !== 'unknown') reject('DELIVERY_NOT_ELIGIBLE');
  if (delivery.providerErrcode !== null || delivery.providerErrmsgCode !== 'provider_call_uncertain') reject('PROVIDER_METADATA_MISMATCH');
  if (delivery.quotaReserved !== true) reject('QUOTA_NOT_RESERVED');
  if (delivery.attemptCount !== 1) reject('ATTEMPT_COUNT_MISMATCH');
  if (task.notificationStatus !== 'unknown') reject('TASK_STATUS_MISMATCH');
  if (!Number.isSafeInteger(state.reserved) || state.reserved < 1) reject('MISSING_QUOTA_RESERVATION');
}

function safeFailure(error, mode) {
  return {
    ok: false,
    mode,
    code: error instanceof MaintenanceError ? error.code : 'INTERNAL_ERROR',
    changed: false
  };
}

function createMaintenanceOperator({ repo, service, buildReconciliationPlan, validateState, getRuntimeIdentity }) {
  if (!repo || !service || typeof buildReconciliationPlan !== 'function' || typeof validateState !== 'function' || typeof getRuntimeIdentity !== 'function') {
    throw new TypeError('maintenance dependencies missing');
  }

  async function execute(event) {
    const args = parseEvent(event);
    const mode = args.apply ? 'apply' : 'dry_run';
    let identity;
    try {
      identity = await getRuntimeIdentity();
    } catch {
      reject('ENVIRONMENT_IDENTITY_UNVERIFIED');
    }
    if (identity?.identityConflict === true) reject('ENVIRONMENT_IDENTITY_CONFLICT');
    if (!identity || typeof identity.envId !== 'string' || !identity.envId) reject('ENVIRONMENT_IDENTITY_UNVERIFIED');
    if (identity.envId !== EXPECTED_ENV_ID) reject('ENVIRONMENT_MISMATCH');
    if (identity.openid || identity.appId) reject('CLIENT_INVOCATION_FORBIDDEN');

    const delivery = await repo.get('notificationDeliveries', args.deliveryId);
    if (!delivery) reject('DELIVERY_NOT_FOUND');
    const task = await repo.get('tasks', delivery.taskId);
    const state = await repo.get('notificationState', delivery.ownerId);
    assertRelationships(args.deliveryId, delivery, task, state);
    assertLedger(validateState, state);

    if (alreadyReconciled(delivery, task)) {
      return {
        ok: true,
        mode,
        deliveryId: args.deliveryId,
        taskId: task._id,
        eligible: false,
        changed: false,
        wouldChange: false,
        quotaReservationOriginallyCreated: delivery.quotaReserved === true,
        statusBefore: delivery.status,
        statusAfter: delivery.status,
        quotaBefore: quotaView(state),
        quotaAfter: quotaView(state),
        ledgerInvariant: true,
        reason: 'ALREADY_RECONCILED'
      };
    }

    assertEligible(delivery, task, state);
    let plan;
    try {
      plan = buildReconciliationPlan({ delivery, task, state, outcome: 'failed' });
    } catch {
      reject('PLAN_REJECTED');
    }

    if (!args.apply) {
      return {
        ok: true,
        mode,
        deliveryId: args.deliveryId,
        taskId: task._id,
        evidenceClass: RECOVERY_EVIDENCE[args.deliveryId].class,
        eligible: true,
        changed: false,
        wouldChange: true,
        quotaReservationOriginallyCreated: delivery.quotaReserved === true,
        statusBefore: delivery.status,
        taskStatusBefore: task.notificationStatus,
        quotaBefore: plan.quotaBefore,
        expectedQuotaAfter: plan.quotaAfter,
        ledgerInvariant: true,
        reason: 'ELIGIBLE'
      };
    }

    const result = await service.reconcileUnknown(args.deliveryId, 'failed');
    if (!result.changed) reject('PRECONDITION_CHANGED');
    const afterDelivery = await repo.get('notificationDeliveries', args.deliveryId);
    const afterTask = await repo.get('tasks', task._id);
    const afterState = await repo.get('notificationState', delivery.ownerId);
    assertRelationships(args.deliveryId, afterDelivery, afterTask, afterState);
    assertLedger(validateState, afterState);
    if (afterDelivery.status !== 'failed' || afterDelivery.quotaReserved !== true || afterTask.notificationStatus !== 'failed') reject('POSTCONDITION_FAILED');
    return {
      ok: true,
      mode,
      deliveryId: args.deliveryId,
      taskId: task._id,
      evidenceClass: RECOVERY_EVIDENCE[args.deliveryId].class,
      eligible: true,
      changed: true,
      quotaReservationOriginallyCreated: afterDelivery.quotaReserved === true,
      statusBefore: delivery.status,
      statusAfter: afterDelivery.status,
      quotaBefore: plan.quotaBefore,
      quotaAfter: quotaView(afterState),
      ledgerInvariant: true,
      reason: 'RECONCILED_FAILED'
    };
  }

  return {
    async invoke(event) {
      const mode = event?.apply === true ? 'apply' : 'dry_run';
      try {
        return await execute(event);
      } catch (error) {
        return safeFailure(error, mode);
      }
    }
  };
}

module.exports = {
  EXPECTED_ENV_ID,
  RECOVERY_EVIDENCE,
  createMaintenanceOperator
};
