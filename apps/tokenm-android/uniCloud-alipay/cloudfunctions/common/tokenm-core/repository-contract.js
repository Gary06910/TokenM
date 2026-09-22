'use strict';

const COLLECTIONS = Object.freeze({
  usageSnapshots: 'tokenm-usage-snapshots',
  users: 'tokenm-users',
  desktops: 'tokenm-desktops',
  pairingSessions: 'tokenm-pairing-sessions',
  tasks: 'tokenm-tasks',
  mobileDevices: 'tokenm-mobile-devices',
  rateLimits: 'tokenm-rate-limits'
});

const IDENTITY_COLLECTIONS = Object.freeze({
  devices: 'uni-id-device'
});

const REQUIRED_METHODS = Object.freeze([
  'usageSnapshotCriteria',
  'taskHistoryCriteria',
  'countWhere',
  'findById',
  'findOne',
  'findMany',
  'insert',
  'updateById',
  'updateWhere',
  'removeById',
  'removeWhere',
  'runTransaction'
]);

function assertRepository(repository) {
  if (!repository || REQUIRED_METHODS.some((method) => typeof repository[method] !== 'function')) {
    throw new TypeError('To Know repository contract is incomplete.');
  }
  return repository;
}

module.exports = {
  COLLECTIONS,
  IDENTITY_COLLECTIONS,
  REQUIRED_METHODS,
  assertRepository
};
