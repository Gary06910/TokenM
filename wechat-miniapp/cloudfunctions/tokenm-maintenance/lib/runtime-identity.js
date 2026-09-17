'use strict';

function nonEmptyPlatformString(value) {
  return typeof value === 'string' && value.length > 0;
}

function detectRuntimeIdentity({ getWXContext, runtimeEnv }) {
  let context = {};
  try {
    context = typeof getWXContext === 'function' ? (getWXContext() || {}) : {};
  } catch {
    context = {};
  }

  const env = runtimeEnv && typeof runtimeEnv === 'object' ? runtimeEnv : {};
  const rawCandidates = [context.ENV, env.TCB_ENV, env.SCF_NAMESPACE];
  const invalidSource = rawCandidates.some((value) => value !== undefined && value !== null && value !== '' && typeof value !== 'string');
  const candidates = rawCandidates.filter(nonEmptyPlatformString);
  const distinct = new Set(candidates);

  return {
    envId: !invalidSource && distinct.size === 1 ? candidates[0] : null,
    identityConflict: invalidSource || distinct.size > 1,
    openid: context.OPENID,
    appId: context.APPID
  };
}

module.exports = { detectRuntimeIdentity };
