'use strict';

const cloud = require('wx-server-sdk');
const { createCloudBaseRepository } = require('./runtime/lib/repository');
const { buildReconciliationPlan } = require('./runtime/lib/reconciliation');
const { createService, validateState } = require('./runtime/lib/service');
const { createMaintenanceOperator } = require('./lib/operator');
const { detectRuntimeIdentity } = require('./lib/runtime-identity');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repo = createCloudBaseRepository(cloud);
const service = createService({ repo, sender: null, config: {}, logger: { info() {}, warn() {}, error() {} } });
const operator = createMaintenanceOperator({
  repo,
  service,
  buildReconciliationPlan,
  validateState,
  getRuntimeIdentity() {
    return detectRuntimeIdentity({
      getWXContext: () => cloud.getWXContext(),
      runtimeEnv: process.env
    });
  }
});

exports.main = async (event) => operator.invoke(event);
