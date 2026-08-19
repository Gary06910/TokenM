'use strict';

const crypto = require('node:crypto');

const EVENT_KEYS = new Set([
  'schemaVersion', 'eventId', 'event', 'desktopId', 'occurredAt',
  'privacyMode', 'sessionId', 'project', 'model', 'summary', 'durationMs',
]);
const CONTENT_KEYS = ['project', 'model', 'summary', 'durationMs'];
const FORBIDDEN_KEYS = new Set([
  'prompt', 'cwd', 'conversation', 'messages', 'sourceCode',
  'lastAssistantResponse', 'turnId', 'transcript', 'environment', 'files',
]);

function opaque(prefix, input) {
  return `${prefix}${crypto.createHash('sha256').update(input).digest('base64url').slice(0, 22)}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function error(statusCode, code) {
  return {
    statusCode,
    headers: { 'cache-control': 'no-store' },
    body: {
      ok: false,
      error: { code, message: '请求无法完成', retryable: false },
      requestId: 'req_contractHarness0001',
    },
  };
}

class ContractModel {
  constructor({ sender, clock, initialQuota = 0 } = {}) {
    this.sender = sender;
    this.clock = clock || { now: () => new Date() };
    this.initialQuota = initialQuota;
    this.usersByOpenId = new Map();
    this.users = new Map();
    this.states = new Map();
    this.pairings = new Map();
    this.grants = new Map();
    this.desktops = new Map();
    this.credentials = new Map();
    this.tasks = new Map();
    this.deliveries = new Map();
    this.sequence = 0;
    this.lane = Promise.resolve();
  }

  _now() {
    return this.clock.now();
  }

  _next(label) {
    this.sequence += 1;
    return `${label}:${this.sequence}`;
  }

  _transaction(operation) {
    const result = this.lane.then(operation, operation);
    this.lane = result.catch(() => undefined);
    return result;
  }

  _ensureUser(openId) {
    let userId = this.usersByOpenId.get(openId);
    if (userId) return this.users.get(userId);
    userId = opaque('usr_', `app:test:${openId}`);
    const now = this._now();
    const user = {
      id: userId,
      ownerId: userId,
      openId,
      status: 'active',
      notificationsEnabled: true,
      historyClearedAt: null,
      createdAt: now,
    };
    this.usersByOpenId.set(openId, userId);
    this.users.set(userId, user);
    this.states.set(userId, {
      available: this.initialQuota,
      reserved: 0,
      grantedTotal: this.initialQuota,
      consumedTotal: 0,
      releasedTotal: 0,
      version: 1,
    });
    return user;
  }

  _quota(userId) {
    const state = this.states.get(userId);
    return {
      available: state.available,
      reserved: state.reserved,
      status: state.available === 0 ? 'empty' : state.available < 4 ? 'low' : 'normal',
    };
  }

  snapshot(userId) {
    const state = structuredClone(this.states.get(userId));
    return {
      state,
      tasks: [...this.tasks.values()].filter((task) => task.ownerId === userId).map((task) => structuredClone(task)),
      deliveries: [...this.deliveries.values()]
        .filter((delivery) => delivery.ownerId === userId)
        .map((delivery) => structuredClone(delivery)),
      desktops: [...this.desktops.values()]
        .filter((desktop) => desktop.ownerId === userId)
        .map((desktop) => structuredClone(desktop)),
    };
  }

  async miniCall(openId, request) {
    return this._transaction(async () => {
      const user = this._ensureUser(openId);
      if (user.status !== 'active') return { ok: false, error: { code: 'unauthorized' } };
      switch (request.action) {
        case 'bootstrap':
        case 'getDashboard':
          return this._dashboard(user, request.requestId);
        case 'createPairingCode':
          return this._createPairingCode(user, request.requestId);
        case 'prepareSubscriptionGrant':
          return this._prepareGrant(user, request.requestId);
        case 'recordSubscriptionOutcome':
          return this._recordGrant(user, request);
        case 'listTasks':
          return this._listTasks(user, request);
        case 'getTask':
          return this._getTask(user, request);
        case 'listDesktops':
          return this._listDesktops(user, request.requestId);
        case 'unbindDesktop':
          return this._unbindDesktop(user, request);
        case 'updateSettings':
          user.notificationsEnabled = request.notificationsEnabled;
          return { ok: true, settings: { notificationsEnabled: user.notificationsEnabled }, requestId: request.requestId };
        case 'clearTaskHistory':
          return this._clearHistory(user, request);
        default:
          return { ok: false, error: { code: 'invalid_request' }, requestId: request.requestId };
      }
    });
  }

  _dashboard(user, requestId) {
    const tasks = this._visibleTasks(user);
    return {
      ok: true,
      user: { id: user.id, createdAt: user.createdAt.toISOString() },
      settings: { notificationsEnabled: user.notificationsEnabled },
      quota: this._quota(user.id),
      desktopCount: [...this.desktops.values()]
        .filter((desktop) => desktop.ownerId === user.id && desktop.status === 'active').length,
      todayCompletedCount: tasks.length,
      recentTasks: tasks.slice(0, 5).map((task) => this._taskSummary(task)),
      requestId,
    };
  }

  _createPairingCode(user, requestId) {
    const now = this._now();
    for (const session of this.pairings.values()) {
      if (session.ownerId === user.id && session.status === 'active') session.status = 'superseded';
    }
    const code = String((100000 + this.sequence * 7919) % 1000000).padStart(6, '0');
    this.sequence += 1;
    const expiresAt = new Date(now.getTime() + 600_000);
    this.pairings.set(code, {
      ownerId: user.id,
      status: 'active',
      attempts: 0,
      expiresAt,
      consumedByDesktopId: null,
    });
    return { ok: true, code, expiresAt: expiresAt.toISOString(), ttlSeconds: 600, requestId };
  }

  _prepareGrant(user, requestId) {
    const id = opaque('grt_', this._next(`grant:${user.id}`));
    const expiresAt = new Date(this._now().getTime() + 300_000);
    this.grants.set(id, { id, ownerId: user.id, status: 'prepared', result: null, expiresAt });
    return { ok: true, grantIntentId: id, templateId: 'synthetic-template-id', expiresAt: expiresAt.toISOString(), requestId };
  }

  _recordGrant(user, request) {
    const grant = this.grants.get(request.grantIntentId);
    if (!grant || grant.ownerId !== user.id) {
      return { ok: false, error: { code: 'grant_intent_used' }, requestId: request.requestId };
    }
    if (grant.expiresAt <= this._now()) {
      return { ok: false, error: { code: 'grant_intent_expired' }, requestId: request.requestId };
    }
    if (grant.status !== 'prepared') {
      return { ok: true, duplicate: true, result: grant.result, quota: this._quota(user.id), requestId: request.requestId };
    }
    grant.result = request.result;
    grant.status = { accept: 'accepted', reject: 'rejected', ban: 'banned', filter: 'filtered' }[request.result];
    if (request.result === 'accept') {
      const state = this.states.get(user.id);
      state.available += 1;
      state.grantedTotal += 1;
      state.version += 1;
    }
    return { ok: true, duplicate: false, result: grant.result, quota: this._quota(user.id), requestId: request.requestId };
  }

  _visibleTasks(user) {
    return [...this.tasks.values()]
      .filter((task) => task.ownerId === user.id)
      .filter((task) => !user.historyClearedAt || task.occurredAt > user.historyClearedAt)
      .sort((a, b) => b.occurredAt - a.occurredAt || b.taskId.localeCompare(a.taskId));
  }

  _taskSummary(task) {
    return {
      taskId: task.taskId,
      desktopId: task.desktopId,
      occurredAt: task.occurredAt.toISOString(),
      privacyMode: task.privacyMode,
      project: task.privacyMode ? null : task.project,
      notificationStatus: task.notificationStatus,
    };
  }

  _listTasks(user, request) {
    const limit = request.limit || 20;
    const start = request.cursor ? Number(Buffer.from(request.cursor, 'base64url').toString()) : 0;
    const tasks = this._visibleTasks(user);
    const items = tasks.slice(start, start + limit).map((task) => this._taskSummary(task));
    const next = start + items.length;
    return {
      ok: true,
      items,
      nextCursor: next < tasks.length ? Buffer.from(String(next)).toString('base64url') : null,
      requestId: request.requestId,
    };
  }

  _getTask(user, request) {
    const task = this.tasks.get(request.taskId);
    if (!task || task.ownerId !== user.id || (user.historyClearedAt && task.occurredAt <= user.historyClearedAt)) {
      return { ok: false, error: { code: 'task_not_found' }, requestId: request.requestId };
    }
    const desktop = this.desktops.get(task.desktopId);
    return {
      ok: true,
      task: {
        taskId: task.taskId,
        desktop: { desktopId: desktop.id, name: desktop.name },
        occurredAt: task.occurredAt.toISOString(),
        privacyMode: task.privacyMode,
        project: task.privacyMode ? null : task.project,
        model: task.privacyMode ? null : task.model,
        summary: task.privacyMode ? null : task.summary,
        durationMs: task.privacyMode ? null : task.durationMs,
        notificationStatus: task.notificationStatus,
      },
      requestId: request.requestId,
    };
  }

  _listDesktops(user, requestId) {
    const items = [...this.desktops.values()]
      .filter((desktop) => desktop.ownerId === user.id)
      .map((desktop) => ({
        desktopId: desktop.id,
        name: desktop.name,
        status: desktop.status,
        createdAt: desktop.createdAt.toISOString(),
        lastSeenAt: desktop.lastSeenAt?.toISOString() || null,
        lastEventAt: desktop.lastEventAt?.toISOString() || null,
      }));
    return { ok: true, items, requestId };
  }

  _unbindDesktop(user, request) {
    const desktop = this.desktops.get(request.desktopId);
    if (!desktop || desktop.ownerId !== user.id || request.confirmation !== 'UNBIND') {
      return { ok: false, error: { code: 'unauthorized' }, requestId: request.requestId };
    }
    const alreadyRevoked = desktop.status === 'revoked';
    desktop.status = 'revoked';
    desktop.credentialHash = null;
    this.credentials.delete(desktop.credential);
    return { ok: true, alreadyRevoked, requestId: request.requestId };
  }

  _clearHistory(user, request) {
    if (request.confirmation !== 'CLEAR') {
      return { ok: false, error: { code: 'invalid_request' }, requestId: request.requestId };
    }
    const deletedCount = this._visibleTasks(user).length;
    user.historyClearedAt = this._now();
    return {
      ok: true,
      clearedAt: user.historyClearedAt.toISOString(),
      deletedCount,
      cleanupPending: deletedCount > 0,
      requestId: request.requestId,
    };
  }

  _authenticate(headers) {
    const header = headers?.authorization || headers?.Authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return null;
    const desktopId = this.credentials.get(match[1]);
    const desktop = desktopId ? this.desktops.get(desktopId) : null;
    return desktop?.status === 'active' ? desktop : null;
  }

  async desktopRequest(request) {
    if (request.path === '/v1/desktop/pair' && request.method === 'POST') {
      return this._transaction(() => this._pair(request));
    }
    return this._transaction(async () => {
      const desktop = this._authenticate(request.headers);
      if (!desktop) return error(401, 'unauthenticated');
      if (request.path === '/v1/desktop/status' && request.method === 'GET') {
        desktop.lastSeenAt = this._now();
        return {
          statusCode: 200,
          headers: { 'cache-control': 'no-store' },
          body: {
            ok: true,
            desktop: {
              desktopId: desktop.id,
              name: desktop.name,
              status: desktop.status,
              lastSeenAt: desktop.lastSeenAt.toISOString(),
              lastEventAt: desktop.lastEventAt?.toISOString() || null,
            },
            serverTime: this._now().toISOString(),
            requestId: 'req_contractHarness0001',
          },
        };
      }
      if (request.path === '/v1/desktop/events' && request.method === 'POST') {
        return this._event(desktop, request.body);
      }
      return error(404, 'invalid_request');
    });
  }

  _pair(request) {
    const session = this.pairings.get(request.body?.code);
    const now = this._now();
    if (!session || session.status !== 'active' || session.expiresAt <= now) {
      return error(404, 'pairing_invalid');
    }
    const desktopId = opaque('dev_', this._next(`desktop:${session.ownerId}`));
    const secret = crypto.createHash('sha256').update(this._next('secret')).digest('base64url');
    const credential = `tm_wx_d1.${desktopId}.${secret}`;
    const desktop = {
      id: desktopId,
      ownerId: session.ownerId,
      name: request.body.deviceName,
      status: 'active',
      credential,
      credentialHash: digest(credential),
      createdAt: now,
      lastSeenAt: null,
      lastEventAt: null,
    };
    this.desktops.set(desktopId, desktop);
    this.credentials.set(credential, desktopId);
    session.status = 'consumed';
    session.consumedByDesktopId = desktopId;
    return {
      statusCode: 201,
      headers: { 'cache-control': 'no-store' },
      body: {
        status: 'paired',
        desktop: { desktopId, name: desktop.name },
        credential,
        requestId: 'req_contractHarness0001',
      },
    };
  }

  _validateEvent(body) {
    if (!body || body.schemaVersion !== 1 || body.event !== 'codex.task.completed') return 'invalid_request';
    const keys = Object.keys(body);
    if (keys.some((key) => FORBIDDEN_KEYS.has(key))) return 'privacy_payload_rejected';
    if (keys.some((key) => !EVENT_KEYS.has(key))) return body.privacyMode ? 'privacy_payload_rejected' : 'invalid_request';
    if (body.privacyMode !== true && body.privacyMode !== false) return 'invalid_request';
    if (body.privacyMode && CONTENT_KEYS.some((key) => body[key] != null)) return 'privacy_payload_rejected';
    if (!body.privacyMode && CONTENT_KEYS.some((key) => body[key] == null)) return 'invalid_request';
    return null;
  }

  _canonicalEvent(body) {
    return {
      schemaVersion: body.schemaVersion,
      eventId: body.eventId,
      event: body.event,
      desktopId: body.desktopId,
      occurredAt: body.occurredAt,
      privacyMode: body.privacyMode,
      sessionId: body.sessionId,
      project: body.project ?? null,
      model: body.model ?? null,
      summary: body.summary ?? null,
      durationMs: body.durationMs ?? null,
    };
  }

  async _event(desktop, body) {
    if (body?.desktopId !== desktop.id) return error(403, 'unauthorized');
    const validation = this._validateEvent(body);
    if (validation) return error(422, validation);
    const occurredAt = new Date(body.occurredAt);
    const now = this._now();
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt > new Date(now.getTime() + 300_000)
      || occurredAt < new Date(now.getTime() - 30 * 86_400_000)) return error(422, 'invalid_request');

    const taskId = opaque('tsk_', `${desktop.id}:${body.eventId}`);
    const canonicalDigest = digest(this._canonicalEvent(body));
    const existing = this.tasks.get(taskId);
    if (existing) {
      if (existing.canonicalDigest !== canonicalDigest) return error(409, 'event_conflict');
      return {
        statusCode: 200,
        headers: { 'cache-control': 'no-store' },
        body: {
          status: 'duplicate',
          taskId,
          notificationStatus: existing.notificationStatus,
          requestId: 'req_contractHarness0001',
        },
      };
    }

    const user = this.users.get(desktop.ownerId);
    const state = this.states.get(desktop.ownerId);
    const task = {
      taskId,
      ownerId: desktop.ownerId,
      desktopId: desktop.id,
      eventId: body.eventId,
      canonicalDigest,
      occurredAt,
      privacyMode: body.privacyMode,
      project: body.project ?? null,
      model: body.model ?? null,
      summary: body.summary ?? null,
      durationMs: body.durationMs ?? null,
      notificationStatus: 'pending',
      notificationDeliveryId: null,
    };
    this.tasks.set(taskId, task);
    desktop.lastEventAt = now;

    if (!user.notificationsEnabled) {
      task.notificationStatus = 'skipped_disabled';
      return this._created(task);
    }
    if (state.available === 0) {
      task.notificationStatus = 'skipped_no_quota';
      return this._created(task);
    }

    state.available -= 1;
    state.reserved += 1;
    state.version += 1;
    const deliveryId = opaque('dly_', `${taskId}:wechat-subscribe:v1`);
    const delivery = {
      deliveryId,
      ownerId: desktop.ownerId,
      taskId,
      desktopId: desktop.id,
      status: 'sending',
      quotaReserved: true,
      attemptCount: 1,
    };
    task.notificationDeliveryId = deliveryId;
    this.deliveries.set(deliveryId, delivery);

    let result;
    try {
      result = await this.sender.send({ taskId, deliveryId, ownerId: desktop.ownerId, privacyMode: body.privacyMode });
    } catch (_error) {
      result = { kind: 'unknown' };
    }
    if (result.kind === 'success' && result.errcode === 0) {
      delivery.status = 'sent';
      task.notificationStatus = 'sent';
      state.reserved -= 1;
      state.consumedTotal += 1;
    } else if (result.kind === 'failure') {
      delivery.status = 'failed';
      task.notificationStatus = 'failed';
      state.reserved -= 1;
      state.available += 1;
      state.releasedTotal += 1;
    } else {
      delivery.status = 'unknown';
      task.notificationStatus = 'unknown';
    }
    state.version += 1;
    return this._created(task);
  }

  _created(task) {
    return {
      statusCode: 201,
      headers: { 'cache-control': 'no-store' },
      body: {
        status: 'created',
        taskId: task.taskId,
        notificationStatus: task.notificationStatus,
        requestId: 'req_contractHarness0001',
      },
    };
  }
}

module.exports = { ContractModel };
