import { publicLimits } from './shared/limits.js';
import subscriptionDisplay from './shared/subscriptionDisplay.js';
import currency from './shared/currency.js';
import { aggregateDevices, mergeDeviceRecord, aggregateHistory } from './shared/usage.js';
import { DEFAULT_STALE_AFTER_MS } from './shared/syncUploadInterval.js';
import { deviceHistoryRevision, historyPreview, historyRevision } from './shared/history.js';
import hubBuildIdentity from './shared/hubBuildIdentity.js';
import managed from './managed.cjs';
import { buildPushPayload } from '@block65/webcrypto-web-push';

const { bearerCapability, createTenantDO, parseCapability } = managed;

function classifyPushStatus(status) {
  if (status === 201 || status === 202) return 'delivered';
  if (status === 404 || status === 410) return 'expired';
  if (status === 429 || status >= 500) return 'pending';
  if (status >= 400 && status < 500) return 'terminal';
  return 'pending';
}

async function sendWebPush(subscription, message, env, fetchImpl = fetch) {
  const vapid = {
    subject: String(env.TOKEN_M_VAPID_SUBJECT || ''),
    publicKey: String(env.TOKEN_M_VAPID_PUBLIC_KEY || ''),
    privateKey: String(env.TOKEN_M_VAPID_PRIVATE_KEY || '')
  };
  if (!vapid.subject || !vapid.publicKey || !vapid.privateKey) return { classification: 'pending', status: 0, error: 'vapid_not_configured' };
  try {
    const init = await buildPushPayload({
      data: JSON.stringify(message),
      options: { ttl: 300, topic: String(message.eventId || '').slice(-32) }
    }, subscription, vapid);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try { response = await fetchImpl(subscription.endpoint, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    return { classification: classifyPushStatus(response.status), status: response.status };
  } catch (_) {
    return { classification: 'pending', status: 0, error: 'push_network_error' };
  }
}

const TenantDO = createTenantDO(sendWebPush);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-token-monitor-secret'
};

function jsonResponse(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, no-transform', ...CORS_HEADERS, ...extra }
  });
}

function textResponse(status, body, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { 'content-type': contentType, ...CORS_HEADERS } });
}

function requestSecret(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const headerSecret = String(request.headers.get('x-token-monitor-secret') || '').trim();
  if (headerSecret) return headerSecret;
  try {
    const url = new URL(request.url);
    return String(url.searchParams.get('secret') || '').trim();
  } catch (_) { return ''; }
}

function isAuthorized(request, expectedSecret) {
  if (!expectedSecret) return true;
  return requestSecret(request) === expectedSecret;
}

const SUBSCRIPTIONS_KEY = 'subscriptions';

function sseFormat(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/')) return routeManagedRequest(request, env);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return textResponse(204, '');
      const id = env.HUB.idFromName('hub');
      return env.HUB.get(id).fetch(request);
    }
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return jsonResponse(404, { error: 'not_found' });
  }
};

async function routeManagedRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed', message: 'Cross-origin browser requests are not allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  if (request.method === 'OPTIONS') {
    const headers = { 'cache-control': 'no-store', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-token-m-enrollment-secret' };
    if (origin === url.origin) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin'; }
    return new Response(null, { status: 204, headers });
  }

  let tenantId;
  if (url.pathname === '/v1/desktop/enroll') {
    if (request.method !== 'POST') return managedRouterError(405, 'method_not_allowed', 'Method not allowed');
    const expected = String(env.TOKEN_M_ENROLLMENT_SECRET || '');
    const presented = request.headers.get('x-token-m-enrollment-secret') || '';
    if (!expected || !safeStringEqual(expected, presented)) return managedRouterError(403, 'invalid_enrollment', 'Enrollment capability is invalid');
    tenantId = randomTenantId();
  } else if (url.pathname === '/v1/pairings/redeem') {
    if (request.method !== 'POST') return managedRouterError(405, 'method_not_allowed', 'Method not allowed');
    let body;
    try { body = await readRouterJson(request.clone(), 4096); } catch (error) { return managedRouterError(error.status || 400, error.code || 'bad_request', error.message || 'Invalid JSON body'); }
    tenantId = parseCapability(body?.token, 'pair')?.tenantId;
    if (!tenantId) return managedRouterError(400, 'invalid_pairing', 'Pairing token is invalid or expired');
  } else {
    const expected = url.pathname.startsWith('/v1/mobile/') || url.pathname === '/v1/mobile' ? 'mobile' : 'desktop';
    const capability = bearerCapability(request, expected);
    if (!capability) return managedRouterError(401, 'unauthorized', `${expected === 'mobile' ? 'Mobile' : 'Desktop'} credential is invalid`);
    tenantId = capability.tenantId;
  }

  if (!env.TENANTS) return managedRouterError(503, 'managed_not_configured', 'Managed tenant storage is not configured');
  const headers = new Headers(request.headers);
  headers.set('x-token-m-tenant-id', tenantId);
  const forwarded = new Request(request, { headers });
  return env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenantId}`)).fetch(forwarded);
}

function randomTenantId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function managedRouterError(status, error, message) {
  return new Response(JSON.stringify({ error, message }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function readRouterJson(request, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error('JSON content type required'), { status: 415, code: 'unsupported_media_type' });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Invalid JSON body'), { status: 400, code: 'bad_request' });
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error('Request body is too large'), { status: 413, code: 'body_too_large' });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw Object.assign(new Error('Invalid JSON body'), { status: 400, code: 'bad_request' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('JSON body must be an object'), { status: 400, code: 'bad_request' });
  return value;
}

function safeStringEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let mismatch = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let index = 0; index < size; index += 1) mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return mismatch === 0;
}

export class HubDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sseClients = new Set();
    this.heartbeatTimer = null;
    this.encoder = new TextEncoder();
  }

  get secret() {
    return String(this.env.TOKEN_MONITOR_SECRET || '').trim();
  }

  get staleAfterMs() {
    return Number(this.env.STALE_AFTER_MS || DEFAULT_STALE_AFTER_MS);
  }

  get publicStatsEnabled() {
    return ['1', 'true', 'yes', 'on'].includes(String(this.env.PUBLIC_STATS_ENABLED || '').trim().toLowerCase());
  }

  // Devices live under the `dev:` prefix; the shared subscription document is a
  // single key outside it, so listDevices() never picks it up.
  async getSubscriptions() {
    const stored = await this.state.storage.get(SUBSCRIPTIONS_KEY);
    return stored || subscriptionDisplay.emptySubscriptionDocument();
  }

  async listDevices() {
    const entries = await this.state.storage.list({ prefix: 'dev:' });
    return Array.from(entries.values());
  }

  async getStats() {
    const devices = await this.listDevices();
    const stats = aggregateDevices(devices, this.staleAfterMs);
    stats.staleAfterMs = this.staleAfterMs;
    const history = aggregateHistory(devices);
    stats.historyPreview = historyPreview(history);
    stats.historyRevision = historyRevision(history);
    stats.deviceHistoryRevision = deviceHistoryRevision(devices);
    return stats;
  }

  // The version of the shared subscription list, never the list itself. A device
  // compares it against the copy it holds and re-reads only when it has been
  // overtaken, so learning about another device's edit costs nothing in the
  // steady state and does not put what the user pays into every frame.
  //
  // Deliberately not folded into getStats(): /api/public/stats is the one
  // unauthenticated route, it is built by spreading whatever getStats() returns,
  // and the money document is the last thing that should be reached for on that
  // path. Adding it here means the public route neither reads it nor has to
  // remember to drop it back out — every caller below is behind the secret.
  async statsWithSubscriptionVersion() {
    const stats = await this.getStats();
    stats.subscriptionsUpdatedAt = (await this.getSubscriptions())?.updatedAt || '';
    return stats;
  }

  ensureHeartbeat() {
    if (this.heartbeatTimer || this.sseClients.size === 0) return;
    this.heartbeatTimer = setInterval(() => {
      const chunk = this.encoder.encode(': hb\n\n');
      for (const writer of this.sseClients) {
        writer.write(chunk).catch(() => this.dropClient(writer));
      }
      if (this.sseClients.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }, 30000);
  }

  dropClient(writer) {
    this.sseClients.delete(writer);
    try { writer.close(); } catch (_) {}
    if (this.sseClients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async broadcast(reason = 'update') {
    if (this.sseClients.size === 0) return;
    const stats = await this.statsWithSubscriptionVersion();
    const payload = this.encoder.encode(sseFormat('stats', {
      type: 'stats', reason, stats, at: new Date().toISOString()
    }));
    for (const writer of this.sseClients) {
      writer.write(payload).catch(() => this.dropClient(writer));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      const devices = await this.listDevices();
      return jsonResponse(200, {
        ok: true,
        role: 'hub',
        runtime: 'cloudflare-worker',
        version: 1,
        hubBuild: hubBuildIdentity.currentHubBuild('cloudflare-worker'),
        deviceCount: devices.length,
        secretRequired: Boolean(this.secret),
        now: new Date().toISOString()
      });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/public/stats') {
      if (!this.publicStatsEnabled) return jsonResponse(404, { error: 'not_found' });
      const stats = await this.getStats();
      const { devices, limits, periods, ...rest } = stats;
      delete rest.deviceHistoryRevision;
      return jsonResponse(200, {
        ok: true,
        source: 'cloudflare-worker',
        deviceCount: devices.length,
        limits: publicLimits(limits),
        periods: publicPeriods(periods),
        ...rest
      }, { 'cache-control': 'public, max-age=15, s-maxage=15' });
    }

    // A Worker is an internet-facing URL with no trusted-LAN fallback, so it must
    // never serve data unauthenticated. Without a secret every data route is refused
    // (health and the opt-in, already-scrubbed /api/public/stats are handled above).
    if (!this.secret) {
      return jsonResponse(503, { error: 'secret_required', message: 'TOKEN_MONITOR_SECRET must be set on the worker; unauthenticated access is refused.' });
    }
    if (!isAuthorized(request, this.secret)) return jsonResponse(401, { error: 'unauthorized' });

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/stats') {
      return jsonResponse(200, await this.statsWithSubscriptionVersion());
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/devices') {
      const devices = await this.listDevices();
      return jsonResponse(200, { devices });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/history') {
      const devices = await this.listDevices();
      return jsonResponse(200, aggregateHistory(devices));
    }

    if (request.method === 'GET' && url.pathname === '/api/stats/stream') {
      const stats = await this.statsWithSubscriptionVersion();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      writer.write(this.encoder.encode(sseFormat('snapshot', {
        type: 'stats', reason: 'snapshot', stats, at: new Date().toISOString()
      }))).catch(() => {});
      this.sseClients.add(writer);
      this.ensureHeartbeat();
      request.signal.addEventListener('abort', () => this.dropClient(writer));
      return new Response(readable, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
          ...CORS_HEADERS
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/ingest') {
      let payload;
      try { payload = await request.json(); }
      catch (error) { return jsonResponse(400, { error: 'bad_request', message: error.message }); }
      if (!payload.deviceId && !payload.id) return jsonResponse(400, { error: 'deviceId_required' });
      const deviceId = String(payload.deviceId || payload.id);
      const existing = await this.state.storage.get(`dev:${deviceId}`);
      const record = mergeDeviceRecord(existing, { ...payload, receivedAt: new Date().toISOString() });
      await this.state.storage.put(`dev:${record.deviceId}`, record);
      this.broadcast('ingest').catch(() => {});
      return jsonResponse(200, { ok: true, deviceId: record.deviceId, stats: await this.statsWithSubscriptionVersion() });
    }

    // Shared by every device on this hub rather than owned by one of them, and
    // behind the same secret gate as every other data route: this is the one
    // place the user records money. It is never part of /api/public/stats, which
    // is built from device records alone.
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/subscriptions') {
      return jsonResponse(200, { ok: true, ...(await this.getSubscriptions()) });
    }

    if (request.method === 'PUT' && url.pathname === '/api/subscriptions') {
      let payload;
      try { payload = await request.json(); }
      catch (error) { return jsonResponse(400, { error: 'bad_request', message: error.message }); }
      // A non-array would normalize to an empty list and store as a perfectly
      // successful replacement, wiping records that exist nowhere else. An
      // intentional clear still sends [].
      if (!Array.isArray(payload?.subscriptions)) {
        return jsonResponse(400, { error: 'bad_request', message: 'subscriptions must be an array' });
      }
      const stored = await this.getSubscriptions();
      // Staleness first, matching the Node hub: a stale write is exactly the case
      // where the client needs the stored document back to re-base, and answering
      // 400 for a request that is both stale and malformed would withhold it.
      if (subscriptionDisplay.isStaleSubscriptionWrite(stored, payload?.baseUpdatedAt)) {
        return jsonResponse(409, { error: 'stale_write', ...stored });
      }
      // A currency with no exchange rate would be coerced to USD and reported as
      // an amount the user never entered.
      const unsupported = payload.subscriptions.find(
        (entry) => entry?.currency && !currency.CURRENCY_CODES.includes(String(entry.currency).trim().toUpperCase())
      );
      if (unsupported) {
        return jsonResponse(400, {
          error: 'bad_request',
          message: `unsupported currency: ${String(unsupported.currency).trim().toUpperCase()}`
        });
      }
      const next = subscriptionDisplay.subscriptionDocument(payload.subscriptions, {
        previousUpdatedAt: stored?.updatedAt,
        currencyApi: { normalizeCurrency: currency.normalizeCurrency }
      });
      await this.state.storage.put(SUBSCRIPTIONS_KEY, next);
      // Same reason ingest broadcasts: the other devices are holding a copy that
      // has just been overtaken, and without this they only find out on their
      // next poll — which is five minutes apart while the stream is up.
      this.broadcast('subscriptions').catch(() => {});
      return jsonResponse(200, { ok: true, ...next });
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/devices/'.length));
      await this.state.storage.delete(`dev:${deviceId}`);
      this.broadcast('delete').catch(() => {});
      return jsonResponse(200, { ok: true, deviceId });
    }

    return jsonResponse(404, { error: 'not_found' });
  }
}

function publicPeriods(periods) {
  return Object.fromEntries(Object.entries(periods || {}).map(([name, period]) => {
    const safePeriod = { ...(period || {}) };
    delete safePeriod.projects;
    return [name, {
      ...safePeriod,
      sessions: Object.fromEntries(Object.entries(period?.sessions || {}).map(([key, session]) => {
      const { projectId, projectLabel, projectPath, ...safe } = session;
      return [key, safe];
      }))
    }];
  }));
}

export { classifyPushStatus, publicPeriods, routeManagedRequest, sendWebPush, TenantDO };
