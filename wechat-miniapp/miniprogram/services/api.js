'use strict';
/* global wx */

const runtime = require('../config/runtime');
const mockAdapter = require('./mock-adapter');

const ACTIONS = new Set([
  'bootstrap', 'getDashboard', 'listTasks', 'getTask', 'listDesktops', 'createPairingCode',
  'renameDesktop', 'unbindDesktop', 'prepareSubscriptionGrant', 'recordSubscriptionOutcome',
  'updateSettings', 'clearTaskHistory', 'deleteAccount',
]);

function requestId() {
  const random = Math.random().toString(36).slice(2).padEnd(10, '0');
  const time = Date.now().toString(36);
  return `req_${time}${random}`.slice(0, 47);
}

function normalizeFailure(error) {
  if (error && typeof error.code === 'string') return error;
  const resultError = error && error.result && error.result.error;
  if (resultError && typeof resultError.code === 'string') return resultError;
  if (error && error.error && typeof error.error.code === 'string') return error.error;
  return { code: 'network_error', message: 'network request failed', retryable: true };
}

async function callAction(action, payload = {}) {
  if (!ACTIONS.has(action)) throw { code: 'invalid_request', retryable: false };
  const mockResult = await mockAdapter.call(action, payload);
  if (mockResult) return mockResult;
  if (!runtime.cloudBaseEnvId) throw { code: 'configuration_required', retryable: false };
  try {
    const response = await wx.cloud.callFunction({
      name: 'tokenm-api',
      data: { action, requestId: requestId(), ...payload },
    });
    const result = response && response.result;
    if (!result || result.ok !== true) throw normalizeFailure(result || response);
    return result;
  } catch (error) {
    throw normalizeFailure(error);
  }
}

module.exports = {
  normalizeFailure,
  bootstrap: () => callAction('bootstrap'),
  clearTaskHistory: () => callAction('clearTaskHistory', { confirmation: 'CLEAR' }),
  createPairingCode: () => callAction('createPairingCode'),
  deleteAccount: () => callAction('deleteAccount', { confirmation: 'DELETE' }),
  getDashboard: () => callAction('getDashboard'),
  getTask: (taskId) => callAction('getTask', { taskId }),
  listDesktops: () => callAction('listDesktops'),
  listTasks: (cursor, limit = 20) => callAction('listTasks', { ...(cursor ? { cursor } : {}), limit }),
  prepareSubscriptionGrant: () => callAction('prepareSubscriptionGrant'),
  recordSubscriptionOutcome: (grantIntentId, result) => callAction('recordSubscriptionOutcome', { grantIntentId, result }),
  renameDesktop: (desktopId, name) => callAction('renameDesktop', { desktopId, name }),
  unbindDesktop: (desktopId) => callAction('unbindDesktop', { desktopId, confirmation: 'UNBIND' }),
  updateSettings: (notificationsEnabled) => callAction('updateSettings', { notificationsEnabled }),
};
