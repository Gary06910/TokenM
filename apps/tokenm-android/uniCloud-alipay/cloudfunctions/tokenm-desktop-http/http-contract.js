'use strict';

const { isIP } = require('node:net');
const { randomUUID } = require('node:crypto');

const MAX_BODY_BYTES = 16 * 1024;
const PUBLIC_ERRORS = Object.freeze({
  body_too_large: Object.freeze({ status: 413, message: 'Request body is too large.' }),
  configuration_required: Object.freeze({ status: 503, message: 'Server configuration is incomplete.' }),
  desktop_revoked: Object.freeze({ status: 401, message: 'Desktop credential is not active.' }),
  event_conflict: Object.freeze({ status: 409, message: 'The event identifier is already used by different event data.' }),
  internal_error: Object.freeze({ status: 500, message: 'The request could not be completed.' }),
  invalid_request: Object.freeze({ status: 422, message: 'The request is invalid.' }),
  pairing_invalid: Object.freeze({ status: 404, message: 'The pairing code is invalid.' }),
  privacy_payload_rejected: Object.freeze({ status: 422, message: 'The privacy payload is invalid.' }),
  rate_limited: Object.freeze({ status: 429, message: 'Too many requests.' }),
  unauthenticated: Object.freeze({ status: 401, message: 'Authentication is required.' }),
  unauthorized: Object.freeze({ status: 403, message: 'The operation is not allowed.' })
});

function createHttpHandler({ application, getApplication, requestIdFactory } = {}) {
  const resolveApplication = typeof getApplication === 'function'
    ? getApplication
    : () => application;
  const nextRequestId = typeof requestIdFactory === 'function'
    ? requestIdFactory
    : () => `req_${randomUUID()}`;

  return async function handleIntegratedRequest(event = {}, context = {}) {
    const requestId = nextRequestId();
    try {
      const target = route(event);
      const service = resolveApplication();
      if (!service) throw transportError('configuration_required');
      if (target === 'pair') {
        const rateSubject = clientIpRateSubject(context);
        const result = await service.pair(parseJsonBody(event), { rateSubject });
        return response(201, { ...result, requestId });
      }
      const credential = bearerCredential(event.headers);
      if (target === 'putUsage') {
        return response(200, { ...await service.putUsageSnapshot(credential, parseJsonBody(event)), requestId });
      }
      if (target === 'getUsage') {
        return response(200, { ...await service.listUsageSnapshots(credential, parseUsageQuery(event)), requestId });
      }
      if (target === 'status') {
        const result = await service.status(credential);
        return response(200, {
          ok: true,
          desktop: {
            desktopId: result.desktop.desktopId,
            name: result.desktop.name,
            status: result.desktop.status,
            lastSeenAt: result.desktop.lastSeenAt,
            lastEventAt: result.desktop.lastEventAt
          },
          serverTime: result.serverTime,
          requestId
        });
      }
      if (target === 'events') {
        const result = await service.events(credential, parseJsonBody(event));
        return response(result.status === 'created' ? 201 : 200, { ...result, requestId });
      }
      const result = await service.unpairSelf(credential, parseJsonBody(event));
      return response(200, { ...result, requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

function route(event) {
  const method = typeof event.httpMethod === 'string' ? event.httpMethod.toUpperCase() : '';
  const path = typeof event.path === 'string' ? event.path : '';
  if (method === 'PUT' && path === '/v1/desktop/usage') return 'putUsage';
  if (method === 'GET' && path === '/v1/desktop/usage') return 'getUsage';
  if (method === 'POST' && path === '/v1/desktop/pair') return 'pair';
  if (method === 'GET' && path === '/v1/desktop/status') return 'status';
  if (method === 'POST' && path === '/v1/desktop/events') return 'events';
  if (method === 'POST' && path === '/v1/desktop/unpair-self') return 'unpairSelf';
  const knownPath = [
    '/v1/desktop/usage',
    '/v1/desktop/pair',
    '/v1/desktop/status',
    '/v1/desktop/events',
    '/v1/desktop/unpair-self'
  ].includes(path);
  throw transportError('invalid_request', knownPath ? 405 : 404);
}

function parseUsageQuery(event) {
  const query = event.queryStringParameters ?? {};
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some((key) => !['limit', 'cursor'].includes(key))) throw transportError('invalid_request');
  if (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-4]$/.test(query.limit))) throw transportError('invalid_request');
  return { ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }) };
}

function parseJsonBody(event) {
  const contentType = getHeader(event.headers, 'content-type');
  if (
    typeof contentType !== 'string'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  ) {
    throw transportError('invalid_request');
  }
  if (typeof event.body !== 'string') throw transportError('invalid_request');
  let bytes;
  try {
    bytes = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  } catch (_error) {
    throw transportError('invalid_request');
  }
  if (bytes.length > MAX_BODY_BYTES) throw transportError('body_too_large');
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw transportError('invalid_request');
    }
    return value;
  } catch (error) {
    if (error?.code === 'invalid_request') throw error;
    throw transportError('invalid_request');
  }
}

function bearerCredential(headers) {
  const authorization = getHeader(headers, 'authorization');
  if (typeof authorization !== 'string' || !/^Bearer [^\s]+$/.test(authorization)) {
    throw transportError('unauthenticated');
  }
  return authorization.slice('Bearer '.length);
}

function getHeader(headers, target) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === target);
  return entry?.[1];
}

function clientIpRateSubject(context) {
  const clientIp = context
    && typeof context === 'object'
    && !Array.isArray(context)
    && Object.hasOwn(context, 'CLIENTIP')
    ? context.CLIENTIP
    : undefined;
  if (
    typeof clientIp !== 'string'
    || clientIp.length === 0
    || clientIp.trim() !== clientIp
    || isIP(clientIp) === 0
  ) {
    throw transportError('configuration_required');
  }
  return `client-ip:${clientIp}`;
}

function transportError(code, status) {
  const error = new Error(PUBLIC_ERRORS[code]?.message ?? PUBLIC_ERRORS.internal_error.message);
  error.code = Object.hasOwn(PUBLIC_ERRORS, code) ? code : 'internal_error';
  error.status = status ?? PUBLIC_ERRORS[error.code].status;
  return error;
}

function errorResponse(error, requestId) {
  const code = Object.hasOwn(PUBLIC_ERRORS, error?.code) ? error.code : 'internal_error';
  const definition = PUBLIC_ERRORS[code];
  const status = Number.isSafeInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : definition.status;
  return response(status, {
    error: { code, message: definition.message },
    requestId
  });
}

function response(statusCode, body) {
  return {
    mpserverlessComposedResponse: true,
    isBase64Encoded: false,
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

module.exports = {
  MAX_BODY_BYTES,
  PUBLIC_ERRORS,
  bearerCredential,
  clientIpRateSubject,
  createHttpHandler,
  parseJsonBody
};
