const IDENTIFIER = '[A-Za-z0-9_-]';
const TOKEN_RE = new RegExp(`^(tm_[dmp]1)\\.(${IDENTIFIER}{22})\\.((?:dev_|mob_|pair_)${IDENTIFIER}{22})\\.(${IDENTIFIER}{43})$`);
const EVENT_ID_RE = /^evt_[A-Za-z0-9_-]{16,128}$/;
const PAIR_TTL_MS = 10 * 60 * 1000;
const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_MOBILES = 32;
const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomId(prefix, bytes = 16) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return `${prefix}${base64url(value)}`;
}

function randomSecret() {
  const value = new Uint8Array(32);
  crypto.getRandomValues(value);
  return base64url(value);
}

async function hmac(pepper, capability) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(capability))));
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i += 1) mismatch |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return mismatch === 0;
}

function parseCapability(value, expectedKind) {
  const match = TOKEN_RE.exec(String(value || ''));
  if (!match) return null;
  const kind = match[1] === 'tm_d1' ? 'desktop' : match[1] === 'tm_m1' ? 'mobile' : 'pair';
  const prefix = kind === 'desktop' ? 'dev_' : kind === 'mobile' ? 'mob_' : 'pair_';
  if ((expectedKind && kind !== expectedKind) || !match[3].startsWith(prefix)) return null;
  return { kind, tenantId: match[2], subjectId: match[3], capability: match[0] };
}

function bearerCapability(request, expectedKind) {
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer\s+/i.test(auth)) return null;
  return parseCapability(auth.replace(/^Bearer\s+/i, '').trim(), expectedKind);
}

function managedResponse(status, payload, request) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const origin = request?.headers?.get('origin');
  if (origin && origin === new URL(request.url).origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function errorResponse(status, error, message, request, details) {
  return managedResponse(status, { error, message, ...(details || {}) }, request);
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error('JSON content type required'), { status: 415, code: 'unsupported_media_type' });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413, code: 'body_too_large' });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413, code: 'body_too_large' });
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw Object.assign(new Error('Invalid JSON body'), { status: 400, code: 'bad_request' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('JSON body must be an object'), { status: 400, code: 'bad_request' });
  return value;
}

function boundedString(value, name, max, { optional = false, pattern } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max || (pattern && !pattern.test(value))) throw Object.assign(new Error(`${name} is invalid`), { status: 400, code: 'invalid_request' });
  return value.trim();
}

function requireExactKeys(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Object.assign(new Error(`Unknown field: ${key}`), { status: 400, code: 'invalid_request' });
}

function pushPayload(event) {
  return {
    eventId: event.eventId,
    title: 'Token M',
    body: `${event.summary}\nProject: ${event.project}`,
    url: `/?event=${encodeURIComponent(event.eventId)}`,
    tag: event.eventId
  };
}

function normalizeManagedEvent(value, authenticatedDeviceId, nowMs = Date.now()) {
  requireExactKeys(value, ['eventId', 'type', 'deviceId', 'sessionId', 'turnId', 'status', 'project', 'summary', 'occurredAt', 'durationMs']);
  const event = {
    eventId: boundedString(value.eventId, 'eventId', 132, { pattern: EVENT_ID_RE }),
    type: boundedString(value.type, 'type', 64),
    deviceId: boundedString(value.deviceId, 'deviceId', 128, { pattern: /^dev_[A-Za-z0-9_-]{22}$/ }),
    sessionId: boundedString(value.sessionId, 'sessionId', 128, { pattern: /^[A-Za-z0-9._:-]+$/ }),
    turnId: boundedString(value.turnId, 'turnId', 128, { pattern: /^[A-Za-z0-9._:-]+$/ }),
    status: boundedString(value.status, 'status', 32),
    project: boundedString(value.project, 'project', 80),
    summary: boundedString(value.summary, 'summary', 120),
    occurredAt: boundedString(value.occurredAt, 'occurredAt', 40)
  };
  if (event.type !== 'codex.turn.completed' || event.status !== 'completed') throw Object.assign(new Error('Unsupported event type or status'), { status: 422, code: 'unsupported_event' });
  if (event.deviceId !== authenticatedDeviceId) throw Object.assign(new Error('Event device does not match credential'), { status: 403, code: 'device_mismatch' });
  const occurred = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurred) || new Date(occurred).toISOString() !== event.occurredAt || Math.abs(nowMs - occurred) > EVENT_TTL_MS) throw Object.assign(new Error('occurredAt is outside the accepted window'), { status: 422, code: 'invalid_event_time' });
  if (/[\\/\u0000-\u001f\u007f]/.test(event.project)) throw Object.assign(new Error('project must be a sanitized directory name'), { status: 400, code: 'invalid_request' });
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(event.summary)) throw Object.assign(new Error('summary is invalid'), { status: 400, code: 'invalid_request' });
  if (value.durationMs !== undefined) {
    if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0) throw Object.assign(new Error('durationMs is invalid'), { status: 400, code: 'invalid_request' });
    event.durationMs = value.durationMs;
  }
  return event;
}

function validateSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('subscription is invalid'), { status: 400, code: 'invalid_subscription' });
  requireExactKeys(value, ['endpoint', 'expirationTime', 'keys']);
  const endpoint = boundedString(value.endpoint, 'endpoint', 2048);
  let parsed;
  try { parsed = new URL(endpoint); } catch (_) { throw Object.assign(new Error('endpoint is invalid'), { status: 400, code: 'invalid_subscription' }); }
  if (parsed.protocol !== 'https:') throw Object.assign(new Error('endpoint must use HTTPS'), { status: 400, code: 'invalid_subscription' });
  if (value.expirationTime !== null && value.expirationTime !== undefined && (!Number.isFinite(value.expirationTime) || value.expirationTime < 0)) throw Object.assign(new Error('expirationTime is invalid'), { status: 400, code: 'invalid_subscription' });
  if (!value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys)) throw Object.assign(new Error('subscription keys are invalid'), { status: 400, code: 'invalid_subscription' });
  requireExactKeys(value.keys, ['p256dh', 'auth']);
  const p256dh = boundedString(value.keys.p256dh, 'p256dh', 256, { pattern: /^[A-Za-z0-9_-]+$/ });
  const auth = boundedString(value.keys.auth, 'auth', 128, { pattern: /^[A-Za-z0-9_-]+$/ });
  if (p256dh.length !== 87 || auth.length !== 22) throw Object.assign(new Error('subscription key sizes are invalid'), { status: 400, code: 'invalid_subscription' });
  return { endpoint, expirationTime: value.expirationTime ?? null, keys: { p256dh, auth } };
}

function createTenantDO(sendWebPush) {
return class TenantDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.now = () => Date.now();
    this.push = (subscription, message) => sendWebPush(subscription, message, env);
    this.serial = Promise.resolve();
  }

  get pepper() { return String(this.env.TOKEN_M_CREDENTIAL_PEPPER || ''); }
  get vapidPublicKey() { return String(this.env.TOKEN_M_VAPID_PUBLIC_KEY || ''); }

  configurationError() {
    if (!this.pepper) return 'TOKEN_M_CREDENTIAL_PEPPER is not configured';
    if (!/^[A-Za-z0-9_-]{87}$/.test(this.vapidPublicKey)) return 'TOKEN_M_VAPID_PUBLIC_KEY is not a URL-safe uncompressed P-256 key';
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(this.env.TOKEN_M_VAPID_PRIVATE_KEY || ''))) return 'TOKEN_M_VAPID_PRIVATE_KEY is not a URL-safe P-256 private key';
    if (!/^(?:mailto:|https:)/.test(String(this.env.TOKEN_M_VAPID_SUBJECT || ''))) return 'TOKEN_M_VAPID_SUBJECT must be a mailto: or https: URI';
    return '';
  }

  async initialize(tenantId) {
    const key = 'meta';
    const existing = await this.state.storage.get(key);
    if (existing && existing.tenantId !== tenantId) throw new Error('tenant identity mismatch');
    if (!existing) await this.state.storage.put(key, { schemaVersion: 1, tenantId, createdAt: new Date(this.now()).toISOString() });
  }

  async authenticate(request, kind) {
    const parsed = bearerCapability(request, kind);
    if (!parsed || !this.pepper) return null;
    const key = kind === 'desktop' ? `device:${parsed.subjectId}` : `mobile:${parsed.subjectId}`;
    const record = await this.state.storage.get(key);
    if (!record || record.revokedAt) return null;
    const presented = await hmac(this.pepper, parsed.capability);
    if (!timingSafeEqual(presented, record.credentialMac)) return null;
    record.lastSeenAt = new Date(this.now()).toISOString();
    await this.state.storage.put(key, record);
    return { parsed, record, key };
  }

  async rateLimit(scope, limit) {
    const window = Math.floor(this.now() / 60000);
    const key = `rate:${scope}:${window}`;
    const count = Number(await this.state.storage.get(key) || 0) + 1;
    await this.state.storage.put(key, count);
    return count <= limit;
  }

  async cleanup() {
    const now = this.now();
    const pairs = await this.state.storage.list({ prefix: 'pair:', limit: 25 });
    for (const [key, value] of pairs) if (value.expiresAtMs + PAIR_TTL_MS < now) await this.state.storage.delete(key);
    const events = await this.state.storage.list({ prefix: 'event:', limit: 25 });
    for (const [key, value] of events) if (value.expiresAtMs < now) await this.state.storage.delete(key);
    const rates = await this.state.storage.list({ prefix: 'rate:', limit: 25 });
    for (const key of rates.keys()) {
      const window = Number(key.split(':').pop());
      if (window < Math.floor(now / 60000) - 2) await this.state.storage.delete(key);
    }
  }

  fetch(request) {
    const result = this.serial.then(() => this.handleFetch(request));
    this.serial = result.catch(() => {});
    return result;
  }

  async handleFetch(request) {
    const url = new URL(request.url);
    const tenantId = request.headers.get('x-token-m-tenant-id') || '';
    const configurationError = this.configurationError();
    if (configurationError) return errorResponse(503, 'managed_not_configured', configurationError, request);
    await this.initialize(tenantId);
    await this.cleanup();
    try {
      if (url.pathname === '/v1/desktop/enroll') return await this.enroll(request, tenantId);
      if (url.pathname === '/v1/pairings/redeem') return await this.redeem(request, tenantId);
      if (url.pathname === '/v1/desktop/status') return await this.desktopStatus(request, tenantId);
      if (url.pathname === '/v1/desktop/test') return await this.desktopTestPush(request);
      if (url.pathname.startsWith('/v1/desktop/mobile/')) return await this.desktopDeleteMobile(request, url.pathname.slice('/v1/desktop/mobile/'.length));
      if (url.pathname === '/v1/pairings') return await this.createPairing(request);
      if (url.pathname === '/v1/events') return await this.receiveEvent(request);
      if (url.pathname === '/v1/mobile/status') return await this.mobileStatus(request);
      if (url.pathname === '/v1/mobile/subscription') return await this.updateSubscription(request);
      if (url.pathname === '/v1/mobile/test') return await this.testPush(request);
      if (url.pathname === '/v1/mobile') return await this.deleteMobile(request);
      return errorResponse(404, 'not_found', 'Endpoint not found', request);
    } catch (error) {
      return errorResponse(error.status || 400, error.code || 'bad_request', error.message || 'Invalid request', request);
    }
  }

  async enroll(request, tenantId) {
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request, { allowed: ['POST'] });
    const expected = String(this.env.TOKEN_M_ENROLLMENT_SECRET || '');
    const presented = request.headers.get('x-token-m-enrollment-secret') || '';
    if (!expected || !timingSafeEqual(expected, presented)) return errorResponse(403, 'invalid_enrollment', 'Enrollment capability is invalid', request);
    const existing = await this.state.storage.list({ prefix: 'device:', limit: 1 });
    if (existing.size) return errorResponse(409, 'tenant_exists', 'Tenant is already enrolled', request);
    const body = await readJson(request, 2048);
    requireExactKeys(body, ['deviceName']);
    const name = boundedString(body.deviceName, 'deviceName', 80);
    const deviceId = randomId('dev_');
    const capability = `tm_d1.${tenantId}.${deviceId}.${randomSecret()}`;
    const createdAt = new Date(this.now()).toISOString();
    await this.state.storage.put(`device:${deviceId}`, { name, credentialMac: await hmac(this.pepper, capability), createdAt, lastSeenAt: createdAt, revokedAt: null });
    return managedResponse(201, { tenantId, device: { deviceId, name }, credential: capability, createdAt }, request);
  }

  async desktopStatus(request, tenantId) {
    if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'desktop');
    if (!auth) return errorResponse(401, 'unauthorized', 'Desktop credential is invalid', request);
    if (!await this.rateLimit(`desktop:${auth.parsed.subjectId}`, 120)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const mobiles = await this.state.storage.list({ prefix: 'mobile:' });
    return managedResponse(200, { ok: true, tenantId, device: { deviceId: auth.parsed.subjectId, name: auth.record.name, lastSeenAt: auth.record.lastSeenAt }, mobileInstallations: [...mobiles.entries()].filter(([, value]) => !value.revokedAt).map(([key, value]) => ({ installationId: key.slice(7), name: value.name, pushEnabled: Boolean(value.subscription), lastSeenAt: value.lastSeenAt })), vapidPublicKey: this.vapidPublicKey }, request);
  }

  async createPairing(request) {
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'desktop');
    if (!auth) return errorResponse(401, 'unauthorized', 'Desktop credential is invalid', request);
    if (!await this.rateLimit(`pair:${auth.parsed.subjectId}`, 20)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const body = await readJson(request, 2048);
    requireExactKeys(body, ['deviceName']);
    boundedString(body.deviceName, 'deviceName', 80);
    const challengeId = randomId('pair_');
    const capability = `tm_p1.${auth.parsed.tenantId}.${challengeId}.${randomSecret()}`;
    const expiresAtMs = this.now() + PAIR_TTL_MS;
    await this.state.storage.put(`pair:${challengeId}`, { tokenMac: await hmac(this.pepper, capability), deviceId: auth.parsed.subjectId, expiresAtMs, usedAt: null });
    return managedResponse(201, { pairingUrl: `${new URL(request.url).origin}/pair#token=${capability}`, expiresAt: new Date(expiresAtMs).toISOString() }, request);
  }

  async desktopTestPush(request) {
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'desktop');
    if (!auth) return errorResponse(401, 'unauthorized', 'Desktop credential is invalid', request);
    if (!await this.rateLimit(`desktop:${auth.parsed.subjectId}`, 120)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const body = await readJson(request, 1024);
    requireExactKeys(body, []);
    const eventId = `evt_test_${randomSecret().slice(0, 22)}`;
    const mobiles = await this.state.storage.list({ prefix: 'mobile:' });
    const stored = { event: { eventId, type: 'token-m.test' }, expiresAtMs: this.now() + EVENT_TTL_MS, deliveries: {} };
    for (const [key, mobile] of mobiles) {
      if (!mobile.revokedAt && mobile.subscription) stored.deliveries[key.slice(7)] = { state: 'pending', attempts: 0 };
    }
    const eventKey = `event:${eventId}`;
    await this.state.storage.put(eventKey, stored);
    const counts = await this.deliver(stored, eventKey, { eventId, title: 'Token M', body: 'Token M notifications are working', url: '/', tag: eventId });
    if (counts.pending) return errorResponse(503, 'push_retry_required', 'Push delivery must be retried', request, { eventId, delivered: counts.delivered, expired: counts.expired, pending: counts.pending });
    if (counts.terminal) return errorResponse(422, 'invalid_subscription', 'A push provider rejected an installation subscription', request, { eventId, delivered: counts.delivered, expired: counts.expired, terminal: counts.terminal });
    return managedResponse(200, { ok: true, eventId, delivered: counts.delivered, expired: counts.expired }, request);
  }

  async desktopDeleteMobile(request, installationId) {
    if (request.method !== 'DELETE') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'desktop');
    if (!auth) return errorResponse(401, 'unauthorized', 'Desktop credential is invalid', request);
    if (!/^mob_[A-Za-z0-9_-]{22}$/.test(installationId)) return errorResponse(400, 'invalid_installation_id', 'Mobile installation id is invalid', request);
    if (!await this.rateLimit(`desktop:${auth.parsed.subjectId}`, 120)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    await this.state.storage.delete(`mobile:${installationId}`);
    return managedResponse(200, { ok: true }, request);
  }

  async redeem(request, tenantId) {
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    if (!await this.rateLimit('redeem', 60)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const body = await readJson(request, 4096);
    requireExactKeys(body, ['token', 'installationName']);
    const parsed = parseCapability(body.token, 'pair');
    const name = boundedString(body.installationName, 'installationName', 80);
    if (!parsed || parsed.tenantId !== tenantId) return errorResponse(400, 'invalid_pairing', 'Pairing token is invalid or expired', request);
    const key = `pair:${parsed.subjectId}`;
    const mac = await hmac(this.pepper, parsed.capability);
    const pair = await this.state.storage.transaction(async (transaction) => {
      const candidate = await transaction.get(key);
      if (!candidate || candidate.usedAt || candidate.expiresAtMs <= this.now() || !timingSafeEqual(mac, candidate.tokenMac)) return null;
      candidate.usedAt = new Date(this.now()).toISOString();
      await transaction.put(key, candidate);
      return candidate;
    });
    if (!pair) return errorResponse(400, 'invalid_pairing', 'Pairing token is invalid or expired', request);
    const mobiles = await this.state.storage.list({ prefix: 'mobile:' });
    if ([...mobiles.values()].filter((value) => !value.revokedAt).length >= MAX_MOBILES) return errorResponse(409, 'installation_limit', 'Mobile installation limit reached', request);
    const installationId = randomId('mob_');
    const capability = `tm_m1.${tenantId}.${installationId}.${randomSecret()}`;
    const createdAt = new Date(this.now()).toISOString();
    await this.state.storage.put(`mobile:${installationId}`, { name, credentialMac: await hmac(this.pepper, capability), subscription: null, permission: 'default', createdAt, lastSeenAt: createdAt, revokedAt: null });
    const desktop = await this.state.storage.get(`device:${pair.deviceId}`);
    return managedResponse(201, { tenantId, installation: { installationId, name }, desktop: { deviceId: pair.deviceId, name: desktop?.name || 'Desktop' }, credential: capability, vapidPublicKey: this.vapidPublicKey }, request);
  }

  async receiveEvent(request) {
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'desktop');
    if (!auth) return errorResponse(401, 'unauthorized', 'Desktop credential is invalid', request);
    if (!await this.rateLimit(`events:${auth.parsed.subjectId}`, 120)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const body = await readJson(request);
    const event = normalizeManagedEvent(body, auth.parsed.subjectId, this.now());
    const key = `event:${event.eventId}`;
    let stored = await this.state.storage.get(key);
    const duplicate = Boolean(stored);
    if (stored && JSON.stringify(stored.event) !== JSON.stringify(event)) return errorResponse(409, 'event_conflict', 'Event id was already used for different content', request);
    if (!stored) {
      const mobiles = await this.state.storage.list({ prefix: 'mobile:' });
      stored = { event, expiresAtMs: this.now() + EVENT_TTL_MS, deliveries: {} };
      for (const [mobileKey, mobile] of mobiles) if (!mobile.revokedAt && mobile.subscription) stored.deliveries[mobileKey.slice(7)] = { state: 'pending', attempts: 0 };
      await this.state.storage.put(key, stored);
    }
    const counts = await this.deliver(stored, key, pushPayload(event));
    if (counts.pending) return errorResponse(503, 'push_retry_required', 'Push delivery must be retried', request, { eventId: event.eventId, duplicate, delivered: counts.delivered, expired: counts.expired, pending: counts.pending });
    if (counts.terminal) return errorResponse(422, 'invalid_subscription', 'A push provider rejected an installation subscription', request, { eventId: event.eventId, duplicate, delivered: counts.delivered, expired: counts.expired, terminal: counts.terminal });
    return managedResponse(200, { ok: true, eventId: event.eventId, duplicate, delivered: counts.delivered, expired: counts.expired }, request);
  }

  async deliver(stored, key, message, onlyInstallationId) {
    await Promise.all(Object.entries(stored.deliveries).map(async ([installationId, delivery]) => {
      if (onlyInstallationId && installationId !== onlyInstallationId) return;
      if (delivery.state !== 'pending') return;
      const mobileKey = `mobile:${installationId}`;
      const mobile = await this.state.storage.get(mobileKey);
      if (!mobile?.subscription || mobile.revokedAt) { delivery.state = 'terminal'; return; }
      delivery.attempts += 1;
      delivery.lastAttemptAt = new Date(this.now()).toISOString();
      const result = await this.push(mobile.subscription, message);
      delivery.lastStatus = result.status;
      if (result.classification === 'delivered') delivery.state = 'delivered';
      else if (result.classification === 'expired') {
        delivery.state = 'expired';
        mobile.subscription = null;
        mobile.permission = 'default';
        await this.state.storage.put(mobileKey, mobile);
      } else if (result.classification === 'terminal') delivery.state = 'terminal';
    }));
    await this.state.storage.put(key, stored);
    const values = Object.values(stored.deliveries);
    return { delivered: values.filter((item) => item.state === 'delivered').length, expired: values.filter((item) => item.state === 'expired').length, pending: values.filter((item) => item.state === 'pending').length, terminal: values.filter((item) => item.state === 'terminal').length };
  }

  async mobileStatus(request) {
    if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'mobile');
    if (!auth) return errorResponse(401, 'unauthorized', 'Mobile credential is invalid', request);
    if (!await this.rateLimit(`mobile:${auth.parsed.subjectId}`, 120)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const devices = await this.state.storage.list({ prefix: 'device:', limit: 1 });
    const [deviceKey, device] = devices.entries().next().value || [];
    return managedResponse(200, { ok: true, desktop: { deviceId: deviceKey?.slice(7) || '', name: device?.name || 'Desktop' }, installation: { installationId: auth.parsed.subjectId, name: auth.record.name, pushEnabled: Boolean(auth.record.subscription) }, vapidPublicKey: this.vapidPublicKey }, request);
  }

  async updateSubscription(request) {
    if (request.method !== 'PUT') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'mobile');
    if (!auth) return errorResponse(401, 'unauthorized', 'Mobile credential is invalid', request);
    if (!await this.rateLimit(`mobile:${auth.parsed.subjectId}`, 120)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const body = await readJson(request, 8192);
    requireExactKeys(body, ['permission', 'subscription']);
    if (body.permission !== 'granted') throw Object.assign(new Error('permission must be granted'), { status: 400, code: 'invalid_permission' });
    auth.record.subscription = validateSubscription(body.subscription);
    auth.record.permission = 'granted';
    auth.record.subscriptionUpdatedAt = new Date(this.now()).toISOString();
    await this.state.storage.put(auth.key, auth.record);
    return managedResponse(200, { ok: true, pushEnabled: true }, request);
  }

  async testPush(request) {
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'mobile');
    if (!auth) return errorResponse(401, 'unauthorized', 'Mobile credential is invalid', request);
    if (!await this.rateLimit(`mobile:${auth.parsed.subjectId}`, 120)) return errorResponse(429, 'rate_limited', 'Too many requests', request);
    const body = await readJson(request, 1024);
    requireExactKeys(body, []);
    if (!auth.record.subscription) return errorResponse(410, 'subscription_expired', 'Push subscription is unavailable', request);
    const eventId = `evt_test_${randomSecret().slice(0, 22)}`;
    const result = await this.push(auth.record.subscription, { eventId, title: 'Token M', body: 'Token M notifications are working', url: '/', tag: eventId });
    if (result.classification === 'expired') {
      auth.record.subscription = null;
      auth.record.permission = 'default';
      await this.state.storage.put(auth.key, auth.record);
      return errorResponse(410, 'subscription_expired', 'Push subscription has expired', request);
    }
    if (result.classification === 'pending') return errorResponse(503, 'push_retry_required', 'Push delivery must be retried', request);
    if (result.classification === 'terminal') return errorResponse(422, 'invalid_subscription', 'Push provider rejected the subscription', request);
    return managedResponse(200, { ok: true, eventId }, request);
  }

  async deleteMobile(request) {
    if (request.method !== 'DELETE') return errorResponse(405, 'method_not_allowed', 'Method not allowed', request);
    const auth = await this.authenticate(request, 'mobile');
    if (!auth) return errorResponse(401, 'unauthorized', 'Mobile credential is invalid', request);
    await this.state.storage.delete(auth.key);
    return managedResponse(200, { ok: true }, request);
  }
};
}

const managedInternals = { hmac, timingSafeEqual, readJson, validateSubscription, PAIR_TTL_MS, EVENT_TTL_MS };

module.exports = { bearerCapability, createTenantDO, managedInternals, normalizeManagedEvent, parseCapability };
