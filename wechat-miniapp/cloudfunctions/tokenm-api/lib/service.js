'use strict';

const crypto = require('node:crypto');
const { normalizeEventPayload } = require('./domain/event');
const {
  asDate,
  desktopDto,
  iso,
  makeNotificationState,
  quotaDto,
  taskDto,
  taskSummaryDto,
  validateState
} = require('./domain/model');
const { AppError } = require('./errors');
const {
  credential,
  decodeCursor,
  deterministicId,
  encodeCursor,
  hmacHex,
  pairingCode,
  parseCredential,
  randomId,
  sanitizeDeviceName,
  timingSafeHexEqual,
  truncateId
} = require('./security');
const { classifyProviderError, classifyProviderResult, describeProviderError } = require('./sender');

const COLLECTIONS = {
  users: 'users',
  desktops: 'desktops',
  pairs: 'pairingSessions',
  tasks: 'tasks',
  states: 'notificationState',
  grants: 'subscriptionGrants',
  deliveries: 'notificationDeliveries',
  security: 'securityEvents',
  rates: 'rateLimits'
};

function createService(dependencies) {
  const {
    repo,
    sender,
    config,
    clock = () => new Date(),
    randomBytes = crypto.randomBytes,
    randomInt = crypto.randomInt,
    logger = { info() {}, warn() {}, error() {} }
  } = dependencies;

  function now() {
    const value = asDate(clock());
    if (Number.isNaN(value.getTime())) throw new Error('invalid injected clock');
    return value;
  }

  function ownerIdFor(appId, openid) {
    if (typeof appId !== 'string' || !appId || typeof openid !== 'string' || !openid) throw new AppError('unauthenticated');
    return deterministicId('usr_', `${appId}:${openid}`);
  }

  async function writeSecurity(fields) {
    const createdAt = now();
    const document = {
      _id: randomId('sec_', randomBytes),
      ownerId: fields.ownerId || null,
      subjectId: fields.subjectId ? truncateId(fields.subjectId) : null,
      type: fields.type,
      outcome: fields.outcome || 'denied',
      reason: fields.reason,
      requestId: fields.requestId,
      networkFingerprint: fields.networkFingerprint || null,
      createdAt
    };
    try {
      await repo.set(COLLECTIONS.security, document._id, document);
    } catch {
      logger.error({ requestId: fields.requestId, code: 'security_event_write_failed' });
    }
  }

  async function consumeRate(route, subject, limit, windowMs, requestId) {
    const timestamp = now();
    const bucket = Math.floor(timestamp.getTime() / windowMs);
    const fingerprint = hmacHex(config.pairingPepper, `rate:${route}:${subject}`).slice(0, 24);
    const id = `rl_${route.replace(/[^a-z0-9_-]/giu, '_')}_${bucket}_${fingerprint}`;
    const result = await repo.transaction(async (tx) => {
      const current = await tx.get(COLLECTIONS.rates, id);
      const count = (current?.count || 0) + 1;
      const document = {
        _id: id,
        count,
        limit,
        expiresAt: new Date((bucket + 1) * windowMs),
        createdAt: current?.createdAt || timestamp,
        updatedAt: timestamp
      };
      await tx.set(COLLECTIONS.rates, id, document);
      return { allowed: count <= limit, fingerprint };
    });
    if (!result.allowed) {
      await writeSecurity({ type: 'rate_limited', reason: 'rate_limited', requestId, networkFingerprint: result.fingerprint });
      throw new AppError('rate_limited');
    }
  }

  async function bootstrap(identity) {
    const timestamp = now();
    const ownerId = ownerIdFor(identity.appId, identity.openid);
    const result = await repo.transaction(async (tx) => {
      let user = await tx.get(COLLECTIONS.users, ownerId);

      if (!user) {
        user = {
          _id: ownerId,
          ownerId,
          wechatOpenid: identity.openid,
          appId: identity.appId,
          status: 'active',
          notificationsEnabled: true,
          historyClearedAt: null,
          deletionRequestedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        await tx.set(COLLECTIONS.users, ownerId, user);
      }

      if (user.status !== 'active') throw new AppError('unauthorized');

      let state = await tx.get(COLLECTIONS.states, ownerId);

      if (!state) {
        state = makeNotificationState(ownerId, config.initialQuota, timestamp);
        await tx.set(COLLECTIONS.states, ownerId, state);
      }

      return { user, state };
    });

    const dashboard = await dashboardFor(ownerId, result.user, result.state);

    return {
      user: {
        id: ownerId,
        createdAt: iso(result.user.createdAt)
      },
      ...dashboard
    };
  }

  async function requireUser(identity, { allowDeleting = false } = {}) {
    const ownerId = ownerIdFor(identity.appId, identity.openid);
    const user = await repo.get(COLLECTIONS.users, ownerId);
    if (!user || (user.status !== 'active' && !(allowDeleting && user.status === 'deleting'))) throw new AppError('unauthorized');
    return user;
  }

  async function loadDesktopMap(ownerId, tasks) {
    const ids = [...new Set(tasks.map((task) => task.desktopId))];
    const pairs = await Promise.all(ids.map(async (id) => [id, await repo.get(COLLECTIONS.desktops, id)]));
    return new Map(pairs.filter(([, value]) => value?.ownerId === ownerId));
  }

  function visibleTaskSpec(user, extra = {}) {
    const spec = { ...extra, where: { ...(extra.where || {}), ownerId: user._id } };
    if (user.historyClearedAt) spec.gt = { ...(spec.gt || {}), occurredAt: user.historyClearedAt };
    return spec;
  }

  async function dashboardFor(ownerId, knownUser, knownState) {
    const user = knownUser || await repo.get(COLLECTIONS.users, ownerId);
    if (!user || user.status !== 'active') throw new AppError('unauthorized');
    const state = knownState || await repo.get(COLLECTIONS.states, ownerId);
    if (!state) throw new Error('notification state missing');
    validateState(state);
    const desktopCount = await repo.count(COLLECTIONS.desktops, { where: { ownerId, status: 'active' } });
    const recent = await repo.query(COLLECTIONS.tasks, visibleTaskSpec(user, {
      orderBy: [['occurredAt', 'desc'], ['_id', 'desc']],
      limit: 5
    }));
    const startToday = now();
    startToday.setUTCHours(0, 0, 0, 0);
    const todayCompletedCount = await repo.count(COLLECTIONS.tasks, visibleTaskSpec(user, { gte: { occurredAt: startToday } }));
    const desktopMap = await loadDesktopMap(ownerId, recent);
    return {
      settings: { notificationsEnabled: user.notificationsEnabled },
      quota: quotaDto(state),
      desktopCount,
      todayCompletedCount,
      recentTasks: recent.map((task) => taskSummaryDto(task, desktopMap.get(task.desktopId)))
    };
  }

  async function getDashboard(identity) {
    const user = await requireUser(identity);
    return dashboardFor(user._id, user);
  }

  async function listTasks(identity, { cursor = null, limit = 20 } = {}) {
    const user = await requireUser(identity);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new AppError('invalid_request');
    let before;
    if (cursor !== null && cursor !== undefined) {
      const decoded = decodeCursor(cursor, config.cursorKey);
      const cursorDate = new Date(decoded.occurredAt);
      if (Number.isNaN(cursorDate.getTime()) || !/^tsk_[A-Za-z0-9_-]{22}$/u.test(decoded.taskId)) throw new AppError('invalid_request');
      before = { dateField: 'occurredAt', idField: '_id', date: cursorDate, id: decoded.taskId };
    }
    const tasks = await repo.query(COLLECTIONS.tasks, visibleTaskSpec(user, {
      before,
      orderBy: [['occurredAt', 'desc'], ['_id', 'desc']],
      limit: limit + 1
    }));
    const page = tasks.slice(0, limit);
    const desktopMap = await loadDesktopMap(user._id, page);
    const last = page[page.length - 1];
    return {
      items: page.map((task) => taskSummaryDto(task, desktopMap.get(task.desktopId))),
      nextCursor: tasks.length > limit && last ? encodeCursor({ occurredAt: iso(last.occurredAt), taskId: last._id }, config.cursorKey) : null
    };
  }

  async function getTask(identity, taskId) {
    if (typeof taskId !== 'string' || !/^tsk_[A-Za-z0-9_-]{22}$/u.test(taskId)) throw new AppError('task_not_found');
    const user = await requireUser(identity);
    const task = await repo.get(COLLECTIONS.tasks, taskId);
    if (!task || task.ownerId !== user._id || (user.historyClearedAt && asDate(task.occurredAt) <= asDate(user.historyClearedAt))) throw new AppError('task_not_found');
    const desktop = await repo.get(COLLECTIONS.desktops, task.desktopId);
    return taskDto(task, desktop?.ownerId === user._id ? desktop : null);
  }

  async function listDesktops(identity) {
    const user = await requireUser(identity);
    const items = await repo.query(COLLECTIONS.desktops, {
      where: { ownerId: user._id },
      orderBy: [['createdAt', 'desc']],
      limit: 100
    });
    return { items: items.map(desktopDto) };
  }

  async function createPairingCode(identity, requestId) {
    const user = await requireUser(identity);
    await consumeRate('pair_create', user._id, config.pairRateLimit, config.pairRateWindowMs, requestId);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = pairingCode(randomInt);
      const pairId = `pair_${hmacHex(config.pairingPepper, code)}`;
      const timestamp = now();
      const expiresAt = new Date(timestamp.getTime() + config.pairingTtlMs);
      const result = await repo.transaction(async (tx) => {
        if (await tx.get(COLLECTIONS.pairs, pairId)) return { collision: true };
        const active = await tx.query(COLLECTIONS.pairs, { where: { ownerId: user._id, status: 'active' }, limit: 20 });
        for (const old of active) {
          old.status = 'superseded';
          old.supersededAt = timestamp;
          old.updatedAt = timestamp;
          await tx.set(COLLECTIONS.pairs, old._id, old);
        }
        await tx.set(COLLECTIONS.pairs, pairId, {
          _id: pairId,
          ownerId: user._id,
          status: 'active',
          attempts: 0,
          expiresAt,
          consumedAt: null,
          consumedByDesktopId: null,
          supersededAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        return { collision: false };
      });
      if (!result.collision) return { code, expiresAt: iso(expiresAt), ttlSeconds: config.pairingTtlMs / 1000 };
    }
    throw new AppError('internal_error');
  }

  async function claimPairing({ code, deviceName, networkSubject, requestId }) {
    await consumeRate('pair_claim', networkSubject, config.pairRateLimit, config.pairRateWindowMs, requestId);
    if (typeof code !== 'string' || !/^\d{6}$/u.test(code)) {
      await writeSecurity({ type: 'pair_failed', reason: 'pairing_invalid', requestId });
      throw new AppError('pairing_invalid');
    }
    const name = sanitizeDeviceName(deviceName);
    const pairId = `pair_${hmacHex(config.pairingPepper, code)}`;
    const desktopId = randomId('dev_', randomBytes);
    const issued = credential(desktopId, randomBytes);
    const credentialHash = hmacHex(config.devicePepper, issued.secret);
    const timestamp = now();
    const result = await repo.transaction(async (tx) => {
      const session = await tx.get(COLLECTIONS.pairs, pairId);
      if (!session) return { invalid: true };
      if (session.status !== 'active' || asDate(session.expiresAt) <= timestamp || session.attempts >= config.pairingSessionMaxAttempts) {
        session.attempts = Math.min(config.pairingSessionMaxAttempts, (session.attempts || 0) + 1);
        if (session.status === 'active' && asDate(session.expiresAt) <= timestamp) session.status = 'expired';
        if (session.status === 'active' && session.attempts >= config.pairingSessionMaxAttempts) session.status = 'locked';
        session.updatedAt = timestamp;
        await tx.set(COLLECTIONS.pairs, session._id, session);
        return { invalid: true, ownerId: session.ownerId };
      }
      const user = await tx.get(COLLECTIONS.users, session.ownerId);
      if (!user || user.status !== 'active' || await tx.get(COLLECTIONS.desktops, desktopId)) return { invalid: true, ownerId: session.ownerId };
      const desktop = {
        _id: desktopId,
        ownerId: session.ownerId,
        name,
        status: 'active',
        credentialVersion: 1,
        credentialHash,
        credentialIssuedAt: timestamp,
        revokedAt: null,
        lastSeenAt: timestamp,
        lastEventAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await tx.set(COLLECTIONS.desktops, desktopId, desktop);
      session.status = 'consumed';
      session.consumedAt = timestamp;
      session.consumedByDesktopId = desktopId;
      session.updatedAt = timestamp;
      await tx.set(COLLECTIONS.pairs, session._id, session);
      return { invalid: false, desktop };
    });
    if (result.invalid) {
      await writeSecurity({ type: 'pair_failed', reason: 'pairing_invalid', requestId, ownerId: result.ownerId });
      throw new AppError('pairing_invalid');
    }
    return { desktop: { desktopId, name }, credential: issued.plaintext };
  }

  async function authenticate(rawCredential, requestId) {
    const parsed = parseCredential(rawCredential);
    if (!parsed) {
      await writeSecurity({ type: 'auth_failed', reason: 'unauthenticated', requestId });
      throw new AppError('unauthenticated');
    }
    const desktop = await repo.get(COLLECTIONS.desktops, parsed.desktopId);
    const candidate = hmacHex(config.devicePepper, parsed.secret);
    if (!desktop || desktop.status !== 'active' || !timingSafeHexEqual(candidate, desktop.credentialHash)) {
      await writeSecurity({ type: 'auth_failed', reason: 'unauthenticated', requestId, ownerId: desktop?.ownerId, subjectId: parsed.desktopId });
      throw new AppError('unauthenticated');
    }
    const user = await repo.get(COLLECTIONS.users, desktop.ownerId);
    if (!user || user.status !== 'active') {
      await writeSecurity({ type: 'auth_failed', reason: 'unauthenticated', requestId, ownerId: desktop.ownerId, subjectId: parsed.desktopId });
      throw new AppError('unauthenticated');
    }
    return { desktop, credentialHash: candidate };
  }

  async function getDesktopStatus(rawCredential, requestId) {
    const auth = await authenticate(rawCredential, requestId);
    await consumeRate('desktop_status', auth.desktop._id, config.statusRateLimit, 60000, requestId);
    const timestamp = now();
    const desktop = await repo.transaction(async (tx) => {
      const current = await tx.get(COLLECTIONS.desktops, auth.desktop._id);
      if (!current || current.status !== 'active' || !timingSafeHexEqual(auth.credentialHash, current.credentialHash)) throw new AppError('unauthenticated');
      current.lastSeenAt = timestamp;
      current.updatedAt = timestamp;
      await tx.set(COLLECTIONS.desktops, current._id, current);
      return current;
    });
    return { desktop: desktopDto(desktop), serverTime: iso(timestamp) };
  }

  async function renameDesktop(identity, desktopId, name) {
    const user = await requireUser(identity);
    const cleaned = sanitizeDeviceName(name);
    const timestamp = now();
    const desktop = await repo.transaction(async (tx) => {
      const current = await tx.get(COLLECTIONS.desktops, desktopId);
      if (!current || current.ownerId !== user._id || current.status !== 'active') throw new AppError('unauthorized');
      current.name = cleaned;
      current.updatedAt = timestamp;
      await tx.set(COLLECTIONS.desktops, current._id, current);
      return current;
    });
    return { desktop: desktopDto(desktop) };
  }

  async function revokeDesktopByOwner(identity, desktopId, requestId) {
    const user = await requireUser(identity);
    const timestamp = now();
    const result = await repo.transaction(async (tx) => {
      const desktop = await tx.get(COLLECTIONS.desktops, desktopId);
      if (!desktop || desktop.ownerId !== user._id) throw new AppError('unauthorized');
      if (desktop.status === 'revoked') return { desktop, alreadyRevoked: true };
      desktop.status = 'revoked';
      desktop.credentialHash = null;
      desktop.revokedAt = timestamp;
      desktop.updatedAt = timestamp;
      await tx.set(COLLECTIONS.desktops, desktop._id, desktop);
      return { desktop, alreadyRevoked: false };
    });
    if (!result.alreadyRevoked) await writeSecurity({ type: 'desktop_revoked', outcome: 'allowed', reason: 'owner_unbind', ownerId: user._id, subjectId: desktopId, requestId });
    return { desktop: desktopDto(result.desktop), alreadyRevoked: result.alreadyRevoked };
  }

  async function unpairSelf(rawCredential, requestId) {
    const auth = await authenticate(rawCredential, requestId);
    const timestamp = now();
    await repo.transaction(async (tx) => {
      const desktop = await tx.get(COLLECTIONS.desktops, auth.desktop._id);
      if (!desktop || desktop.status !== 'active' || !timingSafeHexEqual(auth.credentialHash, desktop.credentialHash)) throw new AppError('unauthenticated');
      desktop.status = 'revoked';
      desktop.credentialHash = null;
      desktop.revokedAt = timestamp;
      desktop.updatedAt = timestamp;
      await tx.set(COLLECTIONS.desktops, desktop._id, desktop);
    });
    await writeSecurity({ type: 'desktop_revoked', outcome: 'allowed', reason: 'self_unpair', ownerId: auth.desktop.ownerId, subjectId: auth.desktop._id, requestId });
    return { alreadyRevoked: false };
  }

  async function prepareSubscriptionGrant(identity, requestId) {
    const user = await requireUser(identity);
    await consumeRate('grant_prepare', user._id, config.grantRateLimit, config.grantRateWindowMs, requestId);
    const timestamp = now();
    const expiresAt = new Date(timestamp.getTime() + config.grantTtlMs);
    const grant = {
      _id: randomId('grt_', randomBytes),
      ownerId: user._id,
      templateIdHash: config.templateIdHash,
      status: 'prepared',
      result: null,
      expiresAt,
      consumedAt: null,
      clientRequestId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await repo.set(COLLECTIONS.grants, grant._id, grant);
    return { grantIntentId: grant._id, templateId: config.templateId, expiresAt: iso(expiresAt) };
  }

  async function recordSubscriptionOutcome(identity, grantIntentId, result, requestId) {
    const user = await requireUser(identity);
    if (!['accept', 'reject', 'ban', 'filter'].includes(result) || typeof grantIntentId !== 'string' || !/^grt_[A-Za-z0-9_-]{22}$/u.test(grantIntentId)) throw new AppError('invalid_request');
    const timestamp = now();
    const outcome = await repo.transaction(async (tx) => {
      const grant = await tx.get(COLLECTIONS.grants, grantIntentId);
      if (!grant || grant.ownerId !== user._id || grant.templateIdHash !== config.templateIdHash) throw new AppError('unauthorized');
      if (grant.status !== 'prepared') return { duplicate: true, result: grant.result };
      if (asDate(grant.expiresAt) <= timestamp) {
        grant.status = 'expired';
        grant.updatedAt = timestamp;
        await tx.set(COLLECTIONS.grants, grant._id, grant);
        return { expired: true };
      }
      grant.status = { accept: 'accepted', reject: 'rejected', ban: 'banned', filter: 'filtered' }[result];
      grant.result = result;
      grant.consumedAt = timestamp;
      grant.clientRequestId = requestId;
      grant.updatedAt = timestamp;
      await tx.set(COLLECTIONS.grants, grant._id, grant);
      if (result === 'accept') {
        const state = await tx.get(COLLECTIONS.states, user._id);
        if (!state) throw new Error('notification state missing');
        validateState(state);
        state.available += 1;
        state.grantedTotal += 1;
        state.version += 1;
        state.lastGrantAt = timestamp;
        state.updatedAt = timestamp;
        validateState(state);
        await tx.set(COLLECTIONS.states, state._id, state);
      }
      return { duplicate: false, result };
    });
    if (outcome.expired) throw new AppError('grant_intent_expired');
    return outcome;
  }

  async function updateSettings(identity, notificationsEnabled) {
    if (typeof notificationsEnabled !== 'boolean') throw new AppError('invalid_request');
    const user = await requireUser(identity);
    const timestamp = now();
    await repo.transaction(async (tx) => {
      const current = await tx.get(COLLECTIONS.users, user._id);
      if (!current || current.status !== 'active') throw new AppError('unauthorized');
      current.notificationsEnabled = notificationsEnabled;
      current.updatedAt = timestamp;
      await tx.set(COLLECTIONS.users, current._id, current);
    });
    return { settings: { notificationsEnabled } };
  }

  async function markDeliveryUnknown(deliveryId, taskId, timestamp, reason) {
    try {
      await repo.transaction(async (tx) => {
        const delivery = await tx.get(COLLECTIONS.deliveries, deliveryId);
        const task = await tx.get(COLLECTIONS.tasks, taskId);
        if (!delivery || !task || !['sending', 'claimed'].includes(delivery.status)) return;
        delivery.status = 'unknown';
        delivery.providerErrmsgCode = reason;
        delivery.finishedAt = timestamp;
        delivery.updatedAt = timestamp;
        task.notificationStatus = 'unknown';
        task.updatedAt = timestamp;
        await tx.set(COLLECTIONS.deliveries, delivery._id, delivery);
        await tx.set(COLLECTIONS.tasks, task._id, task);
      });
    } catch {
      logger.error({ code: 'unknown_persistence_failed', subjectId: truncateId(taskId) });
    }
  }

  async function finalizeDelivery(deliveryId, taskId, provider, timestamp) {
    await repo.transaction(async (tx) => {
      const delivery = await tx.get(COLLECTIONS.deliveries, deliveryId);
      const task = await tx.get(COLLECTIONS.tasks, taskId);
      if (!delivery || !task || delivery.status !== 'sending' || delivery.attemptCount !== 1) return;
      const state = await tx.get(COLLECTIONS.states, delivery.ownerId);
      if (!state) throw new Error('notification state missing');
      validateState(state);
      delivery.status = provider.status;
      delivery.providerErrcode = provider.errcode;
      delivery.providerErrmsgCode = provider.errmsgCode;
      delivery.finishedAt = timestamp;
      delivery.updatedAt = timestamp;
      task.notificationStatus = provider.status;
      task.updatedAt = timestamp;
      if (provider.status === 'sent') {
        if (state.reserved < 1) throw new Error('missing quota reservation');
        state.reserved -= 1;
        state.consumedTotal += 1;
        state.lastConsumedAt = timestamp;
      } else if (provider.status === 'failed') {
        if (state.reserved < 1) throw new Error('missing quota reservation');
        state.reserved -= 1;
        state.available += 1;
        state.releasedTotal += 1;
      }
      state.version += 1;
      state.updatedAt = timestamp;
      validateState(state);
      await tx.set(COLLECTIONS.deliveries, delivery._id, delivery);
      await tx.set(COLLECTIONS.tasks, task._id, task);
      await tx.set(COLLECTIONS.states, state._id, state);
    });
  }

  async function createEvent(rawCredential, payload, requestId) {
    const auth = await authenticate(rawCredential, requestId);
    await consumeRate('desktop_event', auth.desktop._id, config.eventRateLimit, 60000, requestId);
    const timestamp = now();
    let parsed;
    try {
      parsed = normalizeEventPayload(payload, timestamp);
    } catch (error) {
      await writeSecurity({ type: 'event_rejected', reason: error.code || 'invalid_request', requestId, ownerId: auth.desktop.ownerId, subjectId: auth.desktop._id });
      throw error;
    }
    if (parsed.normalized.desktopId !== auth.desktop._id) {
      await writeSecurity({ type: 'event_rejected', reason: 'unauthorized', requestId, ownerId: auth.desktop.ownerId, subjectId: auth.desktop._id });
      throw new AppError('unauthorized');
    }
    const taskId = deterministicId('tsk_', `${auth.desktop._id}:${parsed.normalized.eventId}`);
    const deliveryId = deterministicId('dly_', `${taskId}:wechat-subscribe:v1`);
    const created = await repo.transaction(async (tx) => {
      const desktop = await tx.get(COLLECTIONS.desktops, auth.desktop._id);
      if (!desktop || desktop.status !== 'active' || !timingSafeHexEqual(auth.credentialHash, desktop.credentialHash)) throw new AppError('unauthenticated');
      const user = await tx.get(COLLECTIONS.users, desktop.ownerId);
      if (!user || user.status !== 'active') throw new AppError('unauthorized');
      const existing = await tx.get(COLLECTIONS.tasks, taskId);
      if (existing) {
        if (existing.canonicalDigest !== parsed.digest) return { conflict: true, ownerId: desktop.ownerId };
        return { duplicate: true, task: existing };
      }
      const state = await tx.get(COLLECTIONS.states, desktop.ownerId);
      if (!state) throw new Error('notification state missing');
      validateState(state);
      let notificationStatus = 'pending';
      let taskDeliveryId = deliveryId;
      if (!user.notificationsEnabled) {
        notificationStatus = 'skipped_disabled';
        taskDeliveryId = null;
      } else if (state.available < 1) {
        notificationStatus = 'skipped_no_quota';
        taskDeliveryId = null;
      }
      const task = {
        _id: taskId,
        ownerId: desktop.ownerId,
        desktopId: desktop._id,
        eventId: parsed.normalized.eventId,
        canonicalDigest: parsed.digest,
        schemaVersion: 1,
        event: parsed.normalized.event,
        sessionId: parsed.normalized.sessionId,
        occurredAt: parsed.occurredAt,
        privacyMode: parsed.normalized.privacyMode,
        project: parsed.normalized.project,
        model: parsed.normalized.model,
        summary: parsed.normalized.summary,
        durationMs: parsed.normalized.durationMs,
        notificationStatus,
        notificationDeliveryId: taskDeliveryId,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await tx.set(COLLECTIONS.tasks, taskId, task);
      desktop.lastSeenAt = timestamp;
      desktop.lastEventAt = timestamp;
      desktop.updatedAt = timestamp;
      await tx.set(COLLECTIONS.desktops, desktop._id, desktop);
      if (notificationStatus === 'pending') {
        state.available -= 1;
        state.reserved += 1;
        state.version += 1;
        state.updatedAt = timestamp;
        validateState(state);
        await tx.set(COLLECTIONS.states, state._id, state);
        await tx.set(COLLECTIONS.deliveries, deliveryId, {
          _id: deliveryId,
          ownerId: desktop.ownerId,
          taskId,
          desktopId: desktop._id,
          channel: 'wechat_subscribe',
          templateIdHash: config.templateIdHash,
          status: 'claimed',
          quotaReserved: true,
          attemptCount: 0,
          providerAttemptId: null,
          providerErrcode: null,
          providerErrmsgCode: null,
          miniprogramState: config.miniprogramState,
          claimedAt: timestamp,
          sendingAt: null,
          finishedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }
      return { duplicate: false, conflict: false, task, desktop, openid: user.wechatOpenid };
    });
    if (created.conflict) {
      await writeSecurity({ type: 'event_rejected', reason: 'event_conflict', requestId, ownerId: created.ownerId, subjectId: taskId });
      throw new AppError('event_conflict');
    }
    if (created.duplicate) return { status: 'duplicate', taskId, notificationStatus: created.task.notificationStatus };
    if (created.task.notificationStatus !== 'pending') return { status: 'created', taskId, notificationStatus: created.task.notificationStatus };

    const claimTime = now();
    const providerAttemptId = await repo.transaction(async (tx) => {
      const delivery = await tx.get(COLLECTIONS.deliveries, deliveryId);
      if (!delivery || delivery.status !== 'claimed' || delivery.attemptCount !== 0) return null;
      delivery.status = 'sending';
      delivery.attemptCount = 1;
      delivery.providerAttemptId = randomId('att_', randomBytes);
      delivery.sendingAt = claimTime;
      delivery.updatedAt = claimTime;
      await tx.set(COLLECTIONS.deliveries, delivery._id, delivery);
      return delivery.providerAttemptId;
    });
    if (!providerAttemptId) {
      const task = await repo.get(COLLECTIONS.tasks, taskId);
      return { status: 'created', taskId, notificationStatus: task?.notificationStatus || 'unknown' };
    }

    let provider;
    try {
      provider = classifyProviderResult(await sender.send({ openid: created.openid, task: created.task, desktop: created.desktop }));
    } catch (error) {
      provider = classifyProviderError(error);
      if (provider.status === 'unknown') {
        const diagnostic = describeProviderError(error);
        logger.warn({
          event: 'wechat_provider_throw_unclassified',
          code: provider.errmsgCode,
          classificationBranch: provider.classificationBranch || 'throw_unclassified',
          outerCode: provider.outerCode,
          requestId,
          subjectId: truncateId(deliveryId),
          providerAttemptId,
          errorNameSafe: diagnostic.errorNameSafe,
          providerErrorShape: diagnostic.fields,
          upstreamEvidence: diagnostic.upstreamEvidence
        });
      }
    }
    const finishTime = now();
    if (provider.status === 'unknown') {
      await markDeliveryUnknown(deliveryId, taskId, finishTime, provider.errmsgCode);
    } else {
      try {
        await finalizeDelivery(deliveryId, taskId, provider, finishTime);
      } catch {
        provider = { status: 'unknown', errcode: null, errmsgCode: 'finalize_uncertain' };
        await markDeliveryUnknown(deliveryId, taskId, finishTime, provider.errmsgCode);
      }
    }
    return { status: 'created', taskId, notificationStatus: provider.status };
  }

  async function clearTaskHistory(identity) {
    const user = await requireUser(identity);
    const clearedAt = now();
    await repo.transaction(async (tx) => {
      const current = await tx.get(COLLECTIONS.users, user._id);
      if (!current || current.status !== 'active') throw new AppError('unauthorized');
      current.historyClearedAt = clearedAt;
      current.updatedAt = clearedAt;
      await tx.set(COLLECTIONS.users, current._id, current);
    });
    const tasks = await repo.query(COLLECTIONS.tasks, {
      where: { ownerId: user._id },
      lte: { occurredAt: clearedAt },
      orderBy: [['occurredAt', 'asc']],
      limit: config.cleanupBatchSize
    });
    const batch = tasks;
    let deferred = 0;
    let deletedCount = 0;
    for (const task of batch) {
      const delivery = task.notificationDeliveryId ? await repo.get(COLLECTIONS.deliveries, task.notificationDeliveryId) : null;
      if (delivery && ['sending', 'unknown'].includes(delivery.status)) {
        deferred += 1;
        continue;
      }
      if (task.notificationDeliveryId) await repo.delete(COLLECTIONS.deliveries, task.notificationDeliveryId);
      await repo.delete(COLLECTIONS.tasks, task._id);
      deletedCount += 1;
    }
    const remaining = await repo.query(COLLECTIONS.tasks, { where: { ownerId: user._id }, lte: { occurredAt: clearedAt }, limit: 1 });
    return { clearedAt: iso(clearedAt), deletedCount, cleanupPending: remaining.length > 0 || deferred > 0 };
  }

  async function cleanupAccount(ownerId) {
    let budget = config.cleanupBatchSize;
    const collections = [COLLECTIONS.tasks, COLLECTIONS.deliveries, COLLECTIONS.grants, COLLECTIONS.pairs, COLLECTIONS.states, COLLECTIONS.desktops];
    for (const collection of collections) {
      if (budget <= 0) break;
      const documents = await repo.query(collection, { where: collection === COLLECTIONS.states ? { _id: ownerId } : { ownerId }, limit: budget });
      for (const document of documents) await repo.delete(collection, document._id);
      budget -= documents.length;
    }
    let pending = false;
    for (const collection of collections) {
      const remaining = await repo.query(collection, { where: collection === COLLECTIONS.states ? { _id: ownerId } : { ownerId }, limit: 1 });
      if (remaining.length) {
        pending = true;
        break;
      }
    }
    if (!pending) await repo.delete(COLLECTIONS.users, ownerId);
    return pending;
  }

  async function deleteAccount(identity, requestId) {
    const user = await requireUser(identity, { allowDeleting: true });
    const deletionRequestedAt = user.deletionRequestedAt ? asDate(user.deletionRequestedAt) : now();
    if (user.status === 'active') {
      await repo.transaction(async (tx) => {
        const current = await tx.get(COLLECTIONS.users, user._id);
        if (!current) throw new AppError('unauthorized');
        current.status = 'deleting';
        current.deletionRequestedAt = deletionRequestedAt;
        current.updatedAt = deletionRequestedAt;
        await tx.set(COLLECTIONS.users, current._id, current);
        const desktops = await tx.query(COLLECTIONS.desktops, { where: { ownerId: user._id }, limit: 100 });
        for (const desktop of desktops) {
          desktop.status = 'revoked';
          desktop.credentialHash = null;
          desktop.revokedAt = desktop.revokedAt || deletionRequestedAt;
          desktop.updatedAt = deletionRequestedAt;
          await tx.set(COLLECTIONS.desktops, desktop._id, desktop);
        }
      });
      await writeSecurity({ type: 'account_delete_requested', outcome: 'allowed', reason: 'user_requested', ownerId: user._id, requestId });
    }
    const cleanupPending = await cleanupAccount(user._id);
    return { deletionRequestedAt: iso(deletionRequestedAt), cleanupPending };
  }

  async function reconcileUnknown(deliveryId, outcome) {
    if (!['sent', 'failed'].includes(outcome)) throw new AppError('invalid_request');
    const delivery = await repo.get(COLLECTIONS.deliveries, deliveryId);
    if (!delivery || delivery.status !== 'unknown') return { changed: false };
    const changed = await repo.transaction(async (tx) => {
      const current = await tx.get(COLLECTIONS.deliveries, deliveryId);
      const task = current && await tx.get(COLLECTIONS.tasks, current.taskId);
      const state = current && await tx.get(COLLECTIONS.states, current.ownerId);
      if (!current || current.status !== 'unknown' || current.providerErrmsgCode !== 'provider_call_uncertain' || !task || !state) return false;
      if (task.ownerId !== current.ownerId || state._id !== current.ownerId || current.quotaReserved !== true) throw new Error('reconciliation ownership mismatch');
      validateState(state);
      if (state.reserved < 1) throw new Error('missing quota reservation');
      state.reserved -= 1;
      if (outcome === 'sent') {
        state.consumedTotal += 1;
        state.lastConsumedAt = now();
      } else {
        state.available += 1;
        state.releasedTotal += 1;
      }
      state.version += 1;
      state.updatedAt = now();
      current.status = outcome;
      current.providerErrmsgCode = 'reconciled';
      current.updatedAt = now();
      current.finishedAt = now();
      task.notificationStatus = outcome;
      task.updatedAt = now();
      validateState(state);
      await tx.set(COLLECTIONS.states, state._id, state);
      await tx.set(COLLECTIONS.deliveries, current._id, current);
      await tx.set(COLLECTIONS.tasks, task._id, task);
      return true;
    });
    return { changed };
  }

  return {
    authenticate,
    bootstrap,
    claimPairing,
    clearTaskHistory,
    createEvent,
    createPairingCode,
    deleteAccount,
    getDashboard,
    getDesktopStatus,
    getTask,
    listDesktops,
    listTasks,
    prepareSubscriptionGrant,
    reconcileUnknown,
    recordSubscriptionOutcome,
    renameDesktop,
    unpairSelf,
    updateSettings,
    revokeDesktopByOwner
  };
}

module.exports = { COLLECTIONS, createService, quotaDto, validateState };
