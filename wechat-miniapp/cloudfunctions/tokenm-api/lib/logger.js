'use strict';

const ALLOWED = new Set([
  'requestId',
  'route',
  'code',
  'subjectId',
  'providerErrcode',
  'durationMs',
  'transition',
  'event',
  'classificationBranch',
  'providerAttemptId',
  'errorNameSafe'
]);

const PROVIDER_ERROR_PATHS = new Set([
  'top.errCode',
  'top.errcode',
  'top.code',
  'top.errMsg',
  'top.errmsg',
  'originalError.errCode',
  'originalError.errcode',
  'cause.errCode',
  'cause.errcode',
  'error.errCode',
  'error.errcode'
]);

const SAFE_TYPES = new Set(['undefined', 'boolean', 'number', 'bigint', 'string', 'symbol', 'function', 'object', 'null', 'array', 'inaccessible']);
const UPSTREAM_ORIGINS = new Set(['tcb_response_code', 'http_status', 'transport_error', 'decode_error', 'unexpected_response', 'unknown']);
const TRANSPORT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
  'ECONNABORTED', 'ENETDOWN', 'EHOSTDOWN', 'ENETUNREACH', 'EHOSTUNREACH',
  'ESOCKETTIMEDOUT'
]);
const ELAPSED_BUCKETS = new Set(['0_99', '100_249', '250_499', '500_999', '1000_1999', '2000_4999', '5000_plus']);
const MACHINE_CODE_RE = /^[A-Z][A-Z0-9_.:-]{0,63}$/u;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;

function safeProviderErrorShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const safe = {};
  for (const [path, descriptor] of Object.entries(value)) {
    if (!PROVIDER_ERROR_PATHS.has(path) || !descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) continue;
    const item = { present: descriptor.present === true };
    if (item.present && SAFE_TYPES.has(descriptor.type)) item.type = descriptor.type;
    if (item.present && descriptor.type === 'number') {
      item.safeInteger = descriptor.safeInteger === true;
      if (item.safeInteger && Number.isSafeInteger(descriptor.numericValue)) item.numericValue = descriptor.numericValue;
    }
    safe[path] = item;
  }
  return safe;
}

function safeUpstreamEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const originKind = UPSTREAM_ORIGINS.has(value.originKind) ? value.originKind : 'unknown';
  const innerCodeSafe = Number.isSafeInteger(value.innerCodeSafe) ||
    (typeof value.innerCodeSafe === 'string' && MACHINE_CODE_RE.test(value.innerCodeSafe))
    ? value.innerCodeSafe
    : null;
  const upstreamRequestIdSafe = typeof value.upstreamRequestIdSafe === 'string' && REQUEST_ID_RE.test(value.upstreamRequestIdSafe)
    ? value.upstreamRequestIdSafe
    : null;
  const httpStatusSafe = Number.isSafeInteger(value.httpStatusSafe) && value.httpStatusSafe >= 100 && value.httpStatusSafe <= 599
    ? value.httpStatusSafe
    : null;
  const transportCodeSafe = TRANSPORT_CODES.has(value.transportCodeSafe) ? value.transportCodeSafe : null;
  const elapsedMsBucket = ELAPSED_BUCKETS.has(value.elapsedMsBucket) ? value.elapsedMsBucket : null;
  return {
    originKind,
    innerCodeSafe,
    upstreamRequestIdSafe,
    httpStatusSafe,
    transportCodeSafe,
    sdkSeqIdSafe: null,
    elapsedMsBucket
  };
}

function createLogger(output = console) {
  function emit(level, fields) {
    const safe = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (ALLOWED.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
      if (key === 'outerCode' && Number.isSafeInteger(value)) safe.outerCode = value;
      if (key === 'providerErrorShape') {
        const shape = safeProviderErrorShape(value);
        if (shape) safe.providerErrorShape = shape;
      }
      if (key === 'upstreamEvidence') {
        const evidence = safeUpstreamEvidence(value);
        if (evidence) safe.upstreamEvidence = evidence;
      }
    }
    const writer = typeof output[level] === 'function' ? output[level].bind(output) : output.log.bind(output);
    writer(JSON.stringify(safe));
  }
  return {
    info: (fields) => emit('info', fields),
    warn: (fields) => emit('warn', fields),
    error: (fields) => emit('error', fields)
  };
}

module.exports = { createLogger };
