'use strict';

const EXPECTED_VERSION = '4.0.2';
const PATCH_MARKER = 'TOKENM_DIAGNOSTIC_V2_WX_SERVER_SDK_4_0_2';

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`wx-server-sdk diagnostic V2 patch anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`wx-server-sdk diagnostic V2 patch anchor is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function verifyPatchedSource(source) {
  const required = [
    PATCH_MARKER,
    'tokenmBuildUpstreamEvidence',
    'tokenmAttachUpstreamEvidence',
    'upstreamEvidence: tokenmBuildUpstreamEvidence(err, tokenmStartedAt)',
    "tokenmBuildUpstreamEvidence(res, tokenmStartedAt, 'tcb_response_code')",
    "Object.prototype.hasOwnProperty.call(e, 'upstreamEvidence')"
  ];
  for (const marker of required) {
    if (!source.includes(marker)) throw new Error(`wx-server-sdk diagnostic V2 verification failed: ${marker}`);
  }
  return true;
}

function applyPatch(source, installedVersion) {
  if (installedVersion !== EXPECTED_VERSION) {
    throw new Error(`wx-server-sdk diagnostic V2 requires ${EXPECTED_VERSION}; found ${installedVersion || 'unknown'}`);
  }
  if (source.includes(PATCH_MARKER)) {
    verifyPatchedSource(source);
    return { source, changed: false };
  }

  let patched = source;
  patched = replaceExactlyOnce(
    patched,
    "const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));\nasync function callGeneralOpenAPI(method, options, config) {",
    `const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
// ${PATCH_MARKER}: preserve only allowlisted machine metadata before SDK normalization.
const tokenmTransportCodes = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
    'ECONNABORTED', 'ENETDOWN', 'EHOSTDOWN', 'ENETUNREACH', 'EHOSTUNREACH',
    'ESOCKETTIMEDOUT'
]);
const tokenmRequestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
function tokenmSafeRequestId(value) {
    return typeof value === 'string' && tokenmRequestIdPattern.test(value) ? value : null;
}
function tokenmElapsedBucket(startedAt) {
    const elapsed = Date.now() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0)
        return null;
    if (elapsed < 100)
        return '0_99';
    if (elapsed < 250)
        return '100_249';
    if (elapsed < 500)
        return '250_499';
    if (elapsed < 1000)
        return '500_999';
    if (elapsed < 2000)
        return '1000_1999';
    if (elapsed < 5000)
        return '2000_4999';
    return '5000_plus';
}
function tokenmBuildUpstreamEvidence(value, startedAt, forcedOriginKind) {
    const candidate = value && (typeof value === 'object' || typeof value === 'function') ? value : null;
    const code = candidate ? candidate.code : undefined;
    const status = candidate && Number.isSafeInteger(candidate.statusCode)
        ? candidate.statusCode
        : candidate && Number.isSafeInteger(candidate.status)
            ? candidate.status
            : Number.isSafeInteger(code) && code >= 100 && code <= 599
                ? code
                : null;
    const isHttpStatus = Number.isSafeInteger(status) && status >= 100 && status <= 599;
    const isTransport = typeof code === 'string' && tokenmTransportCodes.has(code);
    const isTcbCode = typeof code === 'string' && Object.prototype.hasOwnProperty.call(error_config_1.TCB_ERR_CODE, code);
    let originKind = forcedOriginKind || 'unknown';
    if (!forcedOriginKind) {
        if (isHttpStatus)
            originKind = 'http_status';
        else if (isTransport)
            originKind = 'transport_error';
        else if (isTcbCode)
            originKind = 'tcb_response_code';
    }
    const innerCodeSafe = Number.isSafeInteger(code) || isTransport || isTcbCode ? code : null;
    return {
        originKind,
        innerCodeSafe,
        upstreamRequestIdSafe: tokenmSafeRequestId(candidate && candidate.requestId),
        httpStatusSafe: isHttpStatus ? status : null,
        transportCodeSafe: isTransport ? code : null,
        sdkSeqIdSafe: null,
        elapsedMsBucket: tokenmElapsedBucket(startedAt)
    };
}
function tokenmAttachUpstreamEvidence(error, evidence) {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
        Object.defineProperty(error, 'upstreamEvidence', {
            value: evidence,
            enumerable: false,
            configurable: false,
            writable: false
        });
    }
    return error;
}
async function callGeneralOpenAPI(method, options, config) {`,
    'helper block'
  );

  patched = replaceExactlyOnce(
    patched,
    "    await sleep();\n    let res;",
    "    await sleep();\n    const tokenmStartedAt = Date.now();\n    let res;",
    'upstream timer'
  );

  patched = replaceExactlyOnce(
    patched,
    `    catch (err) {
        throw {
            errCode: (err && err.code && error_config_1.TCB_ERR_CODE[err.code]) || error_config_1.TCB_ERR_CODE.SYS_ERR,
            errMsg: (err && err.message) || err || 'empty error message',
        };
    }`,
    `    catch (err) {
        throw {
            errCode: (err && err.code && error_config_1.TCB_ERR_CODE[err.code]) || error_config_1.TCB_ERR_CODE.SYS_ERR,
            errMsg: (err && err.message) || err || 'empty error message',
            upstreamEvidence: tokenmBuildUpstreamEvidence(err, tokenmStartedAt),
        };
    }`,
    'pre-normalization catch'
  );

  patched = replaceExactlyOnce(
    patched,
    `            throw new error_1.CloudSDKError({
                errCode: error_config_1.TCB_ERR_CODE[res.code] || error_config_1.TCB_ERR_CODE.SYS_ERR,
                errMsg: msg_1.apiFailMsg(options.api, res.message)
            });`,
    `            throw tokenmAttachUpstreamEvidence(new error_1.CloudSDKError({
                errCode: error_config_1.TCB_ERR_CODE[res.code] || error_config_1.TCB_ERR_CODE.SYS_ERR,
                errMsg: msg_1.apiFailMsg(options.api, res.message)
            }), tokenmBuildUpstreamEvidence(res, tokenmStartedAt, 'tcb_response_code'));`,
    'structured TCB response'
  );

  patched = replaceExactlyOnce(
    patched,
    "        err.errMsg = err.message + '';\n        return err;",
    `        err.errMsg = err.message + '';
        if (e !== err && e && (typeof e === 'object' || typeof e === 'function') &&
            Object.prototype.hasOwnProperty.call(e, 'upstreamEvidence')) {
            Object.defineProperty(err, 'upstreamEvidence', {
                value: e.upstreamEvidence,
                enumerable: false,
                configurable: false,
                writable: false
            });
        }
        return err;`,
    'final SDK error transfer'
  );

  verifyPatchedSource(patched);
  return { source: patched, changed: true };
}

module.exports = {
  EXPECTED_VERSION,
  PATCH_MARKER,
  applyPatch,
  verifyPatchedSource
};
