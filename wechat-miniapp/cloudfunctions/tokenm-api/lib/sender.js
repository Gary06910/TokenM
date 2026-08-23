'use strict';

const { AppError } = require('./errors');
const { CONTROL_RE } = require('./security');

const TYPE_LIMITS = {
  thing: 20,
  phrase: 5,
  name: 10,
  character_string: 32,
  number: 32,
  date: 10,
  time: 20
};

function cleanTemplateValue(value, type) {
  let text = String(value ?? '');
  if (CONTROL_RE.test(text)) throw new AppError('provider_rejected');
  text = text.trim();
  if (!text) text = type === 'phrase' ? '已完成' : '任务完成';
  const limit = TYPE_LIMITS[type];
  if (!limit) throw new AppError('configuration_required');
  return [...text].slice(0, limit).join('');
}

function sourceValues({ task, desktop }) {
  const date = new Date(task.occurredAt);
  return {
    completion: task.privacyMode ? 'Codex 任务已完成' : (task.summary || task.project || 'Codex 任务已完成'),
    completedAt: Number.isNaN(date.getTime()) ? '' : date.toISOString().replace('T', ' ').slice(0, 19),
    desktopName: desktop.name,
    status: '已完成',
    project: task.privacyMode ? '隐私任务' : (task.project || '未命名项目'),
    model: task.privacyMode ? '未上传' : (task.model || '未提供')
  };
}

function buildTemplateData(config, context) {
  const values = sourceValues(context);
  const data = {};
  for (const [source, descriptor] of Object.entries(config.templateKeywords)) {
    data[descriptor.key] = { value: cleanTemplateValue(values[source], descriptor.type) };
  }
  return data;
}

function createWechatSender(cloud, config) {
  return {
    async send({ openid, task, desktop }) {
      return cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: config.templateId,
        page: `/pages/task-detail/index?taskId=${encodeURIComponent(task._id)}`,
        data: buildTemplateData(config, { task, desktop }),
        miniprogramState: config.miniprogramState,
        lang: config.lang
      });
    }
  };
}

function classifyProviderResult(result) {
  const rawCode = result?.errcode ?? result?.errCode;
  if (typeof rawCode !== 'number') return { status: 'unknown', errcode: null, errmsgCode: 'malformed_response' };
  if (rawCode === 0) return { status: 'sent', errcode: 0, errmsgCode: null };
  const code = Number.isSafeInteger(rawCode) ? rawCode : null;
  return { status: 'failed', errcode: code, errmsgCode: code === null ? 'provider_rejected' : `wechat_${code}` };
}

function classifyProviderError(error) {
  const rawCode = error?.errCode ?? error?.errcode;
  const fallbackCode = error?.code;
  const hasProviderMessage = typeof error?.errMsg === 'string' || typeof error?.errmsg === 'string';
  const candidate = rawCode !== undefined ? rawCode : (hasProviderMessage ? fallbackCode : undefined);
  if (!Number.isSafeInteger(candidate)) return { status: 'unknown', errcode: null, errmsgCode: 'provider_call_uncertain' };
  // wx-server-sdk uses negative values for CloudBase/TCB and WeChat cloud-call
  // system envelopes. A thrown outer/system code does not prove whether the
  // provider accepted or rejected the message, so settlement must stay open.
  if (candidate < 0) {
    return {
      status: 'unknown',
      errcode: null,
      errmsgCode: 'provider_call_uncertain',
      classificationBranch: 'sdk_outer_uncertain',
      outerCode: candidate
    };
  }
  return { status: 'failed', errcode: candidate, errmsgCode: `wechat_${candidate}` };
}

const DIAGNOSTIC_PATHS = Object.freeze([
  ['top.errCode', null, 'errCode'],
  ['top.errcode', null, 'errcode'],
  ['top.code', null, 'code'],
  ['top.errMsg', null, 'errMsg'],
  ['top.errmsg', null, 'errmsg'],
  ['originalError.errCode', 'originalError', 'errCode'],
  ['originalError.errcode', 'originalError', 'errcode'],
  ['cause.errCode', 'cause', 'errCode'],
  ['cause.errcode', 'cause', 'errcode'],
  ['error.errCode', 'error', 'errCode'],
  ['error.errcode', 'error', 'errcode']
]);

const UPSTREAM_ORIGIN_KINDS = new Set([
  'tcb_response_code',
  'http_status',
  'transport_error',
  'decode_error',
  'unexpected_response',
  'unknown'
]);
const UPSTREAM_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNABORTED',
  'ENETDOWN',
  'EHOSTDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ESOCKETTIMEDOUT'
]);
const UPSTREAM_ELAPSED_BUCKETS = new Set([
  '0_99',
  '100_249',
  '250_499',
  '500_999',
  '1000_1999',
  '2000_4999',
  '5000_plus'
]);
const MACHINE_CODE_RE = /^[A-Z][A-Z0-9_.:-]{0,63}$/u;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;

function safeRead(target, key) {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) return { present: false };
  try {
    if (!Reflect.has(target, key)) return { present: false };
    return { present: true, value: Reflect.get(target, key) };
  } catch {
    return { present: true, inaccessible: true };
  }
}

function safeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function safeErrorName(error) {
  const direct = safeRead(error, 'name');
  const constructor = safeRead(error, 'constructor');
  const constructorName = constructor.present && !constructor.inaccessible
    ? safeRead(constructor.value, 'name')
    : { present: false };
  const candidate = direct.present && !direct.inaccessible && typeof direct.value === 'string'
    ? direct.value
    : constructorName.present && !constructorName.inaccessible && typeof constructorName.value === 'string'
      ? constructorName.value
      : '';
  return /^[A-Za-z][A-Za-z0-9_$.-]{0,63}$/u.test(candidate) ? candidate : 'UnknownError';
}

function safeUpstreamEvidence(error) {
  const evidenceRead = safeRead(error, 'upstreamEvidence');
  if (!evidenceRead.present || evidenceRead.inaccessible) return null;
  const evidence = evidenceRead.value;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;

  const read = (key) => {
    const result = safeRead(evidence, key);
    return result.present && !result.inaccessible ? result.value : undefined;
  };
  const originKind = read('originKind');
  const innerCode = read('innerCodeSafe');
  const requestId = read('upstreamRequestIdSafe');
  const httpStatus = read('httpStatusSafe');
  const transportCode = read('transportCodeSafe');
  const elapsedBucket = read('elapsedMsBucket');

  return {
    originKind: UPSTREAM_ORIGIN_KINDS.has(originKind) ? originKind : 'unknown',
    innerCodeSafe: Number.isSafeInteger(innerCode) || (typeof innerCode === 'string' && MACHINE_CODE_RE.test(innerCode))
      ? innerCode
      : null,
    upstreamRequestIdSafe: typeof requestId === 'string' && REQUEST_ID_RE.test(requestId) ? requestId : null,
    httpStatusSafe: Number.isSafeInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    transportCodeSafe: UPSTREAM_TRANSPORT_CODES.has(transportCode) ? transportCode : null,
    sdkSeqIdSafe: null,
    elapsedMsBucket: UPSTREAM_ELAPSED_BUCKETS.has(elapsedBucket) ? elapsedBucket : null
  };
}

function describeProviderError(error) {
  const fields = {};
  for (const [path, parentKey, key] of DIAGNOSTIC_PATHS) {
    const parentRead = parentKey === null ? { present: true, value: error } : safeRead(error, parentKey);
    const fieldRead = parentRead.present && !parentRead.inaccessible
      ? safeRead(parentRead.value, key)
      : { present: false };
    const descriptor = { present: fieldRead.present === true };
    if (fieldRead.present) {
      if (fieldRead.inaccessible) {
        descriptor.type = 'inaccessible';
      } else {
        descriptor.type = safeType(fieldRead.value);
        if (typeof fieldRead.value === 'number') {
          descriptor.safeInteger = Number.isSafeInteger(fieldRead.value);
          if (descriptor.safeInteger) descriptor.numericValue = fieldRead.value;
        }
      }
    }
    fields[path] = descriptor;
  }
  return { errorNameSafe: safeErrorName(error), fields, upstreamEvidence: safeUpstreamEvidence(error) };
}

module.exports = {
  buildTemplateData,
  classifyProviderError,
  classifyProviderResult,
  createWechatSender,
  describeProviderError
};
