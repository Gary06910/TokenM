'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const publicDir = path.join(root, 'worker', 'public');

async function loadApp() {
  return import(pathToFileURL(path.join(publicDir, 'app.js')).href);
}

test('pair fragment is returned and synchronously removed from history', async () => {
  const { readAndClearPairToken } = await loadApp();
  const calls = [];
  const token = readAndClearPairToken(
    { hash: '#token=tm_p1.tenant.challenge.secret', pathname: '/pair', search: '?source=qr' },
    { replaceState: (...args) => calls.push(args) },
  );

  assert.equal(token, 'tm_p1.tenant.challenge.secret');
  assert.deepEqual(calls, [[null, '', '/pair?source=qr']]);
});

test('platform detection covers iPad desktop UA and standalone mode', async () => {
  const { detectPlatform } = await loadApp();
  assert.deepEqual(detectPlatform('Mozilla/5.0 (Macintosh)', 5, true, false), {
    ios: true,
    android: false,
    standalone: true,
  });
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 15)', 1).android, true);
});

test('notification decisions expose unsupported, iOS, denied, expired, and ready states', async () => {
  const { notificationDecision } = await loadApp();
  const base = {
    online: true,
    supported: true,
    ios: false,
    standalone: false,
    permission: 'default',
    browserSubscription: false,
    serverPushEnabled: false,
  };

  assert.equal(notificationDecision({ ...base, supported: false }).code, 'unsupported');
  assert.equal(notificationDecision({ ...base, ios: true }).code, 'ios-home-screen');
  assert.equal(notificationDecision({ ...base, ios: true, supported: false }).code, 'ios-home-screen');
  assert.equal(notificationDecision({ ...base, permission: 'denied' }).code, 'denied');
  assert.equal(notificationDecision({ ...base, permission: 'granted', serverPushEnabled: true }).code, 'expired');
  assert.equal(notificationDecision({ ...base, permission: 'granted', browserSubscription: true, serverPushEnabled: false, subscriptionExpired: true }).code, 'expired');
  assert.equal(notificationDecision({ ...base, permission: 'granted', browserSubscription: true, serverPushEnabled: true }).code, 'enabled');
  assert.equal(notificationDecision({ ...base, online: false }).code, 'offline');
});

test('VAPID URL-safe base64 conversion preserves bytes', async () => {
  const { urlBase64ToUint8Array } = await loadApp();
  assert.deepEqual([...urlBase64ToUint8Array('AQID-v8')], [1, 2, 3, 250, 255]);
});

test('stored auth validation accepts only mobile credentials with the frozen shape', async () => {
  const { isStoredAuth } = await loadApp();
  const valid = {
    key: 'installation',
    tenantId: 'tenant',
    installationId: 'mob_installation',
    credential: 'tm_m1.tenant.mob_installation.secret',
    desktop: { deviceId: 'dev_desktop', name: 'Desktop' },
  };
  assert.equal(isStoredAuth(valid), true);
  assert.equal(isStoredAuth({ ...valid, credential: 'tm_d1.tenant.dev.secret' }), false);
  assert.equal(isStoredAuth({ ...valid, desktop: null }), false);
});

test('PWA source honors credential, same-origin API, and safe-rendering contracts', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

  assert.match(app, /const DB_NAME = 'token-m'/);
  assert.match(app, /const AUTH_STORE = 'auth'/);
  assert.match(app, /const AUTH_KEY = 'installation'/);
  assert.match(app, /readAndClearPairToken\(window\.location, window\.history\)/);
  assert.match(app, /credentials: 'omit'/);
  assert.match(app, /cache: 'no-store'/);
  assert.match(app, /'\/v1\/pairings\/redeem'/);
  assert.match(app, /'\/v1\/mobile\/status'/);
  assert.match(app, /'\/v1\/mobile\/subscription'/);
  assert.match(app, /'\/v1\/mobile\/test'/);
  assert.match(app, /'\/v1\/mobile'/);
  assert.doesNotMatch(app, /innerHTML|document\.cookie|localStorage|console\./);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Content-Security-Policy/);
});

test('service worker validates push navigation and handles lifecycle events', () => {
  const source = fs.readFileSync(path.join(publicDir, 'service-worker.js'), 'utf8');
  assert.match(source, /addEventListener\('push'/);
  assert.match(source, /showNotification/);
  assert.match(source, /addEventListener\('notificationclick'/);
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /clients\.matchAll/);
  assert.match(source, /clients\.openWindow/);
  assert.match(source, /skipWaiting/);
  assert.match(source, /clients\.claim/);
  assert.doesNotMatch(source, /innerHTML|eval\(|new Function/);
});

test('manifest has stable standalone identity and local icon assets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Token M');
  assert.equal(manifest.short_name, 'Token M');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.equal(icon.src.startsWith('/icons/'), true);
    assert.equal(fs.existsSync(path.join(publicDir, icon.src)), true);
  }
});
