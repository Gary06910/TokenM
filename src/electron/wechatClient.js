'use strict';

const MAX_RESPONSE_BYTES = 64 * 1024;
const CREDENTIAL_RE = /^tm_wx_d1\.(dev_[A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43}$/;

class WeChatApiError extends Error {
  constructor(message, { status = null, code = 'wechat_request_failed' } = {}) {
    super(message);
    this.name = 'WeChatApiError';
    this.status = status;
    this.code = code;
  }
}

function wechatApiOrigin(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('WeChat API URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new TypeError('WeChat API URL must be an origin');
  }
  url.pathname = '';
  return url.toString().replace(/\/$/, '');
}

function credentialDesktopId(credential) {
  return typeof credential === 'string' ? credential.match(CREDENTIAL_RE)?.[1] || '' : '';
}

async function responseJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
    throw new WeChatApiError('WeChat API response was too large', { status: response.status, code: 'invalid_response' });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch (_) {
    throw new WeChatApiError('WeChat API returned invalid JSON', { status: response.status, code: 'invalid_response' });
  }
}

function safeErrorCode(payload, status) {
  const candidate = payload?.error?.code ?? payload?.error;
  return typeof candidate === 'string' && /^[a-z0-9_]{1,80}$/.test(candidate)
    ? candidate
    : `http_${status}`;
}

function createRequester({ baseUrl, credential = '', fetch: fetchFn = globalThis.fetch, timeoutMs = 5_000 }) {
  const origin = wechatApiOrigin(baseUrl);
  if (typeof fetchFn !== 'function') throw new TypeError('fetch is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');

  return async function request(method, pathname, body, authenticated = true) {
    if (authenticated && !credentialDesktopId(credential)) throw new TypeError('A valid WeChat desktop credential is required');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchFn(`${origin}${pathname}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(authenticated ? { authorization: `Bearer ${credential}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal
      });
      const payload = await responseJson(response);
      if (!response.ok) {
        throw new WeChatApiError('WeChat API request was rejected', {
          status: response.status,
          code: safeErrorCode(payload, response.status)
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof WeChatApiError) throw error;
      const timedOut = controller.signal.aborted || error?.name === 'AbortError';
      throw new WeChatApiError(timedOut ? 'WeChat API request timed out' : 'WeChat API request failed', {
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
  if (payload?.status !== 'paired' || !/^dev_[A-Za-z0-9_-]{22}$/.test(desktopId || '')
    || credentialDesktopId(credential) !== desktopId
    || typeof payload?.desktop?.name !== 'string' || !payload.desktop.name.trim()) {
    throw new WeChatApiError('WeChat API returned an invalid pairing response', { code: 'invalid_pairing_response' });
  }
  return {
    credential,
    desktop: { desktopId, name: payload.desktop.name.trim().slice(0, 80) }
  };
}

async function pairWeChatDesktop({ baseUrl, code, deviceName, fetch, timeoutMs = 5_000 }) {
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

function createWeChatClient(options) {
  const request = createRequester(options);
  const desktopId = credentialDesktopId(options?.credential);
  if (!desktopId) throw new TypeError('A valid WeChat desktop credential is required');
  return {
    desktopId,
    status: () => request('GET', '/v1/desktop/status'),
    sendEvent: (payload) => request('POST', '/v1/desktop/events', payload),
    unpairSelf: () => request('POST', '/v1/desktop/unpair-self', { confirmation: 'UNPAIR' })
  };
}

module.exports = {
  CREDENTIAL_RE,
  WeChatApiError,
  createWeChatClient,
  credentialDesktopId,
  pairWeChatDesktop,
  validatePairingResponse,
  wechatApiOrigin
};
