'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createTokenMCloudClient } = require('../../src/electron/tokenMCloudClient');
const { normalizeCodexCompletion } = require('../../src/shared/codexCompletion');

const credential = `tm_d1.${'A'.repeat(22)}.dev_${'B'.repeat(22)}.${'C'.repeat(43)}`;

test('uses authenticated no-store requests for status, pairing, and events', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/status')) {
      return new Response(JSON.stringify({ ok: true, device: { name: 'DESKTOP-TEST' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const client = createTokenMCloudClient({ baseUrl: 'https://example.workers.dev/', credential, fetch });
  await client.status();
  await client.createPairing();
  const event = normalizeCodexCompletion({
    hook_event_name: 'Stop', session_id: 'thr_1', turn_id: 'turn_1', cwd: '/work/project'
  }, { deviceId: 'dev_0123456789012345678901', now: () => 1_776_336_000_000 });
  await client.sendEvent({ ...event, transcript_path: '/private', last_assistant_message: 'secret' });

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/v1/desktop/status', '/v1/pairings', '/v1/events'
  ]);
  assert.ok(calls.every((call) => call.init.headers.authorization === `Bearer ${credential}`));
  assert.ok(calls.every((call) => call.init.cache === 'no-store' && call.init.credentials === 'omit'));
  assert.deepEqual(JSON.parse(calls[1].init.body), { deviceName: 'DESKTOP-TEST' });
  assert.doesNotMatch(calls[2].init.body, /private|secret/);
});

test('fetches status to obtain the frozen pairing deviceName when needed', async () => {
  const paths = [];
  const client = createTokenMCloudClient({
    baseUrl: 'https://example.workers.dev',
    credential,
    fetch: async (url) => {
      paths.push(new URL(url).pathname);
      return new Response(JSON.stringify(paths.length === 1
        ? { ok: true, device: { name: 'Desktop' } }
        : { pairingUrl: 'https://example.workers.dev/pair#token=redacted', expiresAt: '2026-08-17T10:10:00.000Z' }), { status: paths.length === 1 ? 200 : 201 });
    }
  });
  const result = await client.createPairing();
  assert.deepEqual(paths, ['/v1/desktop/status', '/v1/pairings']);
  assert.match(result.pairingUrl, /\/pair#/);
});

test('surfaces safe machine errors without credentials or response messages', async () => {
  const client = createTokenMCloudClient({
    baseUrl: 'https://example.workers.dev',
    credential,
    fetch: async () => new Response(JSON.stringify({ error: 'credential_invalid', message: credential }), { status: 401 })
  });
  await assert.rejects(client.status(), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'credential_invalid');
    assert.doesNotMatch(error.message, /tm_d1/);
    return true;
  });
});

test('rejects non-loopback plaintext managed cloud URLs', () => {
  assert.throws(() => createTokenMCloudClient({
    baseUrl: 'http://example.com', credential, fetch: async () => null
  }), /HTTPS/);
});
