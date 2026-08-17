'use strict';

const { completionEventForWire } = require('../shared/codexCompletion');

const MAX_RESPONSE_BYTES = 64 * 1024;

class TokenMCloudError extends Error {
  constructor(message, { status = null, code = 'cloud_request_failed' } = {}) {
    super(message);
    this.name = 'TokenMCloudError';
    this.status = status;
    this.code = code;
  }
}

function safeBaseUrl(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Managed cloud URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new TypeError('Managed cloud URL must be an origin');
  }
  url.pathname = '';
  return url.toString().replace(/\/$/, '');
}

async function responseJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new TokenMCloudError('Cloud response was too large');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new TokenMCloudError('Cloud returned invalid JSON', { status: response.status, code: 'invalid_cloud_response' });
  }
}

function createTokenMCloudClient({ baseUrl, credential, fetch: fetchFn = globalThis.fetch, timeoutMs = 10_000 }) {
  const origin = safeBaseUrl(baseUrl);
  if (typeof credential !== 'string' || !/^tm_d1\.[A-Za-z0-9_-]{22}\.dev_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(credential)) {
    throw new TypeError('A valid desktop credential is required');
  }
  if (typeof fetchFn !== 'function') throw new TypeError('fetch is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
  let cachedDeviceName = '';

  async function request(method, pathname, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchFn(`${origin}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${credential}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      });
      const payload = await responseJson(response);
      if (!response.ok) {
        const code = typeof payload?.error === 'string' && /^[a-z0-9_]{1,80}$/.test(payload.error)
          ? payload.error
          : `http_${response.status}`;
        throw new TokenMCloudError('Managed cloud request was rejected', { status: response.status, code });
      }
      return payload;
    } catch (error) {
      if (error instanceof TokenMCloudError) throw error;
      const code = controller.signal.aborted || error?.name === 'AbortError' ? 'timeout' : 'network_error';
      throw new TokenMCloudError(code === 'timeout' ? 'Cloud request timed out' : 'Cloud request failed', { code });
    } finally {
      clearTimeout(timer);
    }
  }

  async function status() {
    const payload = await request('GET', '/v1/desktop/status');
    if (typeof payload?.device?.name === 'string') cachedDeviceName = payload.device.name;
    return payload;
  }

  return {
    status,
    async createPairing() {
      if (!cachedDeviceName) await status();
      if (!cachedDeviceName) throw new TokenMCloudError('Cloud status did not include a device name', { code: 'invalid_cloud_response' });
      return request('POST', '/v1/pairings', { deviceName: cachedDeviceName });
    },
    sendEvent(event) {
      return request('POST', '/v1/events', completionEventForWire(event));
    }
  };
}

module.exports = {
  TokenMCloudError,
  createTokenMCloudClient
};
