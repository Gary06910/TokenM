'use strict';

const { TokenMCloudError } = require('./tokenMCloudClient');

const MAX_RESPONSE_BYTES = 64 * 1024;
const DESKTOP_CREDENTIAL_RE = /^tm_d1\.([A-Za-z0-9_-]{22})\.(dev_[A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43}$/;
const MOBILE_ID_RE = /^mob_[A-Za-z0-9_-]{22}$/;

function managedCloudOrigin(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Managed cloud URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new TypeError('Managed cloud URL must be an origin');
  }
  return url.origin;
}

async function responseJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
    throw new TokenMCloudError('Cloud response was too large', { status: response.status, code: 'invalid_cloud_response' });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new TokenMCloudError('Cloud returned invalid JSON', { status: response.status, code: 'invalid_cloud_response' });
  }
}

async function managedRequest({ baseUrl, fetch: fetchFn, timeoutMs = 10_000, method, pathname, credential, enrollmentCode, body }) {
  const origin = managedCloudOrigin(baseUrl);
  if (typeof fetchFn !== 'function') throw new TypeError('fetch is required');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(`${origin}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(enrollmentCode ? { 'x-token-m-enrollment-secret': enrollmentCode } : {})
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
    throw new TokenMCloudError('Managed cloud request failed', { code });
  } finally {
    clearTimeout(timer);
  }
}

async function enrollTokenMDesktop({ baseUrl, code, deviceName, fetch }) {
  const enrollmentCode = String(code || '').trim();
  const name = String(deviceName || '').trim().slice(0, 120);
  if (!enrollmentCode || enrollmentCode.length > 512) throw new TypeError('Enrollment code is required');
  if (!name) throw new TypeError('Device name is required');
  const payload = await managedRequest({
    baseUrl,
    fetch,
    method: 'POST',
    pathname: '/v1/desktop/enroll',
    enrollmentCode,
    body: { deviceName: name }
  });
  const credentialMatch = typeof payload?.credential === 'string' && payload.credential.match(DESKTOP_CREDENTIAL_RE);
  if (!credentialMatch || payload?.device?.deviceId !== credentialMatch[2] || typeof payload?.device?.name !== 'string') {
    throw new TokenMCloudError('Cloud enrollment response was invalid', { code: 'invalid_cloud_response' });
  }
  return {
    credential: payload.credential,
    tenantId: credentialMatch[1],
    device: { deviceId: credentialMatch[2], name: payload.device.name.slice(0, 120) }
  };
}

function createTokenMDesktopManagementClient({ baseUrl, credential, fetch }) {
  if (typeof credential !== 'string' || !DESKTOP_CREDENTIAL_RE.test(credential)) {
    throw new TypeError('A valid desktop credential is required');
  }
  return {
    sendTest() {
      return managedRequest({ baseUrl, credential, fetch, method: 'POST', pathname: '/v1/desktop/test', body: {} });
    },
    unpair(installationId) {
      if (typeof installationId !== 'string' || !MOBILE_ID_RE.test(installationId)) {
        throw new TypeError('A valid mobile installation id is required');
      }
      return managedRequest({
        baseUrl,
        credential,
        fetch,
        method: 'DELETE',
        pathname: `/v1/desktop/mobile/${encodeURIComponent(installationId)}`
      });
    }
  };
}

module.exports = {
  createTokenMDesktopManagementClient,
  enrollTokenMDesktop,
  managedCloudOrigin
};
