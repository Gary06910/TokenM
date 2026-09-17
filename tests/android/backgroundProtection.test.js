'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');
const root = path.resolve(__dirname, '../../apps/tokenm-android');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function harness(storage = new Map()) {
  const env = { permission: 'authorized', exempt: true, sdk: 35, activity: true, intents: [], hooks: [], failRead: false, failWrite: false };
  class Intent { setAction(v) { this.action = v; } setData(v) { this.data = v; } }
  const activity = {
    getSystemService() { return { isIgnoringBatteryOptimizations() { if (env.osError) throw Error('OS read'); return env.exempt; } }; },
    getPackageName() { return 'com.gary.tokenm'; },
    startActivity(intent) { if (env.launchError) throw Error('missing activity'); env.intents.push(intent); }
  };
  const context = vm.createContext({
    Error, Intent, PowerManager: class {},
    Build: { VERSION: { get SDK_INT() { return env.sdk; } } },
    Context: { POWER_SERVICE: 'power' }, Uri: { parse: (v) => v },
    Settings: { ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS: 'battery-list', ACTION_APPLICATION_DETAILS_SETTINGS: 'app-details', ACTION_SETTINGS: 'settings' },
    UTSAndroid: { getUniActivity: () => env.activity ? activity : null },
    ref: (value) => ({ value }), onShow: (fn) => env.hooks.push(fn),
    uniCloud: new Proxy({}, { get() { throw Error('unexpected cloud access'); } }),
    uni: {
      getStorageSync(key) { if (env.failRead) throw Error('storage read'); return storage.get(key); },
      setStorageSync(key, value) { if (env.failWrite) throw Error('storage write'); storage.set(key, value); },
      getAppAuthorizeSetting() { if (env.permissionError) throw Error('permission read'); return { notificationAuthorized: env.permission }; },
      openAppAuthorizeSetting() { env.intents.push('notification-settings'); }, showToast() {}
    }
  });
  function load(source) {
    const clean = source.replace(/^import .*$/gm, '').replace(/\bexport /g, '');
    vm.runInContext(stripTypeScriptTypes(clean, { mode: 'transform' }), context);
  }
  load(read('services/background-protection-state.uts'));
  load(read('services/background-protection.uts'));
  load(read('services/background-guides.uts'));
  const run = (code) => vm.runInContext(code, context);
  return { env, storage, run, load };
}

test('local system states preserve denied, unknown, exemption and old Android distinctions', () => {
  const { env, run } = harness();
  assert.equal(run('readProtectionNotificationState()'), 'authorized');
  env.permission = 'denied'; assert.equal(run('readProtectionNotificationState()'), 'denied');
  env.permission = 'not determined'; assert.equal(run('readProtectionNotificationState()'), 'unknown');
  env.permissionError = true; assert.equal(run('readProtectionNotificationState()'), 'unknown');
  assert.equal(run('readBatteryOptimizationState()'), 'exempt');
  env.exempt = false; assert.equal(run('readBatteryOptimizationState()'), 'optimized');
  env.osError = true; assert.equal(run('readBatteryOptimizationState()'), 'unknown');
  env.osError = false; env.activity = false; assert.equal(run('readBatteryOptimizationState()'), 'unknown');
  env.sdk = 22; assert.equal(run('readBatteryOptimizationState()'), 'unsupported');
});

test('confirmation persists across module reload/account-neutral storage and can be undone', () => {
  const { storage, run } = harness();
  run("writeProtectionConfirmation('honor', true)");
  const next = harness(storage);
  assert.equal(next.run('readProtectionConfirmations().guideConfirmed'), true);
  next.run("writeProtectionConfirmation('honor', false)");
  assert.equal(run('readProtectionConfirmations().guideConfirmed'), false);
  run("writeProtectionBrand('xiaomi')");
  storage.set('tokenm.background-protection.xiaomi-guide-user-confirmed.v1', 'true');
  assert.equal(run('readProtectionConfirmations().guideConfirmed'), false);
  run("writeProtectionConfirmation('xiaomi', true)");
  assert.equal(harness(storage).run('readProtectionBrand()'), 'xiaomi');
  run("writeProtectionBrand('honor')");
  assert.equal(run('readProtectionConfirmations().guideConfirmed'), false);
});

test('manual flags never substitute for OS evidence; summary downgrades revoked permission', () => {
  const { run } = harness();
  assert.equal(run("protectionSummary('authorized', 'exempt', readProtectionConfirmations())"), '建议配置');
  run("writeProtectionConfirmation('honor', true)");
  assert.equal(run("protectionSummary('authorized', 'exempt', readProtectionConfirmations())"), '已完成基本设置');
  for (const battery of ['optimized', 'unknown']) assert.equal(run(`protectionSummary('authorized', '${battery}', readProtectionConfirmations())`), '建议配置');
  assert.equal(run("protectionSummary('denied', 'exempt', readProtectionConfirmations())"), '建议配置');
  assert.match(run('manualProtectionLabel(true)'), /手动确认.*未自动检测/);
  assert.match(run("batteryProtectionLabel('unsupported')"), /无此/);
  assert.doesNotMatch(run("batteryProtectionLabel('unknown')"), /已忽略/);
});

test('page mount/resume only reads locally; clicks alone open settings; returning rechecks OS', () => {
  const { env, run, load } = harness();
  load(read('pages/background-protection/index.uvue').match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]);
  env.hooks[0](); assert.equal(env.intents.length, 0);
  run('openBattery()'); assert.equal(env.intents[0].action, 'battery-list');
  assert.equal(run('confirmations.value.guideConfirmed'), false);
  run('openApp()'); assert.equal(env.intents[1].data, 'package:com.gary.tokenm');
  run('openNotifications()'); assert.equal(env.intents[2], 'notification-settings');
  env.exempt = false; env.hooks[0](); assert.equal(run('battery.value'), 'optimized');
  env.launchError = true; run('openSystem()'); assert.match(run('message.value'), /请手动打开/);
});

test('storage failure never fabricates successful confirmation', () => {
  const { env, run, load } = harness();
  load(read('pages/background-protection/index.uvue').match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]);
  env.hooks[0](); env.failWrite = true; run('toggleGuide()');
  assert.equal(run('confirmations.value.guideConfirmed'), false);
  assert.match(run('message.value'), /未能保存/);
  env.failRead = true; run('refresh()'); assert.equal(run('summary.value'), '建议配置');
});

test('route and accessible settings entry preserve cache path and avoid cloud/Push dependency', () => {
  const settings = read('pages/settings/index.uvue');
  assert.ok(settings.indexOf('class="profile-row') < settings.indexOf('@click="goBackgroundProtection"'));
  assert.ok(settings.indexOf('@click="goBackgroundProtection"') < settings.indexOf('<text class="group-label">通知'));
  assert.match(settings, /uni.navigateTo\(\{ url: '\/pages\/background-protection\/index' \}\)/);
  assert.ok(JSON.parse(read('pages.json')).pages.some((p) => p.path === 'pages/background-protection/index'));
  const closure = ['services/background-protection.uts', 'services/background-protection-state.uts', 'services/background-guides.uts', 'pages/background-protection/index.uvue'].map(read).join('\n');
  assert.doesNotMatch(closure, /uniCloud|importObject|client-runtime\.uts|push-runtime\.uts|mobile-device\.uts|setInterval|setTimeout|requestSystemPermission|ACTION_REQUEST_IGNORE/);
  assert.doesNotMatch(read('AndroidManifest.xml'), /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS|FOREGROUND_SERVICE/);
  assert.doesNotMatch(read('services/auth-service.uts') + read('services/client-runtime.uts'), /clearStorage|background-protection/);
  assert.match(settings, /restoreCached\(\)[\s\S]*runLoad\(state.value == 'ready'\)/);
});


test('both brands have distinct guidance and confirmation state survives brand switching',()=>{
  const {run,storage}=harness();
  assert.match(run("getBackgroundGuide('honor').steps.map(s=>s.text).join(' ')"),/允许关联启动/);
  assert.match(run("getBackgroundGuide('xiaomi').steps.map(s=>s.text).join(' ')"),/No restrictions/);
  run("writeProtectionBrand('honor');writeProtectionConfirmation('honor',true)");
  run("writeProtectionBrand('xiaomi')");assert.equal(run('readProtectionConfirmations().guideConfirmed'),false);
  run("writeProtectionConfirmation('xiaomi',true);writeProtectionBrand('honor');writeProtectionConfirmation('honor',false)");
  run("writeProtectionBrand('xiaomi')");assert.equal(harness(storage).run('readProtectionConfirmations().guideConfirmed'),true);
  assert.match(read('pages/background-protection/index.uvue'),/手机品牌/);
  assert.match(read('pages/background-protection/index.uvue'),/selectBrand/);
});
