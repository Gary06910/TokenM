'use strict';

const { AppError, errorEnvelope } = require('./errors');
const { assertExactKeys, assertRequestId, requestId: generateRequestId } = require('./security');

const MINI_SCHEMAS = {
  bootstrap: { allowed: ['action', 'requestId'], required: ['action', 'requestId'] },
  getDashboard: { allowed: ['action', 'requestId'], required: ['action', 'requestId'] },
  listTasks: { allowed: ['action', 'requestId', 'cursor', 'limit'], required: ['action', 'requestId'] },
  getTask: { allowed: ['action', 'requestId', 'taskId'], required: ['action', 'requestId', 'taskId'] },
  listDesktops: { allowed: ['action', 'requestId'], required: ['action', 'requestId'] },
  createPairingCode: { allowed: ['action', 'requestId'], required: ['action', 'requestId'] },
  renameDesktop: { allowed: ['action', 'requestId', 'desktopId', 'name'], required: ['action', 'requestId', 'desktopId', 'name'] },
  unbindDesktop: { allowed: ['action', 'requestId', 'desktopId', 'confirmation'], required: ['action', 'requestId', 'desktopId', 'confirmation'] },
  prepareSubscriptionGrant: { allowed: ['action', 'requestId'], required: ['action', 'requestId'] },
  recordSubscriptionOutcome: { allowed: ['action', 'requestId', 'grantIntentId', 'result'], required: ['action', 'requestId', 'grantIntentId', 'result'] },
  updateSettings: { allowed: ['action', 'requestId', 'notificationsEnabled'], required: ['action', 'requestId', 'notificationsEnabled'] },
  clearTaskHistory: { allowed: ['action', 'requestId', 'confirmation'], required: ['action', 'requestId', 'confirmation'] },
  deleteAccount: { allowed: ['action', 'requestId', 'confirmation'], required: ['action', 'requestId', 'confirmation'] }
};

const MINI_PLATFORM_EVENT_FIELDS = new Set(['tcbContext', 'userInfo']);

function stripMiniPlatformFields(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  const proto = Object.getPrototypeOf(event);
  if (proto !== Object.prototype && proto !== null) return event;
  return Object.fromEntries(Object.entries(event).filter(([key]) => !MINI_PLATFORM_EVENT_FIELDS.has(key)));
}

function lowerHeaders(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) result[String(key).toLowerCase()] = Array.isArray(value) ? value[0] : String(value);
  return result;
}

function bearer(headers) {
  const value = headers.authorization;
  if (typeof value !== 'string') throw new AppError('unauthenticated');
  const match = /^Bearer ([^\s]+)$/u.exec(value);
  if (!match) throw new AppError('unauthenticated');
  return match[1];
}

function parseJsonBody(event, headers) {
  const type = (headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new AppError('invalid_request');
  let raw;
  if (event.isBase64Encoded) {
    if (typeof event.body !== 'string') throw new AppError('invalid_request');
    raw = Buffer.from(event.body, 'base64');
  } else if (typeof event.body === 'string') {
    raw = Buffer.from(event.body, 'utf8');
  } else if (event.body && typeof event.body === 'object') {
    raw = Buffer.from(JSON.stringify(event.body), 'utf8');
  } else {
    throw new AppError('invalid_request');
  }
  if (raw.length > 16 * 1024) throw new AppError('body_too_large');
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new AppError('invalid_request');
  }
}

function gatewayResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    isBase64Encoded: false,
    body: JSON.stringify(payload)
  };
}

function normalizeGatewayPath(value) {
  const path = String(value || '');

  if (
    path === '/pair'
    || path === '/status'
    || path === '/events'
    || path === '/unpair-self'
  ) {
    return `/v1/desktop${path}`;
  }

  return path;
}

function gatewayDetails(event) {
  return {
    method: String(event.httpMethod || event.requestContext?.http?.method || '').toUpperCase(),
    path: normalizeGatewayPath(
  event.path || event.rawPath || event.requestContext?.http?.path || ''
),
    headers: lowerHeaders(event.headers),
    ip: String(event.requestContext?.http?.sourceIp || event.requestContext?.sourceIp || event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || 'unknown').split(',')[0].trim(),
    userAgent: String(event.requestContext?.http?.userAgent || event.headers?.['user-agent'] || event.headers?.['User-Agent'] || '').slice(0, 160)
  };
}

function isHttpEvent(event) {
  return Boolean(event && (event.httpMethod || event.rawPath || event.requestContext?.http));
}

function createApplication({ service, logger = { info() {}, warn() {}, error() {} }, randomBytes }) {
  async function invokeMini(event, identity) {
    const payload = stripMiniPlatformFields(event);
    let reqId = typeof payload?.requestId === 'string' ? payload.requestId : generateRequestId(randomBytes);
    try {
      if (!payload || typeof payload.action !== 'string' || !MINI_SCHEMAS[payload.action]) throw new AppError('invalid_request');
      const schema = MINI_SCHEMAS[payload.action];
      assertExactKeys(payload, schema.allowed, schema.required);
      reqId = assertRequestId(payload.requestId);
      let result;
      switch (payload.action) {
        case 'bootstrap': result = await service.bootstrap(identity); break;
        case 'getDashboard': result = await service.getDashboard(identity); break;
        case 'listTasks': result = await service.listTasks(identity, { cursor: payload.cursor, limit: payload.limit ?? 20 }); break;
        case 'getTask': result = await service.getTask(identity, payload.taskId); break;
        case 'listDesktops': result = await service.listDesktops(identity); break;
        case 'createPairingCode': result = await service.createPairingCode(identity, reqId); break;
        case 'renameDesktop': result = await service.renameDesktop(identity, payload.desktopId, payload.name); break;
        case 'unbindDesktop':
          if (payload.confirmation !== 'UNBIND') throw new AppError('invalid_request');
          result = await service.revokeDesktopByOwner(identity, payload.desktopId, reqId);
          break;
        case 'prepareSubscriptionGrant': result = await service.prepareSubscriptionGrant(identity, reqId); break;
        case 'recordSubscriptionOutcome': result = await service.recordSubscriptionOutcome(identity, payload.grantIntentId, payload.result, reqId); break;
        case 'updateSettings': result = await service.updateSettings(identity, payload.notificationsEnabled); break;
        case 'clearTaskHistory':
          if (payload.confirmation !== 'CLEAR') throw new AppError('invalid_request');
          result = await service.clearTaskHistory(identity);
          break;
        case 'deleteAccount':
          if (payload.confirmation !== 'DELETE') throw new AppError('invalid_request');
          result = await service.deleteAccount(identity, reqId);
          break;
        default: throw new AppError('invalid_request');
      }
      return { ok: true, ...result, requestId: reqId };
    } catch (error) {
      logger.warn({ requestId: reqId, route: payload?.action || 'mini_unknown', code: error.code || 'internal_error' });
      return errorEnvelope(error, reqId);
    }
  }

  async function invokeHttp(event) {
    const details = gatewayDetails(event);
    const candidate = details.headers['x-request-id'];
    const reqId = /^req_[A-Za-z0-9_-]{16,43}$/u.test(candidate || '') ? candidate : generateRequestId(randomBytes);
    try {
      let result;
      let statusCode = 200;
      if (details.method === 'POST' && details.path === '/v1/desktop/pair') {
        const body = parseJsonBody(event, details.headers);
        assertExactKeys(body, ['schemaVersion', 'code', 'deviceName'], ['schemaVersion', 'code', 'deviceName']);
        if (body.schemaVersion !== 1) throw new AppError('invalid_request');
        result = await service.claimPairing({ code: body.code, deviceName: body.deviceName, networkSubject: `${details.ip}|${details.userAgent}`, requestId: reqId });
        statusCode = 201;
        result = { status: 'paired', ...result };
      } else if (details.method === 'GET' && details.path === '/v1/desktop/status') {
        result = { ok: true, ...(await service.getDesktopStatus(bearer(details.headers), reqId)) };
      } else if (details.method === 'POST' && details.path === '/v1/desktop/events') {
        const body = parseJsonBody(event, details.headers);
        result = await service.createEvent(bearer(details.headers), body, reqId);
        statusCode = result.status === 'duplicate' ? 200 : 201;
      } else if (details.method === 'POST' && details.path === '/v1/desktop/unpair-self') {
        const body = parseJsonBody(event, details.headers);
        assertExactKeys(body, ['confirmation'], ['confirmation']);
        if (body.confirmation !== 'UNPAIR') throw new AppError('invalid_request');
        result = { ok: true, ...(await service.unpairSelf(bearer(details.headers), reqId)) };
      } else {
        throw new AppError('invalid_request', { httpStatus: 404 });
      }
      return gatewayResponse(statusCode, { ...result, requestId: reqId });
    } catch (error) {
      logger.warn({ requestId: reqId, route: `${details.method} ${details.path}`, code: error.code || 'internal_error' });
      const safe = error instanceof AppError ? error : new AppError('internal_error');
      return gatewayResponse(safe.httpStatus, errorEnvelope(safe, reqId));
    }
  }

  return { invokeHttp, invokeMini };
}

module.exports = { createApplication, gatewayResponse, isHttpEvent, parseJsonBody };
