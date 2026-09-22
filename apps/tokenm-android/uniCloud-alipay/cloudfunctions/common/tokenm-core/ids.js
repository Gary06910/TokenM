'use strict';

const { randomInt, randomUUID } = require('node:crypto');

const PREFIXES = Object.freeze({
  usageSnapshot: 'usg',
  desktop: 'dev',
  mobileDevice: 'mob',
  pairingSession: 'pair',
  rateLimit: 'rl',
  request: 'req',
  task: 'tsk'
});

function randomId(kind) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new TypeError('Unknown random identifier kind.');
  return `${prefix}_${randomUUID()}`;
}

function pairingCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function randomTombstone() {
  return `inactive:${randomUUID()}`;
}

module.exports = {
  pairingCode,
  randomId,
  randomTombstone
};
