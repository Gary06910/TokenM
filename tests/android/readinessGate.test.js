'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '../../apps/tokenm-android');
const docsRoot = path.resolve(__dirname, '../../docs/android');

function readDoc(name) {
  return fs.readFileSync(path.join(docsRoot, name), 'utf8');
}

test('Android handoff contains every required current-implementation document', () => {
  for (const name of [
    'ARCHITECTURE.md',
    'DATA_MODEL.md',
    'API_CONTRACT.md',
    'PUSH_MODEL.md',
    'TOKEN_M_PHASE2_PUSH_PLAN.md',
    'HONOR_SETUP.md',
    'XIAOMI_SETUP.md',
    'MANUAL_PREREQUISITES.md',
    'E2E_TEST_PLAN.md',
    'MIGRATION.md'
  ]) {
    assert.equal(fs.existsSync(path.join(docsRoot, name)), true, `${name} is missing`);
  }
});

test('Phase 2 frozen plan keeps runtime truth separate from local implementation', () => {
  const plan = readDoc('TOKEN_M_PHASE2_PUSH_PLAN.md');
  for (const heading of [
    'CURRENT_CID_FLOW',
    'CURRENT_MOBILE_DEVICE_SCHEMA',
    'CURRENT_PUSH_MODULE_STATUS',
    'ANDROID_SOURCE_CHANGE_REQUIRED',
    'FINAL_NOTIFICATION_ELIGIBILITY',
    'FINAL_PUSH_PAYLOAD',
    'FINAL_DELIVERY_STATE_MACHINE',
    'AT_MOST_ONCE_MECHANISM',
    'PRODUCTION_DEPLOYMENT_SCOPE'
  ]) {
    assert.match(plan, new RegExp(heading));
  }
  assert.match(plan, /ANDROID_SOURCE_CHANGE_REQUIRED[\s\S]{0,30}`NO`/);
  assert.match(plan, /HONOR_VENDOR: OFF/);
  assert.match(plan, /XIAOMI_VENDOR: OFF/);
  assert.match(plan, /HASH_USAGE: NONE/);
  assert.match(plan, /Production CID and device-display result: runtime gates, not source claims/);
});

test('Phase 2 server contract uses official APIs, minimal data, and no direct vendor path', () => {
  const plan = readDoc('TOKEN_M_PHASE2_PUSH_PLAN.md');
  const pushModel = readDoc('PUSH_MODEL.md');
  const providerSource = fs.readFileSync(path.join(
    projectRoot,
    'uniCloud-alipay/cloudfunctions/common/tokenm-core/push-notification.js'
  ), 'utf8');
  const applicationSource = fs.readFileSync(path.join(
    projectRoot,
    'uniCloud-alipay/cloudfunctions/common/tokenm-core/application.js'
  ), 'utf8');
  const schema = JSON.parse(fs.readFileSync(path.join(
    projectRoot,
    'uniCloud-alipay/database/tokenm-tasks.schema.json'
  ), 'utf8'));

  assert.match(pushModel, /uniCloud\.getPushManager/);
  assert.match(pushModel, /uniCloud\/uni-cloud-push\/api\.html/);
  assert.match(providerSource, /getPushManager/);
  assert.match(providerSource, /sendMessage/);
  assert.match(providerSource, /payload:\s*\{ taskId: safeTaskId \}/);
  assert.match(providerSource, /force_notification:\s*true/);
  assert.doesNotMatch(`${providerSource}\n${applicationSource}`, /getui|honor|huawei|xiaomi|oppo|vivo|meizu|fcm/i);
  assert.doesNotMatch(`${providerSource}\n${applicationSource}`, /sha256|digest|checksum/i);
  assert.match(plan, /Prompt, reply, cwd, terminal output/);
  assert.deepEqual(schema.properties.notificationStatus.enum, [
    'not_requested',
    'skipped_disabled',
    'skipped_no_target',
    'pending',
    'submitted',
    'failed'
  ]);
});

test('readiness gate keeps the frozen local identity while real Push remains disabled', () => {
  const manual = readDoc('MANUAL_PREREQUISITES.md');
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.appid, '__UNI__46C9063');
  assert.deepEqual(manifest['app-android'].distribute.modules['uni-push'], {});
  assert.match(manual, /^# TOKEN_M_ANDROID_MANUAL_ACTION_REQUIRED/m);
  for (const item of [
    'DCloud AppID',
    'Final Android package',
    'Release signing',
    'HBuilderX',
    'Android device tooling',
    'uni-push 2.0',
    'Honor application/Push',
    'TOKEN_M_DESKTOP_CREDENTIAL_KEY',
    'env-00jy6pbiul92'
  ]) {
    assert.match(manual, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(manual, /No cloud deployment, database initialization, provider send, signed build/);
});

test('manifest and manual gate do not claim vendor Push readiness', () => {
  const manual = readDoc('MANUAL_PREREQUISITES.md');
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest['app-android'].distribute.modules['uni-push'], {});
  assert.match(manual, /uni-push 2\.0/);
  assert.match(manual, /Honor application\/Push/);
  assert.match(manual, /No cloud deployment, database initialization, provider send, signed build/);
});

test('real-device plan requires every frozen Honor state and preserves status semantics', () => {
  const plan = readDoc('E2E_TEST_PLAN.md');
  for (const state of [
    'App foreground',
    'App background',
    'Device locked',
    'App removed from recents',
    'App process reclaimed by system'
  ]) {
    assert.match(plan, new RegExp(state));
  }
  assert.match(plan, /Force stop is not part of this matrix/);
  assert.match(plan, /do not relabel `submitted` as delivered/);
  assert.match(plan, /TOKEN_M_ANDROID_CODE_READY_FOR_REAL_DEVICE/);
  assert.match(plan, /TOKEN_M_ANDROID_P0_E2E_PASS/);
});

test('migration remains user-selected with no history copy or parallel mobile write', () => {
  const migration = readDoc('MIGRATION.md');
  assert.match(migration, /Development is parallel, not dual-written/);
  assert.match(migration, /does not import legacy task history/);
  assert.match(migration, /user explicitly selects the Android notification destination/);
  assert.match(migration, /Do not perform this action automatically/);
});

test('documented mobile API matches the integrated dashboard and grouped task filters', () => {
  const contract = readDoc('API_CONTRACT.md');
  const backend = fs.readFileSync(path.join(
    projectRoot,
    'uniCloud-alipay/cloudfunctions/common/tokenm-core/application.js'
  ), 'utf8');
  assert.match(contract, /getDashboard[\s\S]{0,120}dayStart\?, dayEnd\?/);
  assert.match(contract, /notificationStatuses/);
  assert.match(backend, /assertExactObject\(input, \['dayStart', 'dayEnd'\]\)/);
  assert.match(backend, /'notificationStatuses'/);
});
