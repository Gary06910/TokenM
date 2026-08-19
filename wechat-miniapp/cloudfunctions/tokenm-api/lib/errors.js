'use strict';

const DEFAULTS = {
  configuration_required: ['服务配置尚未完成', false, 503],
  unauthenticated: ['身份验证失败', false, 401],
  unauthorized: ['无权执行此操作', false, 403],
  rate_limited: ['请求过于频繁，请稍后重试', true, 429],
  invalid_request: ['请求格式不正确', false, 400],
  body_too_large: ['请求内容过大', false, 413],
  pairing_invalid: ['配对码无效或已过期', false, 404],
  desktop_revoked: ['电脑已解绑', false, 401],
  event_conflict: ['事件标识已被其他内容使用', false, 409],
  privacy_payload_rejected: ['任务内容不符合隐私规则', false, 422],
  task_not_found: ['任务不存在', false, 404],
  grant_intent_expired: ['授权请求已过期', false, 409],
  grant_intent_used: ['授权请求已使用', false, 409],
  provider_rejected: ['微信消息发送失败', false, 502],
  provider_unknown: ['微信消息发送结果待确认', true, 503],
  cleanup_pending: ['数据清理仍在进行', true, 202],
  internal_error: ['服务暂时不可用', true, 500]
};

class AppError extends Error {
  constructor(code, options = {}) {
    const fallback = DEFAULTS[code] || DEFAULTS.internal_error;
    super(options.message || fallback[0]);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? fallback[1];
    this.httpStatus = options.httpStatus ?? fallback[2];
  }
}

function errorEnvelope(error, requestId) {
  const safe = error instanceof AppError ? error : new AppError('internal_error');
  return {
    ok: false,
    error: {
      code: safe.code,
      message: safe.message,
      retryable: safe.retryable
    },
    requestId
  };
}

module.exports = { AppError, errorEnvelope };
