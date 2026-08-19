'use strict';

const runtime = require('../config/runtime');
const fixtures = require('../fixtures/mock-states');

function isDeveloperRuntime() {
  return typeof globalThis !== 'undefined'
    && globalThis.__wxConfig
    && globalThis.__wxConfig.envVersion === 'develop';
}

function activeFixture() {
  if (!runtime.enableUiMock || !runtime.uiMockFixture || !isDeveloperRuntime()) return null;
  return fixtures[runtime.uiMockFixture] || null;
}

function findTask(fixture, taskId) {
  return (fixture.tasks || []).find((task) => task.taskId === taskId) || null;
}

async function call(action, payload = {}) {
  const fixture = activeFixture();
  if (!fixture) return null;
  if (fixture.error) throw fixture.error;

  if (action === 'bootstrap' || action === 'getDashboard') return fixture.bootstrap;
  if (action === 'listDesktops') return { ok: true, items: fixture.desktops || [], requestId: 'req_mockfixture0002' };
  if (action === 'listTasks') {
    if (payload.cursor && fixture.paginationError) throw { code: 'internal_error', retryable: true };
    return { ok: true, items: fixture.tasks || [], nextCursor: fixture.paginationError ? 'mock-next' : null, requestId: 'req_mockfixture0003' };
  }
  if (action === 'getTask') {
    const task = findTask(fixture, payload.taskId);
    if (!task) throw { code: 'task_not_found', retryable: false };
    return { ok: true, task, requestId: 'req_mockfixture0004' };
  }
  if (action === 'createPairingCode') return { ok: true, ...(fixture.pairing || fixtures.pairActive.pairing), requestId: 'req_mockfixture0005' };
  if (action === 'prepareSubscriptionGrant') return { ok: true, grantIntentId: 'grt_mockfixture0000000001', templateId: 'mock-template', expiresAt: '2099-01-01T00:00:00.000Z', requestId: 'req_mockfixture0006' };
  if (action === 'recordSubscriptionOutcome') return { ok: true, duplicate: false, quota: { available: fixture.bootstrap.quota.available + (payload.result === 'accept' ? 1 : 0) }, requestId: 'req_mockfixture0007' };
  if (action === 'updateSettings') return { ok: true, settings: { notificationsEnabled: payload.notificationsEnabled }, requestId: 'req_mockfixture0008' };
  if (action === 'renameDesktop') return { ok: true, desktop: { ...(fixture.desktops || [])[0], name: payload.name }, requestId: 'req_mockfixture0009' };
  if (action === 'unbindDesktop') return { ok: true, alreadyRevoked: false, requestId: 'req_mockfixture0010' };
  if (action === 'clearTaskHistory') return { ok: true, clearedAt: new Date().toISOString(), deletedCount: (fixture.tasks || []).length, cleanupPending: false, requestId: 'req_mockfixture0011' };
  if (action === 'deleteAccount') return { ok: true, deletionRequestedAt: new Date().toISOString(), cleanupPending: false, requestId: 'req_mockfixture0012' };
  throw { code: 'invalid_request', retryable: false };
}

module.exports = { activeFixture, call, isDeveloperRuntime };
