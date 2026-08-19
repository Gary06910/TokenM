'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ContractModel } = require('../reference/contractModel');

async function loadProductionFactory(adapterPath) {
  const absolute = path.resolve(adapterPath);
  const imported = await import(pathToFileURL(absolute).href);
  const factory = imported.createWeChatContractHarness
    || imported.default?.createWeChatContractHarness
    || imported.default;
  if (typeof factory !== 'function') {
    throw new Error('CONTRACT_CHANGE_REQUEST: production adapter must export createWeChatContractHarness');
  }
  return factory;
}

async function createHarness(options = {}) {
  const adapterPath = process.env.TOKEN_M_WECHAT_BACKEND_ADAPTER;
  if (!adapterPath) return new ContractModel(options);
  const factory = await loadProductionFactory(adapterPath);
  const harness = await factory(options);
  for (const method of ['miniCall', 'desktopRequest', 'snapshot']) {
    if (typeof harness?.[method] !== 'function') {
      throw new Error(`CONTRACT_CHANGE_REQUEST: production adapter is missing ${method}()`);
    }
  }
  return harness;
}

module.exports = { createHarness };
