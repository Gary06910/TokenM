'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const {
  androidApiOrigin,
  createAndroidClient,
  pairAndroidDesktop,
  validateEventResponse,
  validatePairingResponse
} = require('../../src/electron/androidClient');

const DESKTOP = 'dev_11111111-1111-4111-8111-111111111111';
const CREDENTIAL = `tm_uc_d1.${DESKTOP}.${'x'.repeat(43)}`;

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

test('Android Desktop client preserves the four frozen HTTP routes and bearer boundary', async (t) => {
  const calls = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      calls.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      if (request.url === '/tokenm-desktop-http/v1/desktop/pair') {
        response.statusCode = 201;
        response.end(JSON.stringify({
          status: 'paired',
          desktop: { desktopId: DESKTOP, name: 'Android Desktop' },
          credential: CREDENTIAL,
          requestId: 'req_android_client'
        }));
      } else if (request.url === '/tokenm-desktop-http/v1/desktop/status') {
        response.end(JSON.stringify({
          ok: true,
          desktop: { desktopId: DESKTOP, name: 'Android Desktop', status: 'active' }
        }));
      } else if (request.url === '/tokenm-desktop-http/v1/desktop/events') {
        response.statusCode = 201;
        response.end(JSON.stringify({
          status: 'created',
          taskId: 'tsk_11111111-1111-4111-8111-111111111111',
          notificationStatus: 'not_requested'
        }));
      } else {
        response.end(JSON.stringify({ ok: true }));
      }
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const baseUrl = `http://127.0.0.1:${port}/tokenm-desktop-http`;
  const paired = await pairAndroidDesktop({ baseUrl, code: '004219', deviceName: 'Android Desktop' });
  const client = createAndroidClient({ baseUrl, credential: paired.credential });
  await client.status();
  await client.sendEvent({ eventId: 'evt:session-1:turn-1' });
  await client.unpairSelf();

  assert.equal(paired.credential, CREDENTIAL);
  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ['POST', '/tokenm-desktop-http/v1/desktop/pair'],
    ['GET', '/tokenm-desktop-http/v1/desktop/status'],
    ['POST', '/tokenm-desktop-http/v1/desktop/events'],
    ['POST', '/tokenm-desktop-http/v1/desktop/unpair-self']
  ]);
  assert.deepEqual(calls[0].body, { schemaVersion: 1, code: '004219', deviceName: 'Android Desktop' });
  assert.equal(calls[0].authorization, undefined);
  assert.ok(calls.slice(1).every((call) => call.authorization === `Bearer ${CREDENTIAL}`));
  assert.deepEqual(calls[3].body, { confirmation: 'UNPAIR' });
});

test('Android credential subject and API origin are validated independently from WeChat', () => {
  assert.equal(androidApiOrigin('https://android.example.test/'), 'https://android.example.test');
  assert.equal(androidApiOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(
    androidApiOrigin('https://android.example.test/tokenm-desktop-http/'),
    'https://android.example.test/tokenm-desktop-http'
  );
  assert.throws(() => androidApiOrigin('http://android.example.test'), /HTTPS/);
  assert.throws(() => androidApiOrigin('https://user:pass@android.example.test'), /credentials/);
  assert.throws(() => androidApiOrigin('https://android.example.test/path?secret=value'), /query/);
  assert.throws(() => validatePairingResponse({
    status: 'paired',
    desktop: { desktopId: 'dev_22222222-2222-4222-8222-222222222222', name: 'Other' },
    credential: CREDENTIAL
  }), /invalid pairing response/);
  assert.throws(() => createAndroidClient({
    baseUrl: 'https://android.example.test',
    credential: CREDENTIAL.replace('tm_uc_d1', 'tm_wx_d1')
  }), /credential/);
});

test('Android client keeps its credential namespace independent from WeChat', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/electron/androidClient.js'), 'utf8');
  assert.doesNotMatch(source, /tm_wx_d1/);
});

test('Android event responses require a safe created or duplicate acknowledgement', async () => {
  const responses = [
    {
      status: 'created',
      taskId: 'tsk_11111111-1111-4111-8111-111111111111',
      notificationStatus: 'not_requested',
      requestId: 'req_created'
    },
    {
      status: 'duplicate',
      taskId: 'tsk_22222222-2222-4222-8222-222222222222',
      notificationStatus: 'not_requested'
    }
  ];
  const client = createAndroidClient({
    baseUrl: 'https://android.example.test',
    credential: CREDENTIAL,
    fetch: async () => {
      const response = responses.shift();
      return new Response(JSON.stringify(response), {
        status: response.status === 'created' ? 201 : 200
      });
    }
  });
  assert.deepEqual(await client.sendEvent({}), {
    status: 'created',
    taskId: 'tsk_11111111-1111-4111-8111-111111111111',
    notificationStatus: 'not_requested',
    requestId: 'req_created'
  });
  assert.deepEqual(await client.sendEvent({}), {
    status: 'duplicate',
    taskId: 'tsk_22222222-2222-4222-8222-222222222222',
    notificationStatus: 'not_requested'
  });
  for (const notificationStatus of [
    'not_requested',
    'skipped_disabled',
    'skipped_no_target',
    'pending',
    'submitted',
    'failed'
  ]) {
    assert.equal(validateEventResponse({
      status: 'created',
      taskId: 'tsk_11111111-1111-4111-8111-111111111111',
      notificationStatus
    }).notificationStatus, notificationStatus);
  }
  assert.throws(() => validateEventResponse({
    status: 'created',
    taskId: 'tsk_11111111-1111-4111-8111-111111111111',
    notificationStatus: 'delivered_to_device'
  }), (error) => error.code === 'invalid_response');
  assert.throws(() => validateEventResponse({
    status: 'created',
    taskId: 'tsk_11111111-1111-4111-8111-111111111111',
    notificationStatus: 'not_requested',
    requestId: 'line\nfeed'
  }), (error) => error.code === 'invalid_response');

  const malformed = createAndroidClient({
    baseUrl: 'https://android.example.test',
    credential: CREDENTIAL,
    fetch: async () => new Response(JSON.stringify({
      status: 'created',
      taskId: 'tsk_11111111-1111-4111-8111-111111111111'
    }), { status: 201 })
  });
  await assert.rejects(malformed.sendEvent({}), (error) => error.code === 'invalid_response');
});
