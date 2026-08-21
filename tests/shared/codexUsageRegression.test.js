'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { collectUsageOnce, deriveClientStatus } = require('../../src/shared/collector');
const { installSourceEnvGuard } = require('../helpers/sourceEnv');

installSourceEnvGuard(test);

const CODEX_HOME_FIXTURE = path.join(__dirname, '..', 'fixtures', 'codex-home');

function stableUsage(summary) {
  return {
    today: summary.today.totalTokens,
    month: summary.month.totalTokens,
    allTime: summary.allTime.totalTokens,
    clients: summary.allTime.clients,
    sessions: Object.keys(summary.allTime.sessions).length
  };
}

async function scanFixture(homeDir = CODEX_HOME_FIXTURE) {
  return collectUsageOnce({
    clients: 'codex',
    allTimeSince: '2020-01-01',
    commandTimeoutMs: 30_000,
    deviceId: 'codex-fixture',
    homeDir,
    platform: 'linux',
    historyEnabled: false,
    projectsEnabled: false,
    now: new Date('2026-08-17T12:00:00.000Z')
  });
}

test('Codex usage scan aligns tokscale with the profile home and stays idempotent', async () => {
  // Reproduce the Windows failure: Node's profile home and the inherited HOME
  // point at different trees. collectUsageOnce must pass its profile home to
  // tokscale instead of letting the child silently scan this empty override.
  process.env.HOME = path.join(CODEX_HOME_FIXTURE, 'unrelated-home');

  const first = await scanFixture();
  const second = await scanFixture();

  // The nested live fixture uses the current cumulative total_token_usage
  // schema (250 tokens), contains one malformed JSONL line, and is duplicated
  // under archived_sessions. The legacy archived fixture carries only
  // last_token_usage (70 tokens). Neither the cumulative snapshots nor the
  // cross-root duplicate may be added more than once.
  // Tokscale's --today selector uses the host clock, while the injected clock
  // controls Token M's month/all-time window. The fixture is intentionally
  // dated in the past, so today is zero on a later host date; month/all-time
  // and idempotency are the regression contract.
  assert.deepEqual(stableUsage(first), {
    today: 0,
    month: 320,
    allTime: 320,
    clients: { codex: 320 },
    sessions: 2
  });
  assert.deepEqual(stableUsage(second), stableUsage(first));
  assert.ok(first.allTime.costUsd > 0);
});

test('an explicit CODEX_HOME remains authoritative over the aligned profile home', async () => {
  process.env.HOME = path.join(CODEX_HOME_FIXTURE, 'unrelated-environment-home');
  process.env.CODEX_HOME = path.join(CODEX_HOME_FIXTURE, '.codex');

  const result = await scanFixture(path.join(CODEX_HOME_FIXTURE, 'unrelated-profile-home'));
  assert.equal(result.allTime.totalTokens, 320);
  assert.deepEqual(result.allTime.clients, { codex: 320 });
});

test('an existing Codex source with no valid usage remains waiting at zero', () => {
  assert.deepEqual(
    deriveClientStatus('codex', { totalTokens: 0, clients: {} }, {
      sourceChecks: { codex: [{ id: 'codex-sessions', exists: true }] }
    }),
    { codex: 'waiting' }
  );
});
