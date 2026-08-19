'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { uiStates } = require('./fixtures/uiStates');
const fixtures = require('../miniprogram/fixtures/mock-states');
const mockAdapter = require('../miniprogram/services/mock-adapter');
const presentation = require('../miniprogram/services/presentation');
const runtime = require('../miniprogram/config/runtime');
const api = require('../miniprogram/services/api');

const requiredStates = [
  'firstRun', 'boundNoTask', 'taskList', 'privacyDetail', 'fullDetail',
  'quotaEmpty', 'quotaLow', 'quotaNormal', 'backendError', 'pairingActive',
  'pairingExpired', 'subscriptionRejected', 'subscriptionMainSwitchOff', 'paginationError',
];

for (const stateName of requiredStates) {
  test(`UI-${stateName} fixture is smoke-ready`, () => {
    const fixture = uiStates[stateName];
    assert.ok(fixture);
    assert.ok(typeof fixture.screen === 'string' && fixture.screen.length > 0);
    assert.equal(JSON.stringify(fixture).includes('undefined'), false);
  });
}

test('UI privacy fixture exposes no content fields', () => {
  const task = uiStates.privacyDetail.task;
  assert.equal(task.privacyMode, true);
  for (const field of ['project', 'model', 'summary', 'durationMs']) assert.equal(task[field], null);
});

test('UI quota fixtures map exact contract thresholds', () => {
  assert.deepEqual(
    [uiStates.quotaEmpty.quota.status, uiStates.quotaLow.quota.status, uiStates.quotaNormal.quota.status],
    ['empty', 'low', 'normal'],
  );
});

test('UI pagination error preserves existing items', () => {
  assert.ok(uiStates.paginationError.items.length > 0);
  assert.equal(uiStates.paginationError.loadMoreError.retryable, true);
});

const REQUIRED_MINIPROGRAM_STATES = [
  'firstRun', 'boundNoTask', 'taskList', 'privacyTask', 'fullTask', 'quota0', 'quota2', 'quota8',
  'pairActive', 'pairExpired', 'subscriptionRejected', 'mainSwitchOff', 'backendError', 'paginationError',
];

test('mini-program fixtures cover every frozen UX state', () => {
  assert.deepEqual(Object.keys(fixtures).sort(), REQUIRED_MINIPROGRAM_STATES.sort());
  for (const name of REQUIRED_MINIPROGRAM_STATES) assert.ok(fixtures[name], `missing fixture ${name}`);
});

test('mini-program non-error fixtures map to safe dashboard views', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    if (fixture.error) continue;
    const view = presentation.normalizeDashboard(fixture.bootstrap);
    assert.ok(Number.isSafeInteger(view.quota.available), `${name} quota`);
    assert.ok(Array.isArray(view.recentTasks), `${name} tasks`);
  }
});

test('mini-program privacy DTO removes content', () => {
  const mapped = presentation.normalizeTask(fixtures.privacyTask.tasks[0]);
  assert.equal(mapped.privacyMode, true);
  assert.equal(mapped.project, null);
  assert.equal(mapped.model, null);
  assert.equal(mapped.summary, null);
  assert.equal(mapped.durationMs, null);
});

test('mini-program full DTO keeps only documented display fields', () => {
  const mapped = presentation.normalizeTask(fixtures.fullTask.tasks[0]);
  assert.equal(mapped.privacyMode, false);
  assert.equal(mapped.project, 'token-monitor');
  assert.equal(mapped.model, 'gpt-5.6-sol');
  assert.match(mapped.summary, /微信小程序界面/);
  assert.equal(Object.hasOwn(mapped, 'prompt'), false);
  assert.equal(Object.hasOwn(mapped, 'conversation'), false);
});

test('mini-program quota presentation follows frozen thresholds', () => {
  assert.deepEqual(presentation.quotaView({ available: 0 }), {
    available: 0, status: 'empty', label: '已耗尽', notice: '任务仍会保存，但不会发送微信提醒', tone: 'danger',
  });
  assert.equal(presentation.quotaView({ available: 2 }).status, 'low');
  assert.equal(presentation.quotaView({ available: 8 }).status, 'normal');
});

test('mini-program pairing fixtures distinguish active and expired codes', () => {
  assert.ok(new Date(fixtures.pairActive.pairing.expiresAt).getTime() > Date.now());
  assert.ok(new Date(fixtures.pairExpired.pairing.expiresAt).getTime() < Date.now());
  assert.match(fixtures.pairActive.pairing.code, /^\d{6}$/);
});

test('mini-program mock adapter is fail-closed in committed runtime', () => {
  assert.equal(runtime.enableUiMock, false);
  assert.equal(runtime.uiMockFixture, '');
  assert.equal(mockAdapter.activeFixture(), null);
});

test('mini-program cloud business errors survive client envelope mapping', () => {
  const error = api.normalizeFailure({
    ok: false,
    error: { code: 'pairing_invalid', message: '配对码无效', retryable: false },
    requestId: 'req_testbusinesserror0001',
  });
  assert.equal(error.code, 'pairing_invalid');
  assert.equal(error.retryable, false);
});

test('mini-program quota permission call stays inside the bindtap handler', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/quota/index.js'), 'utf8');
  const handlerStart = source.indexOf('requestGrant() {');
  const platformCall = source.indexOf('wx.requestSubscribeMessage({', handlerStart);
  const nextMethod = source.indexOf('\n  async recordNonAccept', handlerStart);
  assert.ok(handlerStart >= 0 && platformCall > handlerStart && platformCall < nextMethod);
  assert.match(source, /tmplIds: \[intent\.templateId\]/);
});

test('mini-program declared pages and component JSON files parse', () => {
  const root = path.join(__dirname, '../miniprogram');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.equal(app.pages.length, 9);
  for (const page of app.pages) {
    JSON.parse(fs.readFileSync(path.join(root, `${page}.json`), 'utf8'));
    assert.ok(fs.existsSync(path.join(root, `${page}.wxml`)));
    assert.ok(fs.existsSync(path.join(root, `${page}.wxss`)));
  }
});
