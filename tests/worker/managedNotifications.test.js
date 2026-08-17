'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

function fakeState() {
  const map = new Map();
  return {
    storage: {
      async get(key) { return structuredClone(map.get(key)); },
      async put(key, value) { map.set(key, structuredClone(value)); },
      async delete(key) { return map.delete(key); },
      async transaction(callback) {
        return callback({
          async get(key) { return structuredClone(map.get(key)); },
          async put(key, value) { map.set(key, structuredClone(value)); },
          async delete(key) { return map.delete(key); }
        });
      },
      async list({ prefix = '', limit = Infinity } = {}) {
        return new Map([...map].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([key, value]) => [key, structuredClone(value)]));
      }
    },
    map
  };
}

const ENV = {
  TOKEN_M_ENROLLMENT_SECRET: 'private-beta-code',
  TOKEN_M_CREDENTIAL_PEPPER: 'test-pepper-with-enough-entropy',
  TOKEN_M_VAPID_PUBLIC_KEY: `B${'A'.repeat(86)}`,
  TOKEN_M_VAPID_PRIVATE_KEY: 'C'.repeat(43),
  TOKEN_M_VAPID_SUBJECT: 'mailto:test@example.com'
};

function jsonRequest(pathname, { method = 'POST', body, bearer, headers = {} } = {}) {
  return new Request(`https://notify.example${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      'x-token-m-tenant-id': 'AAAAAAAAAAAAAAAAAAAAAA',
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

async function setup({ tenantId = 'AAAAAAAAAAAAAAAAAAAAAA', deviceName = 'DESKTOP-A' } = {}) {
  const worker = await import(pathToFileURL(path.resolve(__dirname, '../../worker/src/index.js')).href);
  const state = fakeState();
  const tenant = new worker.TenantDO(state, ENV);
  let clock = Date.parse('2026-08-17T10:00:00.000Z');
  tenant.now = () => clock;
  const request = (pathname, options = {}) => jsonRequest(pathname, {
    ...options,
    headers: { ...options.headers, 'x-token-m-tenant-id': tenantId }
  });
  const tenantHeader = { 'x-token-m-enrollment-secret': ENV.TOKEN_M_ENROLLMENT_SECRET };
  const enrolledResponse = await tenant.fetch(request('/v1/desktop/enroll', { body: { deviceName }, headers: tenantHeader }));
  assert.equal(enrolledResponse.status, 201);
  const enrolled = await enrolledResponse.json();
  return { worker, state, tenant, enrolled, request, setClock(value) { clock = value; }, getClock() { return clock; } };
}

async function pairMobile(context, name = 'iPhone') {
  const pairingResponse = await context.tenant.fetch(context.request('/v1/pairings', { bearer: context.enrolled.credential, body: { deviceName: context.enrolled.device.name } }));
  assert.equal(pairingResponse.status, 201);
  const token = new URL((await pairingResponse.json()).pairingUrl).hash.slice('#token='.length);
  const redeemResponse = await context.tenant.fetch(context.request('/v1/pairings/redeem', { body: { token, installationName: name } }));
  assert.equal(redeemResponse.status, 201);
  return { token, mobile: await redeemResponse.json() };
}

async function subscribe(context, mobile) {
  const response = await context.tenant.fetch(context.request('/v1/mobile/subscription', {
    method: 'PUT', bearer: mobile.credential, body: {
      permission: 'granted',
      subscription: {
        endpoint: `https://push.example/${mobile.installation.installationId}`,
        expirationTime: null,
        keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }
      }
    }
  }));
  assert.equal(response.status, 200);
}

function event(deviceId, suffix = 'abcdefghijklmnop') {
  return {
    eventId: `evt_${suffix}`,
    type: 'codex.turn.completed',
    deviceId,
    sessionId: 'thr_1',
    turnId: 'turn_1',
    status: 'completed',
    project: 'token-m',
    summary: 'Codex task completed',
    occurredAt: '2026-08-17T10:00:00.000Z',
    durationMs: 512000
  };
}

test('managed enrollment issues scoped credentials and rejects cross-tenant routing', async () => {
  const { worker, enrolled } = await setup();
  assert.match(enrolled.tenantId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(enrolled.device.deviceId, /^dev_[A-Za-z0-9_-]{22}$/);
  assert.equal(worker.parseCapability, undefined, 'capability parser stays in the managed module, not the public Worker API');

  const otherState = fakeState();
  const other = new worker.TenantDO(otherState, ENV);
  const response = await other.fetch(new Request('https://notify.example/v1/desktop/status', {
    headers: { authorization: `Bearer ${enrolled.credential}`, 'x-token-m-tenant-id': 'BBBBBBBBBBBBBBBBBBBBBB' }
  }));
  assert.equal(response.status, 401);
});

test('top-level routing preserves legacy API, isolates tenants, and passes static assets through', async () => {
  const worker = await import(pathToFileURL(path.resolve(__dirname, '../../worker/src/index.js')).href);
  const calls = [];
  const namespace = (name) => ({
    idFromName(value) { calls.push([name, 'id', value]); return value; },
    get(value) { return { fetch(request) { calls.push([name, 'fetch', value, new URL(request.url).pathname]); return new Response(name); } }; }
  });
  const env = {
    ...ENV,
    HUB: namespace('hub'),
    TENANTS: namespace('tenant'),
    ASSETS: { fetch(request) { calls.push(['assets', new URL(request.url).pathname]); return new Response('asset'); } }
  };

  assert.equal(await (await worker.default.fetch(new Request('https://notify.example/api/health'), env)).text(), 'hub');
  assert.equal(await (await worker.default.fetch(new Request('https://notify.example/pair'), env)).text(), 'asset');
  const invalid = await worker.default.fetch(jsonRequest('/v1/desktop/enroll', { body: { deviceName: 'A' }, headers: { 'x-token-m-enrollment-secret': 'wrong' } }), env);
  assert.equal(invalid.status, 403);
  assert.equal(calls.filter(([name]) => name === 'tenant').length, 0, 'bad enrollment codes must not allocate tenant objects');
  const routed = await worker.default.fetch(jsonRequest('/v1/desktop/enroll', { body: { deviceName: 'A' }, headers: { 'x-token-m-enrollment-secret': ENV.TOKEN_M_ENROLLMENT_SECRET } }), env);
  assert.equal(await routed.text(), 'tenant');
  assert.match(calls.find(([name, action]) => name === 'tenant' && action === 'id')[2], /^tenant:[A-Za-z0-9_-]{22}$/);
});

test('pairing is one-time, expires after ten minutes, and never stores raw capabilities', async () => {
  const context = await setup();
  const first = await pairMobile(context);
  const replay = await context.tenant.fetch(jsonRequest('/v1/pairings/redeem', { body: { token: first.token, installationName: 'Replay' } }));
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_pairing');

  const pairing = await context.tenant.fetch(jsonRequest('/v1/pairings', { bearer: context.enrolled.credential, body: { deviceName: 'DESKTOP-A' } }));
  const token = new URL((await pairing.json()).pairingUrl).hash.slice('#token='.length);
  context.setClock(context.getClock() + 10 * 60 * 1000 + 1);
  const expired = await context.tenant.fetch(jsonRequest('/v1/pairings/redeem', { body: { token, installationName: 'Late phone' } }));
  assert.equal(expired.status, 400);
  assert.doesNotMatch(JSON.stringify([...context.state.map.values()]), /tm_[dmp]1\./);
});

test('simultaneous pairing redemption issues exactly one mobile credential', async () => {
  const context = await setup();
  const pairing = await context.tenant.fetch(jsonRequest('/v1/pairings', { bearer: context.enrolled.credential, body: { deviceName: 'DESKTOP-A' } }));
  const token = new URL((await pairing.json()).pairingUrl).hash.slice('#token='.length);
  const requests = ['Phone A', 'Phone B'].map((installationName) => context.tenant.fetch(jsonRequest('/v1/pairings/redeem', { body: { token, installationName } })));
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400]);
  const mobiles = [...context.state.map.keys()].filter((key) => key.startsWith('mobile:'));
  assert.equal(mobiles.length, 1);
});

test('desktop and mobile auth are endpoint-specific and subscription input is bounded', async () => {
  const context = await setup();
  const { mobile } = await pairMobile(context);
  assert.equal((await context.tenant.fetch(jsonRequest('/v1/desktop/status', { method: 'GET', bearer: mobile.credential }))).status, 401);
  assert.equal((await context.tenant.fetch(jsonRequest('/v1/mobile/status', { method: 'GET', bearer: context.enrolled.credential }))).status, 401);
  const invalid = await context.tenant.fetch(jsonRequest('/v1/mobile/subscription', {
    method: 'PUT', bearer: mobile.credential, body: {
      permission: 'granted', subscription: { endpoint: 'http://push.example/nope', expirationTime: null, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } }
    }
  }));
  assert.equal(invalid.status, 400);
});

test('event delivery dedupes and retries only pending installations', async () => {
  const context = await setup();
  const first = (await pairMobile(context, 'Phone 1')).mobile;
  const second = (await pairMobile(context, 'Phone 2')).mobile;
  await subscribe(context, first);
  await subscribe(context, second);
  const calls = [];
  context.tenant.push = async (subscription) => {
    calls.push(subscription.endpoint);
    if (subscription.endpoint.endsWith(second.installation.installationId) && calls.filter((value) => value === subscription.endpoint).length === 1) return { classification: 'pending', status: 503 };
    return { classification: 'delivered', status: 201 };
  };

  const payload = event(context.enrolled.device.deviceId);
  const initial = await context.tenant.fetch(jsonRequest('/v1/events', { bearer: context.enrolled.credential, body: payload }));
  assert.equal(initial.status, 503);
  assert.equal((await initial.json()).delivered, 1);
  const retry = await context.tenant.fetch(jsonRequest('/v1/events', { bearer: context.enrolled.credential, body: payload }));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);
  assert.equal(calls.filter((value) => value.endsWith(first.installation.installationId)).length, 1);
  assert.equal(calls.filter((value) => value.endsWith(second.installation.installationId)).length, 2);
  const completeDuplicate = await context.tenant.fetch(jsonRequest('/v1/events', { bearer: context.enrolled.credential, body: payload }));
  assert.equal(completeDuplicate.status, 200);
  assert.equal(calls.length, 3);
});

test('404 and 410 push responses clear only the expired installation', async () => {
  const context = await setup();
  const { mobile } = await pairMobile(context);
  await subscribe(context, mobile);
  context.tenant.push = async () => ({ classification: 'expired', status: 410 });
  const response = await context.tenant.fetch(jsonRequest('/v1/events', { bearer: context.enrolled.credential, body: event(context.enrolled.device.deviceId, 'qrstuvwxyzABCDEF') }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).expired, 1);
  const status = await (await context.tenant.fetch(jsonRequest('/v1/mobile/status', { method: 'GET', bearer: mobile.credential }))).json();
  assert.equal(status.installation.pushEnabled, false);
});

test('test push targets the caller and DELETE revokes its credential', async () => {
  const context = await setup();
  const { mobile } = await pairMobile(context);
  await subscribe(context, mobile);
  let calls = 0;
  context.tenant.push = async () => { calls += 1; return { classification: 'delivered', status: 201 }; };
  const testResponse = await context.tenant.fetch(jsonRequest('/v1/mobile/test', { bearer: mobile.credential, body: {} }));
  assert.equal(testResponse.status, 200);
  assert.match((await testResponse.json()).eventId, /^evt_test_/);
  assert.equal(calls, 1);
  assert.equal((await context.tenant.fetch(jsonRequest('/v1/mobile', { method: 'DELETE', bearer: mobile.credential }))).status, 200);
  assert.equal((await context.tenant.fetch(jsonRequest('/v1/mobile/status', { method: 'GET', bearer: mobile.credential }))).status, 401);
});

test('desktop test push reaches every active subscribed mobile with fixed privacy-safe content', async () => {
  const context = await setup();
  const first = (await pairMobile(context, 'Phone 1')).mobile;
  const second = (await pairMobile(context, 'Phone 2')).mobile;
  await subscribe(context, first);
  await subscribe(context, second);
  const pushes = [];
  context.tenant.push = async (subscription, message) => {
    pushes.push({ endpoint: subscription.endpoint, message });
    return { classification: 'delivered', status: 201 };
  };

  const response = await context.tenant.fetch(context.request('/v1/desktop/test', { bearer: context.enrolled.credential, body: {} }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).delivered, 2);
  assert.equal(pushes.length, 2);
  for (const push of pushes) {
    assert.equal(push.message.title, 'Token M');
    assert.equal(push.message.body, 'Token M notifications are working');
    assert.doesNotMatch(JSON.stringify(push.message), /prompt|assistant|transcript/i);
  }

  const custom = await context.tenant.fetch(context.request('/v1/desktop/test', {
    bearer: context.enrolled.credential,
    body: { body: 'Attacker-controlled notification' }
  }));
  assert.equal(custom.status, 400);
  assert.equal(pushes.length, 2, 'rejected custom content must never reach push delivery');
  assert.equal((await context.tenant.fetch(context.request('/v1/desktop/test', { bearer: first.credential, body: {} }))).status, 401);
});

test('desktop mobile deletion validates auth and ids while remaining idempotent', async () => {
  const context = await setup();
  const { mobile } = await pairMobile(context);
  const installationId = mobile.installation.installationId;
  const path = `/v1/desktop/mobile/${installationId}`;

  assert.equal((await context.tenant.fetch(context.request(path, { method: 'DELETE', bearer: mobile.credential }))).status, 401);
  assert.equal((await context.tenant.fetch(context.request('/v1/desktop/mobile/not-a-mobile-id', { method: 'DELETE', bearer: context.enrolled.credential }))).status, 400);
  assert.equal((await context.tenant.fetch(context.request(path, { method: 'DELETE', bearer: context.enrolled.credential }))).status, 200);
  assert.equal(context.state.map.has(`mobile:${installationId}`), false);
  assert.equal((await context.tenant.fetch(context.request(path, { method: 'DELETE', bearer: context.enrolled.credential }))).status, 200, 'missing installations stay indistinguishable from deleted ones');
});

test('desktop deletion cannot cross tenant boundaries or use a wrong-tenant credential', async () => {
  const first = await setup();
  const second = await setup({ tenantId: 'BBBBBBBBBBBBBBBBBBBBBB', deviceName: 'DESKTOP-B' });
  const { mobile } = await pairMobile(second, 'Other tenant phone');
  const installationId = mobile.installation.installationId;
  const path = `/v1/desktop/mobile/${installationId}`;

  const crossTenantAttempt = await first.tenant.fetch(first.request(path, { method: 'DELETE', bearer: first.enrolled.credential }));
  assert.equal(crossTenantAttempt.status, 200, 'unknown ids are idempotent to prevent an existence oracle');
  assert.equal(second.state.map.has(`mobile:${installationId}`), true, 'another tenant storage object must remain untouched');

  const wrongTenantCredential = await second.tenant.fetch(second.request(path, { method: 'DELETE', bearer: first.enrolled.credential }));
  assert.equal(wrongTenantCredential.status, 401);
  assert.equal(second.state.map.has(`mobile:${installationId}`), true);
});

test('managed requests enforce JSON content type, body size, event schema, and no-store', async () => {
  const context = await setup();
  const missingType = await context.tenant.fetch(new Request('https://notify.example/v1/events', {
    method: 'POST', headers: { authorization: `Bearer ${context.enrolled.credential}`, 'x-token-m-tenant-id': context.enrolled.tenantId }, body: '{}'
  }));
  assert.equal(missingType.status, 415);
  assert.equal(missingType.headers.get('cache-control'), 'no-store');
  const mismatch = await context.tenant.fetch(jsonRequest('/v1/events', { bearer: context.enrolled.credential, body: event('dev_AAAAAAAAAAAAAAAAAAAAAA') }));
  assert.equal(mismatch.status, 403);
  const oversized = await context.tenant.fetch(jsonRequest('/v1/events', { bearer: context.enrolled.credential, body: { ...event(context.enrolled.device.deviceId), summary: 'x'.repeat(17 * 1024) } }));
  assert.equal(oversized.status, 413);
});
