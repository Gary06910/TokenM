'use strict';

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024;
const DESKTOP_ID_SOURCE = 'dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CREDENTIAL_RE = new RegExp(`^tm_uc_d1\\.(${DESKTOP_ID_SOURCE})\\.[A-Za-z0-9_-]{43}$`);
const TASK_ID_RE = /^tsk_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NOTIFICATION_STATUSES = new Set([
  'not_requested',
  'skipped_disabled',
  'skipped_no_target',
  'pending',
  'submitted',
  'failed'
]);

class AndroidApiError extends Error {
  constructor(message, { status = null, code = 'android_request_failed' } = {}) {
    super(message);
    this.name = 'AndroidApiError';
    this.status = status;
    this.code = code;
  }
}

function androidApiOrigin(value) {
  let url;
  try { url = new URL(value); }
  catch (error) { throw new TypeError('Android API URL is invalid', { cause: error }); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Android API URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.href.includes('#')) {
    throw new TypeError('Android API URL must not contain credentials, query, or fragment');
  }
  const rootPath = url.pathname.replace(/\/+$/, '');
  url.pathname = rootPath;
  return url.toString().replace(/\/$/, '');
}

function credentialDesktopId(credential) {
  return typeof credential === 'string' ? credential.match(CREDENTIAL_RE)?.[1] || '' : '';
}

async function responseText(response) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new AndroidApiError('Android API response was too large', {
      status: response.status,
      code: 'invalid_response'
    });
  }
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
      throw new AndroidApiError('Android API response was too large', {
        status: response.status,
        code: 'invalid_response'
      });
    }
    return raw;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AndroidApiError('Android API response was too large', {
          status: response.status,
          code: 'invalid_response'
        });
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function responseJson(response) {
  const raw = await responseText(response);
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch (_) {
    throw new AndroidApiError('Android API returned invalid JSON', {
      status: response.status,
      code: 'invalid_response'
    });
  }
}

function safeErrorCode(payload, status) {
  const candidate = payload?.error?.code ?? payload?.error;
  return typeof candidate === 'string' && /^[a-z0-9_]{1,80}$/.test(candidate)
    ? candidate
    : `http_${status}`;
}

function createRequester({ baseUrl, credential = '', fetch: fetchFn = globalThis.fetch, timeoutMs = 5_000 }) {
  const root = androidApiOrigin(baseUrl);
  if (typeof fetchFn !== 'function') throw new TypeError('fetch is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');

  return async function request(method, pathname, body, authenticated = true) {
    if (authenticated && !credentialDesktopId(credential)) {
      throw new TypeError('A valid Android desktop credential is required');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const bodyText = body === undefined ? undefined : JSON.stringify(body);
      if (bodyText !== undefined && Buffer.byteLength(bodyText) > MAX_REQUEST_BYTES) {
        throw new AndroidApiError('Android API request body was too large', {
          status: 413,
          code: 'body_too_large'
        });
      }
      const response = await fetchFn(`${root}${pathname}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(authenticated ? { authorization: `Bearer ${credential}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(bodyText === undefined ? {} : { body: bodyText }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal
      });
      const payload = await responseJson(response);
      if (!response.ok) {
        throw new AndroidApiError('Android API request was rejected', {
          status: response.status,
          code: safeErrorCode(payload, response.status)
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AndroidApiError) throw error;
      const timedOut = controller.signal.aborted || error?.name === 'AbortError';
      throw new AndroidApiError(timedOut ? 'Android API request timed out' : 'Android API request failed', {
        code: timedOut ? 'timeout' : 'network_error'
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

function validatePairingResponse(payload) {
  const desktopId = payload?.desktop?.desktopId;
  const credential = payload?.credential;
  const name = typeof payload?.desktop?.name === 'string' ? payload.desktop.name.trim() : '';
  if (
    payload?.status !== 'paired'
    || !new RegExp(`^${DESKTOP_ID_SOURCE}$`).test(desktopId || '')
    || credentialDesktopId(credential) !== desktopId
    || !name
    || Array.from(name).length > 80
  ) {
    throw new AndroidApiError('Android API returned an invalid pairing response', {
      code: 'invalid_pairing_response'
    });
  }
  return { credential, desktop: { desktopId, name } };
}

function validateUnpairResponse(payload) {
  if (payload?.ok !== true) {
    throw new AndroidApiError('Android API returned an invalid unpair response', {
      code: 'invalid_response'
    });
  }
  return payload;
}

function validateEventResponse(payload) {
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || !['created', 'duplicate'].includes(payload.status)
    || !TASK_ID_RE.test(payload.taskId || '')
    || !NOTIFICATION_STATUSES.has(payload.notificationStatus)
    || (payload.requestId !== undefined
      && (typeof payload.requestId !== 'string' || !SAFE_REQUEST_ID_RE.test(payload.requestId)))
  ) {
    throw new AndroidApiError('Android API returned an invalid event response', {
      code: 'invalid_response'
    });
  }
  return {
    status: payload.status,
    taskId: payload.taskId,
    notificationStatus: payload.notificationStatus,
    ...(payload.requestId === undefined ? {} : { requestId: payload.requestId })
  };
}

async function pairAndroidDesktop({ baseUrl, code, deviceName, fetch, timeoutMs = 5_000 }) {
  if (!/^\d{6}$/.test(code || '')) throw new TypeError('Pairing code must contain exactly 6 digits');
  const name = String(deviceName || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!name || Array.from(name).length > 80) throw new TypeError('deviceName is invalid');
  const request = createRequester({ baseUrl, fetch, timeoutMs });
  return validatePairingResponse(await request('POST', '/v1/desktop/pair', {
    schemaVersion: 1,
    code,
    deviceName: name
  }, false));
}

function createAndroidClient(options) {
  const request = createRequester(options);
  const desktopId = credentialDesktopId(options?.credential);
  if (!desktopId) throw new TypeError('A valid Android desktop credential is required');
  return {
    desktopId,
    status: () => request('GET', '/v1/desktop/status'),
    sendEvent: async (payload) => validateEventResponse(
      await request('POST', '/v1/desktop/events', payload)
    ),
    unpairSelf: async () => validateUnpairResponse(
      await request('POST', '/v1/desktop/unpair-self', { confirmation: 'UNPAIR' })
    )
  };
}

module.exports = {
  AndroidApiError,
  CREDENTIAL_RE,
  NOTIFICATION_STATUSES,
  TASK_ID_RE,
  androidApiOrigin,
  createAndroidClient,
  credentialDesktopId,
  pairAndroidDesktop,
  validatePairingResponse,
  validateEventResponse,
  validateUnpairResponse
};
