'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createCodexHookBridge } = require('../../src/electron/codexHookBridge');

const token = '0123456789abcdef0123456789abcdef';

test('accepts authenticated loopback Stop input and rejects browser-style requests', async (t) => {
  const received = [];
  const bridge = createCodexHookBridge({ token, onCompletion: async (input) => received.push(input) });
  t.after(() => bridge.stop());
  const address = await bridge.start();
  assert.equal(address.host, '127.0.0.1');
  const url = `http://${address.host}:${address.port}/codex/stop`;

  const unauthorized = await fetch(url, { method: 'POST', body: '{}' });
  assert.equal(unauthorized.status, 401);
  const accepted = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token-m-bridge-token': token },
    body: JSON.stringify({ hook_event_name: 'Stop', session_id: 'thr_1', turn_id: 'turn_1' })
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {});
  assert.equal(received.length, 1);
});

test('refuses non-loopback bridge bindings', () => {
  assert.throws(() => createCodexHookBridge({
    host: '0.0.0.0', token, onCompletion() {}
  }), /127\.0\.0\.1/);
});
