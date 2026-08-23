'use strict';

const UNCERTAIN_REASON = 'provider_call_uncertain';

function safeId(value) {
  const text = String(value || '');
  return text.length <= 12 ? text : `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function buildReconciliationPlan({ delivery, task, state, outcome }) {
  if (!['sent', 'failed'].includes(outcome)) throw new Error('outcome must be sent or failed');
  if (!delivery || delivery.status !== 'unknown' || delivery.providerErrmsgCode !== UNCERTAIN_REASON || delivery.quotaReserved !== true) {
    throw new Error('delivery is not an eligible uncertain unknown');
  }
  if (!task || task._id !== delivery.taskId || task.ownerId !== delivery.ownerId) throw new Error('delivery task mismatch');
  if (!state || state._id !== delivery.ownerId) throw new Error('delivery owner mismatch');
  if (!Number.isSafeInteger(state.reserved) || state.reserved < 1) throw new Error('missing quota reservation');
  const quotaAfter = {
    available: state.available + (outcome === 'failed' ? 1 : 0),
    reserved: state.reserved - 1,
    consumedTotal: state.consumedTotal + (outcome === 'sent' ? 1 : 0),
    releasedTotal: state.releasedTotal + (outcome === 'failed' ? 1 : 0),
    grantedTotal: state.grantedTotal
  };
  return {
    deliveryId: String(delivery._id),
    taskId: safeId(task._id),
    ownerId: safeId(delivery.ownerId),
    currentStatus: delivery.status,
    providerErrcode: delivery.providerErrcode ?? null,
    providerErrmsgCode: delivery.providerErrmsgCode,
    quotaBefore: {
      available: state.available,
      reserved: state.reserved,
      consumedTotal: state.consumedTotal,
      releasedTotal: state.releasedTotal,
      grantedTotal: state.grantedTotal
    },
    quotaAfter,
    plannedOutcome: outcome
  };
}

module.exports = { UNCERTAIN_REASON, buildReconciliationPlan, safeId };
