'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createWeChatClient,
  pairWeChatDesktop,
  validatePairingResponse,
  wechatApiOrigin
} = require('../../src/electron/wechatClient');

const DESKTOP = 'dev_abcdefghijklmnopqrstuv';
const CREDENTIAL = `tm_wx_d1.${DESKTOP}.${'x'.repeat(43)}`;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('pairing and authenticated calls match the frozen Desktop HTTP contract', async (t) => {
  const calls = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      calls.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      if (request.url === '/v1/desktop/pair') {
        response.statusCode = 201;
        response.end(JSON.stringify({
          status: 'paired',
          desktop: { desktopId: DESKTOP, name: 'Desktop' },
          credential: CREDENTIAL,
          requestId: 'req_abcdefghijklmnop'
        }));
      } else if (request.url === '/v1/desktop/status') {
        response.end(JSON.stringify({ ok: true, desktop: { desktopId: DESKTOP, name: 'Desktop', status: 'active' } }));
      } else {
        response.end(JSON.stringify({ ok: true }));
      }
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const baseUrl = `http://127.0.0.1:${port}`;
  const paired = await pairWeChatDesktop({ baseUrl, code: '004219', deviceName: 'Desktop' });
  assert.equal(paired.credential, CREDENTIAL);
  const client = createWeChatClient({ baseUrl, credential: paired.credential });
  await client.status();
  await client.sendEvent({ eventId: 'evt_test' });
  await client.unpairSelf();
  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ['POST', '/v1/desktop/pair'],
    ['GET', '/v1/desktop/status'],
    ['POST', '/v1/desktop/events'],
    ['POST', '/v1/desktop/unpair-self']
  ]);
  assert.deepEqual(calls[0].body, { schemaVersion: 1, code: '004219', deviceName: 'Desktop' });
  assert.equal(calls[0].authorization, undefined);
  assert.ok(calls.slice(1).every((call) => call.authorization === `Bearer ${CREDENTIAL}`));
  assert.deepEqual(calls[3].body, { confirmation: 'UNPAIR' });
});

test('pairing response validation binds credential subject to returned desktop', () => {
  assert.throws(() => validatePairingResponse({
    status: 'paired',
    desktop: { desktopId: `dev_${'z'.repeat(22)}`, name: 'Other' },
    credential: CREDENTIAL
  }), /invalid pairing response/);
  assert.throws(() => validatePairingResponse({ status: 'paired', desktop: { desktopId: DESKTOP, name: 'Desktop' } }), /invalid pairing response/);
});

test('production URL validation accepts only HTTPS origins and loopback HTTP', () => {
  assert.equal(wechatApiOrigin('https://api.example.test/'), 'https://api.example.test');
  assert.equal(wechatApiOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.throws(() => wechatApiOrigin('http://api.example.test'), /HTTPS/);
  assert.throws(() => wechatApiOrigin('https://api.example.test/path'), /origin/);
  assert.throws(() => wechatApiOrigin('https://user:pass@api.example.test'), /origin/);
});
