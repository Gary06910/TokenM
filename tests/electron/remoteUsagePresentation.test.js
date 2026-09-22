'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const homeOverview = require('../../src/electron/renderer/homeOverview');

const appSource = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8');

test('home source projection keeps zero-token A800 source visible and preserves untrusted names as data', () => {
  const rows = homeOverview.homeSourceRows([
    { id: 'local-0', kind: 'local', name: 'Local Windows', isLocal: true, periods: { today: { totalTokens: 0 } } },
    { id: 'remote-0', kind: 'remote', name: '<img src=x onerror=alert(1)>', stale: true, profiles: [], periods: { today: { totalTokens: 0 } } }
  ], { period: 'today', limit: 4 });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, '<img src=x onerror=alert(1)>');
  assert.equal(rows[1].status, 'stale');
  assert.equal(rows[1].value, 0);
});

test('renderer source/profile labels use textContent and do not expose desktop identity', () => {
  const homeModuleStart = appSource.indexOf('function renderHomeDeviceModule()');
  const homeModuleEnd = appSource.indexOf('\nfunction ', homeModuleStart + 10);
  const homeModule = appSource.slice(homeModuleStart, homeModuleEnd);
  assert.match(homeModule, /name\.textContent = row\.name/);
  assert.match(appSource, /profileName\.textContent = profile\.name \|\| profile\.id/);
  assert.doesNotMatch(homeModule, /innerHTML/);
  const labelStart = appSource.indexOf('function deviceLabel(');
  const labelEnd = appSource.indexOf('\nfunction deviceColor(', labelStart);
  assert.doesNotMatch(appSource.slice(labelStart, labelEnd), /device\.deviceId/);
});

test('renderer never becomes a remote API or credential boundary', () => {
  assert.doesNotMatch(`${appSource}\n${preloadSource}`, /v1\/desktop\/usage|authorization\s*:/i);
  assert.doesNotMatch(`${appSource}\n${preloadSource}`, /credentialDesktopId|tokenMAndroidCredential|tm_uc_d1/);
});
