'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCodexLimitsSource, sourceErrorCode } = require('../../src/electron/codexLimitsSource');
const { createCodexLimitsSourceActions } = require('../../src/electron/codexLimitsSourceActions');
const auth = (id) => JSON.stringify({ tokens: { access_token: `secret-${id}`, account_id: id } });
function resolve(files, options = {}) {
  const reads = [];
  const result = resolveCodexLimitsSource({ platform: 'win32', homedir: 'C:\\User', env: {},
    read(file) { reads.push(file); if (!files[file.toLowerCase()]) throw Object.assign(new Error(), { code: 'ENOENT' }); return files[file.toLowerCase()]; }, ...options });
  return { result, reads };
}
test('Codex bounded discovery finds CODEX_HOME and falls back from missing env home', () => {
  assert.equal(resolve({ 'd:\\codex\\auth.json': auth('a') }, { env: { CODEX_HOME: 'D:\\codex' } }).result.homePath, 'D:\\codex');
  assert.equal(resolve({ 'c:\\user\\.codex\\auth.json': auth('a') }, { env: { CODEX_HOME: 'D:\\missing' } }).result.status, 'OK');
});
test('HOME and USERPROFILE divergence discovers valid auth and deduplicates Windows paths', () => {
  const options = { env: { HOME: 'D:\\home', USERPROFILE: 'E:\\profile', CODEX_HOME: 'D:\\HOME\\.codex\\' } };
  const { result, reads } = resolve({ 'd:\\home\\.codex\\auth.json': auth('a') }, options);
  assert.equal(result.status, 'OK');
  assert.equal(reads.filter((p) => p.toLowerCase() === 'd:\\home\\.codex\\auth.json').length, 1);
  assert.ok(reads.length <= 5);
  assert.equal(resolve({ 'e:\\profile\\.codex\\auth.json': auth('a') }, options).result.status, 'OK');
});
test('multiple different accounts require selection; same account candidates are deterministic', () => {
  const files = { 'd:\\codex\\auth.json': auth('a'), 'c:\\user\\.codex\\auth.json': auth('b') };
  assert.equal(resolve(files, { env: { CODEX_HOME: 'D:\\codex' } }).result.status, 'AMBIGUOUS');
  files['c:\\user\\.codex\\auth.json'] = auth('a');
  assert.equal(resolve(files, { env: { CODEX_HOME: 'D:\\codex' } }).result.homePath, 'D:\\codex');
});
test('missing, invalid JSON, missing token and manual invalid source are actionable', () => {
  assert.equal(resolve({}).result.status, 'NOT_FOUND');
  for (const value of ['{', '{}', JSON.stringify({ OPENAI_API_KEY: 'not-oauth' })]) {
    assert.equal(resolve({ 'c:\\user\\.codex\\auth.json': value }).result.status, 'INVALID');
  }
  assert.equal(resolve({}, { override: 'C:\\wrong\\auth.json' }).result.status, 'INVALID');
  assert.equal(resolve({}, { read: () => { throw Object.assign(new Error(), { code: 'EACCES' }); } }).result.status, 'INVALID');
});
test('manual source wins and clearing it restores automatic discovery', () => {
  const files = { 'd:\\manual\\auth.json': auth('a'), 'c:\\user\\.codex\\auth.json': auth('b') };
  assert.equal(resolve(files, { override: 'D:\\manual' }).result.mode, 'manual');
  assert.equal(resolve(files, { override: '' }).result.homePath, 'C:\\User\\.codex');
});
test('source errors distinguish auth, network, timeout and service throttling', () => {
  assert.equal(sourceErrorCode({ httpStatus: 401 }), 'UNAUTHORIZED');
  assert.equal(sourceErrorCode({ message: 'fetch failed' }), 'NETWORK');
  assert.equal(sourceErrorCode({ message: 'request timed out' }), 'TIMEOUT');
  assert.equal(sourceErrorCode({ httpStatus: 429 }), 'RATE_LIMITED');
  assert.equal(sourceErrorCode({ httpStatus: 503 }), 'UNAVAILABLE');
  assert.equal(sourceErrorCode({}), 'ERROR');
});
test('source selection persists only path, invalidates display and requests immediate refresh', async () => {
  const settings = { codexHomeOverride: '' };
  const calls = [];
  const change = createCodexLimitsSourceActions({ getSettings: () => settings,
    save: () => calls.push('save'),
    presentation: { resolve: () => ({ status: settings.codexHomeOverride === 'bad' ? 'INVALID' : 'OK' }), clear: () => calls.push('clear'), snapshot: () => ({ providers: [] }) },
    reconfigure: () => calls.push('reconfigure'), refresh: () => { calls.push('refresh'); return new Promise(() => {}); } });
  assert.equal((await change('D:\\codex')).ok, true);
  assert.deepEqual(calls, ['save', 'clear', 'reconfigure', 'refresh']);
  assert.deepEqual(settings, { codexHomeOverride: 'D:\\codex' });
  assert.equal((await change('bad')).error, 'INVALID');
  assert.equal(settings.codexHomeOverride, 'D:\\codex');
  await change('');
  assert.equal(settings.codexHomeOverride, '');
});

test('source directory must be a readable regular JSON file, not just an existing directory', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-source-'));
  const authPath = path.join(dir, 'auth.json');
  fs.mkdirSync(authPath);
  t.after(() => { fs.rmdirSync(authPath); fs.rmdirSync(dir); });
  assert.equal(resolveCodexLimitsSource({ override: dir }).status, 'INVALID');
});
