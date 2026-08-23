'use strict';

const cloud = require('wx-server-sdk');
const { createCloudBaseRepository } = require('../lib/repository');
const { createService, COLLECTIONS } = require('../lib/service');
const { buildReconciliationPlan } = require('../lib/reconciliation');

function parseArgs(argv) {
  const deliveryIds = [];
  let outcome = null;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--delivery-id') deliveryIds.push(argv[++index]);
    else if (arg === '--outcome') outcome = argv[++index];
    else if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') {
      // Dry-run is the default; accept the explicit flag for operator clarity.
    }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!deliveryIds.length || !outcome || deliveryIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('usage: node tools/reconcile-unknown.js --delivery-id <id> [--delivery-id <id>] --outcome <sent|failed> [--dry-run|--apply]');
  }
  if (!['sent', 'failed'].includes(outcome)) throw new Error('outcome must be sent or failed');
  return { deliveryIds, outcome, apply };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const repo = createCloudBaseRepository(cloud);
  // Dry-run only needs read access and must not require production sender secrets.
  // Apply intentionally loads the full production configuration before mutating.
  let service = null;
  if (args.apply) {
    // Reconciliation does not send messages or read production configuration.
    // Keep apply independent of peppers, template IDs, and other secrets.
    service = createService({ repo, sender: null, config: {}, logger: console });
  }
  const entries = [];
  let simulatedState = null;
  for (const deliveryId of args.deliveryIds) {
    const delivery = await repo.get(COLLECTIONS.deliveries, deliveryId);
    const task = delivery && await repo.get(COLLECTIONS.tasks, delivery.taskId);
    const state = delivery && await repo.get(COLLECTIONS.states, delivery.ownerId);
    if (simulatedState && state && state._id !== simulatedState._id) throw new Error('delivery owners differ');
    const plan = buildReconciliationPlan({ delivery, task, state: simulatedState || state, outcome: args.outcome });
    entries.push({ deliveryId, plan });
    simulatedState = { ...(simulatedState || state), ...plan.quotaAfter };
  }
  for (const entry of entries) console.log(JSON.stringify(entry.plan));
  if (args.apply) {
    for (const entry of entries) {
      const result = await service.reconcileUnknown(entry.deliveryId, args.outcome);
      if (!result.changed) throw new Error(`delivery changed before apply: ${entry.deliveryId}`);
      console.log(JSON.stringify({ deliveryId: entry.deliveryId, applied: true, outcome: args.outcome }));
    }
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { main, parseArgs };
