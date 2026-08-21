'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCodexHookBridge } = require('../../src/electron/codexHookBridge');

const helperPath = path.join(__dirname, '../../src/electron/codexHookForwarder.js');
const token = 'a'.repeat(43);

function stopInput(suffix) {
  return {
    session_id: `session-${suffix}`,
    cwd: 'C:\\Program Files (x86)\\Token M\\project',
    hook_event_name: 'Stop',
    turn_id: `turn-${suffix}`,
    stop_hook_active: false,
    last_assistant_message: 'completed'
  };
}

function runForwarder(runtimePath, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, runtimePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

function runtimeFixture(t, value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-forwarder-'));
  const runtimePath = path.join(root, 'token-m-notification-runtime.json');
  fs.writeFileSync(runtimePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  t.after(() => {
    fs.unlinkSync(runtimePath);
    fs.rmdirSync(root);
  });
  return runtimePath;
}

test('forwards valid Stop stdin to the authenticated Desktop loopback receiver', async (t) => {
  const received = [];
  const bridge = createCodexHookBridge({ token, onCompletion: async (input) => received.push(input) });
  t.after(() => bridge.stop());
  const address = await bridge.start();
  const runtimePath = runtimeFixture(t, { version: 1, host: address.host, port: address.port, token });
  const input = stopInput('valid');

  const result = await runForwarder(runtimePath, input);
  assert.deepEqual(result, { exitCode: 0, stdout: '{}\n', stderr: '' });
  assert.deepEqual(received, [input]);
});

test('reports a missing runtime descriptor with a non-zero exit and safe stderr', async () => {
  const runtimePath = path.join(os.tmpdir(), `token-m-missing-${process.pid}-${Date.now()}.json`);
  const result = await runForwarder(runtimePath, stopInput('missing'));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /stage=runtime-read code=ENOENT/);
  assert.match(result.stderr, /input_fields=.*hook_event_name.*turn_id/);
});

test('reports an unreachable local listener as ECONNREFUSED', async (t) => {
  const bridge = createCodexHookBridge({ token, onCompletion: async () => {} });
  const address = await bridge.start();
  await bridge.stop();
  const runtimePath = runtimeFixture(t, { version: 1, host: address.host, port: address.port, token });

  const result = await runForwarder(runtimePath, stopInput('refused'));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /stage=request code=ECONNREFUSED/);
});
