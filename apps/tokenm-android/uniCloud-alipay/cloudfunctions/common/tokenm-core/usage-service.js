'use strict';

const { COLLECTIONS } = require('./repository-contract');
const { AppError, RepositoryConflictError, invalidRequest } = require('./errors');
const { randomId } = require('./ids');
const { assertExactObject } = require('./validation');
const { validateUsageSnapshot } = require('./usage-snapshot');
const DEFAULT_USAGE_PAGE_LIMIT = 4;
const MAX_USAGE_PAGE_LIMIT = 4;
const SORT = [{ field: 'updatedAtMs', direction: 'desc' }, { field: '_id', direction: 'desc' }];

function decodeCursor(value) {
  if (value === undefined) return null;
  try {
    if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const raw = Buffer.from(value, 'base64url');
    if (raw.toString('base64url') !== value) throw Error();
    const cursor = JSON.parse(raw.toString('utf8'));
    assertExactObject(cursor, ['updatedAtMs', '_id']);
    if (!Number.isSafeInteger(cursor.updatedAtMs) || cursor.updatedAtMs < 0 || cursor.updatedAtMs > 8640000000000000
      || typeof cursor._id !== 'string' || !/^usg_[0-9a-f-]{36}$/.test(cursor._id)) throw Error();
    return cursor;
  } catch (_) { throw invalidRequest('cursor'); }
}
function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ updatedAtMs: row.updatedAtMs, _id: row._id })).toString('base64url');
}
async function putUsageSnapshot(app, credential, input) {
  const desktop = await app.authenticateDesktop(credential);
  assertExactObject(input, ['snapshot']);
  try { validateUsageSnapshot(input.snapshot); } catch (_) { throw invalidRequest('snapshot'); }
  const snapshot = structuredClone(input.snapshot);
  const repository = app.repository;
  const identity = { desktopId: desktop._id, profileId: snapshot.profile.id };
  const now = app.now();
  const patch = { ownerId: desktop.ownerId, ...identity, profileName: snapshot.profile.name,
    snapshotSchemaVersion: 1, snapshot, updatedAtMs: now, receivedAtMs: now };
  const existing = await repository.findOne(COLLECTIONS.usageSnapshots, identity);
  if (existing) await repository.updateById(COLLECTIONS.usageSnapshots, existing._id, patch);
  else {
    try {
      await repository.insert(COLLECTIONS.usageSnapshots, { _id: randomId('usageSnapshot'), ...patch, createdAtMs: now });
    } catch (error) {
      if (!(error instanceof RepositoryConflictError)) throw error;
      const winner = await repository.findOne(COLLECTIONS.usageSnapshots, identity);
      if (!winner) throw error;
      await repository.updateById(COLLECTIONS.usageSnapshots, winner._id, patch);
    }
  }
  // A concurrent revocation/account deletion must not leave a late upload active.
  const current = await repository.findById(COLLECTIONS.desktops, desktop._id);
  if (!current || current.status !== 'active' || current.ownerId !== desktop.ownerId) {
    await repository.removeWhere(COLLECTIONS.usageSnapshots, identity);
    throw new AppError('desktop_revoked');
  }
  return { status: 'stored', profileId: snapshot.profile.id, receivedAt: new Date(now).toISOString() };
}
async function listUsageSnapshots(app, credential, input = {}) {
  const caller = await app.authenticateDesktop(credential);
  assertExactObject(input, ['limit', 'cursor']);
  const limit = input.limit === undefined ? DEFAULT_USAGE_PAGE_LIMIT : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_USAGE_PAGE_LIMIT) throw invalidRequest('limit');
  const cursor = decodeCursor(input.cursor);
  // Scan at most one bounded page. Filtered legacy rows may produce an empty
  // page with a cursor; consumers continue until nextCursor is null.
  const rows = await app.repository.findMany(COLLECTIONS.usageSnapshots,
    app.repository.usageSnapshotCriteria(caller.ownerId, cursor), { sort: SORT, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const items = [];
  for (const row of page) {
    const source = await app.repository.findById(COLLECTIONS.desktops, row.desktopId);
    if (!source || source.status !== 'active' || source.ownerId !== caller.ownerId) continue;
    try { validateUsageSnapshot(row.snapshot); } catch (_) { continue; }
    if (row.profileId !== row.snapshot.profile.id) continue;
    items.push({ source: { desktopId: source._id, name: source.name },
      profile: { ...row.snapshot.profile }, receivedAt: new Date(row.updatedAtMs).toISOString(), snapshot: row.snapshot });
  }
  return { items, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}
module.exports = { DEFAULT_USAGE_PAGE_LIMIT, MAX_USAGE_PAGE_LIMIT, decodeCursor, putUsageSnapshot, listUsageSnapshots };
