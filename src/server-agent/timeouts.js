'use strict';

const DEFAULT_START_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const SNAPSHOT_TIMEOUT_GRACE_MS = 30_000;
// Node's timer implementation clamps larger values, so reject them rather
// than silently turning a configured timeout into a different budget.
const MAX_TIMEOUT_MS = 2_147_483_647;

function parseTimeout(value) {
  let number;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) number = Number(value.trim());
  else return null;
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_TIMEOUT_MS ? number : null;
}

function resolveTimeout(value, fallback) {
  return parseTimeout(value) ?? fallback;
}

function resolveCommandTimeout(explicitValue, environmentValue) {
  return parseTimeout(explicitValue)
    ?? parseTimeout(environmentValue)
    ?? DEFAULT_COMMAND_TIMEOUT_MS;
}

function resolveSnapshotTimeout(explicitValue, effectiveCommandTimeoutMs) {
  const explicitTimeout = parseTimeout(explicitValue);
  if (explicitTimeout !== null) return explicitTimeout;
  return Math.min(MAX_TIMEOUT_MS, effectiveCommandTimeoutMs + SNAPSHOT_TIMEOUT_GRACE_MS);
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_START_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  SNAPSHOT_TIMEOUT_GRACE_MS,
  parseTimeout,
  resolveCommandTimeout,
  resolveSnapshotTimeout,
  resolveTimeout
};
