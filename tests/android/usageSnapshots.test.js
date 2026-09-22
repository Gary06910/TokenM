'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const base = '../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/';
const { TokenMApplication, MemoryRepository, COLLECTIONS } = require(base + 'common/tokenm-core');
const { createHttpHandler } = require(base + 'tokenm-desktop-http/http-contract');
const { validateUsageSnapshot } = require(base + 'common/tokenm-core/usage-snapshot');
const { serializeServerSnapshot, validateServerSnapshot } = require('../../src/server-agent/snapshot');
const { createAndroidClient } = require('../../src/shared/notification/androidClient');
const { listAllRemoteUsageSnapshots } = require('../../src/shared/remoteUsage');

function snapshot(id = 'codex') {
  return serializeServerSnapshot({ updatedAt: '2026-09-22T00:00:00.000Z' }, { profile: { id, name: id }, platform: 'linux-x64', agentVersion: '1.0.0' }).snapshot;
}
async function fixture() {
  const repository = new MemoryRepository();
  let time = Date.parse('2026-09-22T10:00:00.000Z');
  const app = new TokenMApplication({ repository, credentialKey: randomBytes(32), now: () => time });
  async function pair(owner = 'alice', name = 'A800 Server') {
    await app.bootstrap(owner);
    const code = await app.createPairingCode(owner);
    return app.pair({ schemaVersion: 1, code: code.code, deviceName: name }, { rateSubject: 'client-ip:127.0.0.1' });
  }
  const source = await pair();
  const handler = createHttpHandler({ application: app });
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, ...options });
    const parsed = new URL(url);
    const response = await handler({ path: parsed.pathname, httpMethod: options.method, headers: options.headers, body: options.body,
      queryStringParameters: Object.fromEntries(parsed.searchParams) });
    return new Response(response.body, { status: response.statusCode, headers: response.headers });
  };
  const client = createAndroidClient({ baseUrl: 'https://example.test', credential: source.credential, fetch });
  return { repository, app, pair, source, client, calls, handler, setTime: (value) => { time = value; } };
}

test('cloud schema copy cannot drift from portable validator; permissions and compound indexes are frozen', () => {
  const root = path.resolve(__dirname, '../..');
  assert.equal(fs.readFileSync(path.join(root, 'src/shared/usageSnapshot.js'), 'utf8'), fs.readFileSync(path.join(root, 'apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core/usage-snapshot.js'), 'utf8'));
  const db = path.join(root, 'apps/tokenm-android/uniCloud-alipay/database');
  const schema = JSON.parse(fs.readFileSync(path.join(db, 'tokenm-usage-snapshots.schema.json')));
  assert.deepEqual(schema.permission, { read: false, create: false, update: false, delete: false, count: false });
  const indexes = JSON.parse(fs.readFileSync(path.join(db, 'tokenm-usage-snapshots.index.json')));
  assert.equal(indexes[0].MgoKeySchema.MgoIsUnique, true);
  assert.deepEqual(indexes[0].MgoKeySchema.MgoIndexKeys.map((k) => k.Name), ['desktopId', 'profileId']);
  assert.deepEqual(indexes[1].MgoKeySchema.MgoIndexKeys.map((k) => [k.Name, k.Direction]), [['ownerId', '1'], ['updatedAtMs', '-1'], ['_id', '-1']]);
});

for (const [name, mutate] of [
  ['schema', (s) => { s.schemaVersion = 2; }], ['profile', (s) => { s.profile.id = '../codex'; }],
  ['negative', (s) => { s.today.totalTokens = -1; }], ['infinite', (s) => { s.month.costUsd = Infinity; }],
  ['map key', (s) => { s.today.models['/private/path'] = 1; }],
  ['prototype', (s) => { s.today.models = JSON.parse('{"__proto__":1}'); }],
  ['unknown', (s) => { s.today.secretKey = 'secret'; }], ['array', (s) => { s.history = []; }],
  ['timestamp', (s) => { s.updatedAt = 'yesterday'; }], ['limits', (s) => { s.limits = {}; }],
  ['oversize', (s) => { for (let i = 0; i < 1000; i++) s.today.models['gpt-' + i] = i; }],
  ...'prompt reply response summary lastAssistantMessage cwd absoluteCwd absolutePath project projectPath sessions nativeSessions nativeProjects transcript auth accessToken refreshToken credential authorization cookie sshKey sourcePath'.split(' ').map((key) => [key, (s) => { s.today.clientModels.codex = { [key]: 1 }; }])
]) test('both snapshot boundaries reject ' + name, () => {
  const value = snapshot(); mutate(value);
  assert.throws(() => validateServerSnapshot(value));
  assert.throws(() => validateUsageSnapshot(value));
});

test('PUT/client round trip uses credential identity, latest row and backend clock', async () => {
  const f = await fixture(); const value = snapshot(); value.deviceName = 'spoof';
  for (let i = 0; i < 100; i++) await f.client.putUsageSnapshot(value);
  assert.equal(f.repository.snapshot(COLLECTIONS.usageSnapshots).length, 1);
  const row = f.repository.snapshot(COLLECTIONS.usageSnapshots)[0];
  assert.equal(row.desktopId, f.source.desktop.desktopId);
  assert.equal(row.updatedAtMs, Date.parse('2026-09-22T10:00:00.000Z'));
  const page = await f.client.listUsageSnapshots();
  assert.equal(page.items[0].source.name, 'A800 Server');
  assert.equal(page.items[0].receivedAt, '2026-09-22T10:00:00.000Z');
  assert.equal(JSON.stringify(page).includes('ownerId'), false);
  assert.equal(JSON.stringify(page).includes('encryptedSecret'), false);
  for (const field of ['ownerId', 'desktopId', 'credential', 'sourceName']) {
    await assert.rejects(f.app.putUsageSnapshot(f.source.credential, { snapshot: value, [field]: 'spoof' }), { code: 'invalid_request' });
  }
  await assert.rejects(f.app.putUsageSnapshot('', { snapshot: value }), { code: 'unauthenticated' });
  await f.app.unpairSelf(f.source.credential, { confirmation: 'UNPAIR' });
  await assert.rejects(f.app.putUsageSnapshot(f.source.credential, { snapshot: value }), { code: 'desktop_revoked' });
});

test('concurrent first inserts recover unique conflict and preserve separate profiles/sources', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 12 }, () => f.app.putUsageSnapshot(f.source.credential, { snapshot: snapshot() })));
  assert.equal(f.repository.snapshot(COLLECTIONS.usageSnapshots).length, 1);
  const first = f.repository.snapshot(COLLECTIONS.usageSnapshots)[0];
  await assert.rejects(f.repository.insert(COLLECTIONS.usageSnapshots, { ...first, _id: 'different' }), { name: 'RepositoryConflictError' });
  await f.app.putUsageSnapshot(f.source.credential, { snapshot: snapshot('codex-srj') });
  const second = await f.pair();
  await f.app.putUsageSnapshot(second.credential, { snapshot: snapshot() });
  assert.equal(f.repository.snapshot(COLLECTIONS.usageSnapshots).length, 3);
  assert.equal((await f.client.listUsageSnapshots()).items.length, 3);
});

for (const count of [0, 1, 4, 5, 9]) test('stable owner pagination: ' + count + ' rows, including tied timestamps', async () => {
  const f = await fixture();
  for (let i = 0; i < count; i++) await f.client.putUsageSnapshot(snapshot('profile-' + i));
  const all = await listAllRemoteUsageSnapshots(f.client);
  assert.equal(all.length, count);
  assert.equal(new Set(all.map((i) => i.profile.id)).size, count);
  let cursor; const sizes = [];
  do { const page = await f.client.listUsageSnapshots({ cursor }); sizes.push(page.items.length); cursor = page.nextCursor; } while (cursor);
  if (count === 9) assert.deepEqual(sizes, [4, 4, 1]);
  assert.deepEqual(all.map((i) => i.profile.id), f.repository.snapshot(COLLECTIONS.usageSnapshots).sort((a, b) => b.updatedAtMs - a.updatedAtMs || b._id.localeCompare(a._id)).map((r) => r.profileId));
});

test('owners stay isolated; current source name wins; defensive read hides orphan/revoked sources', async () => {
  const f = await fixture(); const bob = await f.pair('bob');
  await f.client.putUsageSnapshot(snapshot());
  await f.app.putUsageSnapshot(bob.credential, { snapshot: snapshot() });
  assert.equal((await f.client.listUsageSnapshots()).items.length, 1);
  assert.equal((await f.app.listUsageSnapshots(bob.credential)).items[0].source.desktopId, bob.desktop.desktopId);
  await assert.rejects(f.app.listUsageSnapshots(f.source.credential, { desktopId: bob.desktop.desktopId }), { code: 'invalid_request' });
  await f.repository.updateById(COLLECTIONS.desktops, f.source.desktop.desktopId, { name: 'Renamed' });
  assert.equal((await f.client.listUsageSnapshots()).items[0].source.name, 'Renamed');
  const reader = await f.pair();
  await f.repository.updateById(COLLECTIONS.desktops, f.source.desktop.desktopId, { status: 'revoked' });
  assert.deepEqual((await f.app.listUsageSnapshots(reader.credential)).items, []);
  await f.repository.removeById(COLLECTIONS.desktops, f.source.desktop.desktopId);
  assert.deepEqual((await f.app.listUsageSnapshots(reader.credential)).items, []);
});

for (const operation of ['unbindDesktop', 'unpairSelf', 'deleteAccount']) test(operation + ' cleans usage without touching another owner', async () => {
  const f = await fixture(); const bob = await f.pair('bob');
  await f.client.putUsageSnapshot(snapshot()); await f.client.putUsageSnapshot(snapshot('codex-srj'));
  await f.app.putUsageSnapshot(bob.credential, { snapshot: snapshot() });
  if (operation === 'unbindDesktop') await f.app.unbindDesktop('alice', { desktopId: f.source.desktop.desktopId, confirmation: 'UNBIND' });
  if (operation === 'unpairSelf') await f.app.unpairSelf(f.source.credential, { confirmation: 'UNPAIR' });
  if (operation === 'deleteAccount') await f.app.deleteAccount('alice', { confirmation: 'DELETE' });
  assert.deepEqual(f.repository.snapshot(COLLECTIONS.usageSnapshots).map((r) => r.ownerId), ['bob']);
});

test('HTTP limits, query errors and safe error responses', async () => {
  const f = await fixture();
  async function call(method, body, query, headers = {}) {
    return f.handler({ path: '/v1/desktop/usage', httpMethod: method, headers: { authorization: 'Bearer ' + f.source.credential, ...headers }, body, queryStringParameters: query });
  }
  assert.equal((await f.handler({ path: '/v1/desktop/usage', httpMethod: 'PUT' })).statusCode, 401);
  assert.equal((await call('DELETE')).statusCode, 405);
  assert.equal((await call('GET')).statusCode, 200);
  for (const cursor of ['!', 'a'.repeat(257), Buffer.from('{"updatedAtMs":1,"_id":"usg_bad","ownerId":"bob"}').toString('base64url')]) {
    assert.equal((await call('GET', undefined, { cursor })).statusCode, 422);
  }
  for (const query of [{ limit: '5' }, { limit: '0' }, { limit: '4x' }, { ownerId: 'bob' }]) assert.equal((await call('GET', undefined, query)).statusCode, 422);
  const headers = { 'content-type': 'application/json' };
  assert.equal((await call('PUT', 'x'.repeat(16385), undefined, headers)).statusCode, 413);
  const value = snapshot(); value.today.prompt = 'SENSITIVE_MARKER';
  const error = await call('PUT', JSON.stringify({ snapshot: value }), undefined, headers);
  assert.equal(error.statusCode, 422);
  assert.equal(error.body.includes('SENSITIVE_MARKER'), false);
  assert.deepEqual(Object.keys(JSON.parse(error.body)), ['error', 'requestId']);
  const large = snapshot(); for (let i = 0; i < 1000; i++) large.today.models['gpt-' + i] = i;
  assert.equal((await call('PUT', JSON.stringify({ snapshot: large }), undefined, headers)).statusCode, 422);
});

test('largest schema-1 snapshot and four-item envelope fit transport budgets', async () => {
  const f = await fixture(); const value = snapshot();
  let i = 0;
  while (Buffer.byteLength(JSON.stringify(value)) < 12250) value.today.models['gpt-' + i++] = 1;
  validateUsageSnapshot(value); validateServerSnapshot(value);
  for (const id of ['aa', 'bb', 'cc', 'dd']) { value.profile.id = id; await f.client.putUsageSnapshot(value); }
  const page = await f.client.listUsageSnapshots();
  assert.equal(page.items.length, 4);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 65536);
  for (const call of f.calls.filter((c) => c.method === 'PUT')) assert.ok(Buffer.byteLength(call.body) < 16384);
});

test('cloud adapter replaces snapshot objects and expresses owner-scoped tuple pagination', async () => {
  const { UniCloudRepository } = require(base + 'common/tokenm-core/repository-unicloud');
  const calls = [];
  const command = Object.fromEntries(['lt', 'set', 'and', 'or'].map((op) => [op, (...args) => ({ op, args })]));
  const query = {
    doc: () => query,
    get: async () => ({ data: [{ _id: 'row' }] }),
    update: async (patch) => { calls.push(patch); },
    where: (criteria) => { calls.push(criteria); return query; },
    orderBy: (field, direction) => { calls.push([field, direction]); return query; },
    limit: (value) => { calls.push(value); return query; }
  };
  const repo = new UniCloudRepository({ database: { command, collection: () => query } });
  const value = snapshot();
  await repo.updateById(COLLECTIONS.usageSnapshots, 'row', { snapshot: value });
  assert.deepEqual(calls.shift(), { snapshot: { op: 'set', args: [value] } });
  const cursor = { updatedAtMs: 100, _id: 'usg_test' };
  const criteria = repo.usageSnapshotCriteria('alice', cursor);
  assert.deepEqual(criteria, { op: 'and', args: [{ ownerId: 'alice' }, { op: 'or', args: [
    { updatedAtMs: { op: 'lt', args: [100] } }, { updatedAtMs: 100, _id: { op: 'lt', args: ['usg_test'] } }
  ] }] });
  await repo.findMany(COLLECTIONS.usageSnapshots, criteria, { sort: [{ field: 'updatedAtMs', direction: 'desc' }, { field: '_id', direction: 'desc' }], limit: 5 });
  assert.deepEqual(calls, [criteria, ['updatedAtMs', 'desc'], ['_id', 'desc'], 5]);
});

test('revocation during upload cannot resurrect source usage', async () => {
  const f = await fixture();
  const insert = f.repository.insert.bind(f.repository);
  f.repository.insert = async (collection, document) => {
    const result = await insert(collection, document);
    if (collection === COLLECTIONS.usageSnapshots) await f.app.unpairSelf(f.source.credential, { confirmation: 'UNPAIR' });
    return result;
  };
  await assert.rejects(f.client.putUsageSnapshot(snapshot()), { code: 'desktop_revoked' });
  assert.equal(f.repository.snapshot(COLLECTIONS.usageSnapshots).length, 0);
});
