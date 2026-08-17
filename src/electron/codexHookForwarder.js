'use strict';

const http = require('node:http');
const { readRegularFileNoFollow } = require('../shared/credentialStore');

const MAX_STDIN_BYTES = 64 * 1024;
const MAX_RUNTIME_BYTES = 8 * 1024;

function finish() {
  try { process.stdout.write('{}\n'); } catch (_) {}
}

function readBoundedStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) reject(new Error('stdin_too_large'));
      else chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

function readRuntime(filePath) {
  const value = JSON.parse(readRegularFileNoFollow(filePath, {
    description: 'Token M notification runtime',
    encoding: 'utf8',
    maxBytes: MAX_RUNTIME_BYTES,
    mode: 0o600
  }));
  if (value?.version !== 1 || value.host !== '127.0.0.1' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new Error('invalid_runtime');
  }
  if (typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error('invalid_runtime');
  return value;
}

function post(runtime, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: runtime.host,
      port: runtime.port,
      path: '/codex/stop',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-token-m-bridge-token': runtime.token
      },
      timeout: 1_500
    }, (response) => {
      response.resume();
      response.on('end', resolve);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

async function run() {
  const runtimePath = process.argv[2];
  if (!runtimePath) return;
  const [runtime, body] = await Promise.all([Promise.resolve().then(() => readRuntime(runtimePath)), readBoundedStdin()]);
  JSON.parse(body.toString('utf8'));
  await post(runtime, body);
}

if (require.main === module) {
  run().catch(() => {}).finally(finish);
}

module.exports = { post, readRuntime };
