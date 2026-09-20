'use strict';

const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readRegularFileNoFollow } = require('../shared/credentialStore');
const { codexAuthIdentity, codexOAuthRequestContext } = require('../shared/providers/codex/auth');

// Local-only source diagnostics. Neither this object nor paths enter provider rows.
function resolveCodexLimitsSource({ override = '', env = process.env, homedir = os.homedir(), platform = process.platform, read = readRegularFileNoFollow } = {}) {
  const paths = platform === 'win32' ? path.win32 : path;
  const mode = override ? 'manual' : 'auto';
  const candidates = override ? [override] : [env.CODEX_HOME, paths.join(homedir, '.codex'),
    env.USERPROFILE && paths.join(env.USERPROFILE, '.codex'), env.HOME && paths.join(env.HOME, '.codex')];
  const seen = new Set();
  const valid = [];
  let unreadable = false;
  for (const candidate of candidates.filter(Boolean)) {
    if (typeof candidate !== 'string' || !paths.isAbsolute(candidate)) { unreadable = true; continue; }
    const normalized = paths.normalize(candidate);
    const homePath = normalized.length > paths.parse(normalized).root.length
      ? normalized.replace(/[\\/]+$/, '') : normalized;
    const key = platform === 'win32' ? homePath.toLowerCase() : homePath;
    if (seen.has(key)) continue;
    seen.add(key);
    const authPath = paths.join(homePath, 'auth.json');
    try {
      const raw = read(authPath, { description: 'Codex limits source', encoding: 'utf8', maxBytes: 1024 * 1024 });
      const auth = JSON.parse(raw);
      if (!codexOAuthRequestContext(auth).accessToken) { unreadable = true; continue; }
      const identity = codexAuthIdentity(auth);
      const accountKey = identity.accountKey || `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
      // A credential change invalidates display data too, without persisting credentials.
      const bindingKey = crypto.createHash('sha256').update(key).update('\0').update(raw).digest('hex');
      valid.push({ homePath, authPath, accountKey, bindingKey });
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) unreadable = true;
    }
  }
  if (!valid.length) return { provider: 'codex', mode, status: override || unreadable ? 'INVALID' : 'NOT_FOUND' };
  if (new Set(valid.map((item) => item.accountKey)).size > 1) return { provider: 'codex', mode, status: 'AMBIGUOUS' };
  return { provider: 'codex', mode, status: 'OK', ...valid[0] };
}

function sourceErrorCode(error) {
  if (error?.status === 'unauthorized' || [401, 403].includes(error?.httpStatus)) return 'UNAUTHORIZED';
  if (error?.status === 'timeout' || /timeout|timed out/i.test(error?.message || '')) return 'TIMEOUT';
  if (error?.status === 'sourceRateLimited' || error?.httpStatus === 429) return 'RATE_LIMITED';
  if (error?.httpStatus >= 500) return 'UNAVAILABLE';
  if (/fetch|network|connect|ENOTFOUND|ECONN/i.test(`${error?.message || ''} ${error?.code || ''}`)) return 'NETWORK';
  return 'ERROR';
}

module.exports = { resolveCodexLimitsSource, sourceErrorCode };
