'use strict';

const os = require('node:os');
const path = require('node:path');
const { normalizeProfileId } = require('./config');

function isAbsolutePath(value) {
  return typeof value === 'string'
    && (path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}

function posixQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function serverHookCommand({ launcherPath, profileId }) {
  if (!isAbsolutePath(launcherPath)) throw new TypeError('launcherPath must be absolute');
  const stableProfileId = normalizeProfileId(profileId);
  return `${posixQuote(launcherPath)} hook --profile ${posixQuote(stableProfileId)}`;
}

function stableLauncherPath({ env = process.env, homeDir = os.homedir() } = {}) {
  const configured = typeof env.TO_KNOW_AGENT_LAUNCHER_PATH === 'string'
    ? env.TO_KNOW_AGENT_LAUNCHER_PATH.trim()
    : '';
  if (isAbsolutePath(configured)) return configured;
  return path.join(homeDir, '.local', 'bin', 'toknow-agent');
}

module.exports = {
  isAbsolutePath,
  posixQuote,
  serverHookCommand,
  stableLauncherPath
};
