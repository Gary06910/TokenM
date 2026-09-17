'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');

const core = require(path.resolve(
  __dirname,
  '../../apps/tokenm-android/uniCloud-alipay/cloudfunctions/common/tokenm-core'
));

const {
  AppError,
  COLLECTIONS,
  MemoryRepository,
  TokenMApplication
} = core;

const FIXED_NOW = Date.parse('2026-08-23T08:00:00.000Z');
const TEST_KEY = randomBytes(32);

function createFixture(options = {}) {
  const repository = options.repository ?? new MemoryRepository();
  const providerCalls = [];
  const provider = options.provider ?? {
    async submit(message) {
      providerCalls.push(message);
      return { status: options.providerStatus ?? 'submitted' };
    }
  };
  let nowMs = options.nowMs ?? FIXED_NOW;
  const application = new TokenMApplication({
    repository,
    credentialKey: TEST_KEY,
    provider,
    rateRules: options.rateRules,
    now: () => nowMs
  });
  return {
    application,
    providerCalls,
    repository,
    setNow(value) {
      nowMs = value;
    }
  };
}

async function pairDesktop(fixture, ownerId = 'uid-owner', options = {}) {
  await fixture.application.bootstrap(ownerId);
  if (options.mobile !== false) {
    await fixture.application.updatePrivacyConsent(ownerId, {
      version: core.PRIVACY_CONSENT_VERSION
    });
    await fixture.application.registerMobileDevice(ownerId, {
      deviceLabel: 'Test Android',
      pushRegistrationStatus: 'ready',
      notificationPermissionState: 'authorized'
    }, {
      deviceId: options.deviceId ?? `installation-${ownerId}`,
      platform: 'app',
      appVersion: '1.0.0'
    });
  }
  const pairing = await fixture.application.createPairingCode(ownerId);
  const paired = await fixture.application.pair({
    schemaVersion: 1,
    code: pairing.code,
    deviceName: options.name ?? 'Workstation'
  }, { rateSubject: 'client-ip:203.0.113.7' });
  return { pairing, ...paired };
}

function completionEvent(desktopId, overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'evt:session-1:turn-1',
    event: 'codex.task.completed',
    desktopId,
    occurredAt: new Date(FIXED_NOW).toISOString(),
    privacyMode: true,
    sessionId: 'session-1',
    project: null,
    model: null,
    summary: null,
    durationMs: null,
    ...overrides
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof AppError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test('authenticated owner boundaries hide another user tasks and desktops', async () => {
  const fixture = createFixture();
  const paired = await pairDesktop(fixture, 'uid-alice');
  const created = await fixture.application.events(
    paired.credential,
    completionEvent(paired.desktop.desktopId)
  );
  await expectCode(fixture.application.events(
    paired.credential,
    completionEvent('dev_22222222-2222-4222-8222-222222222222', {
      eventId: 'evt:foreign-desktop:turn-1'
    })
  ), 'unauthorized');
  await fixture.application.bootstrap('uid-bob');

  assert.equal((await fixture.application.listTasks('uid-bob')).tasks.length, 0);
  assert.equal((await fixture.application.listDesktops('uid-bob')).desktops.length, 0);
  await expectCode(
    fixture.application.getTask('uid-bob', { taskId: created.taskId }),
    'task_not_found'
  );
  await expectCode(
    fixture.application.renameDesktop('uid-bob', {
      desktopId: paired.desktop.desktopId,
      name: 'Not mine'
    }),
    'unauthorized'
  );

  const owned = await fixture.application.getTask('uid-alice', { taskId: created.taskId });
  assert.equal(owned.task.taskId, created.taskId);
});

test('privacy consent accepts only the frozen version, uses server time, and remains owner-scoped', async () => {
  const fixture = createFixture();
  const aliceBootstrap = await fixture.application.bootstrap('uid-alice');
  await fixture.application.bootstrap('uid-bob');
  assert.deepEqual(aliceBootstrap.user.privacyConsent, {
    requiredVersion: core.PRIVACY_CONSENT_VERSION,
    acceptedVersion: null,
    acceptedAt: null,
    isCurrent: false
  });
  const storedDefault = await fixture.repository.findById(COLLECTIONS.users, 'uid-alice');
  assert.equal(storedDefault.notificationsEnabled, false);
  assert.equal(storedDefault.privacyConsentVersion, null);
  assert.equal(storedDefault.privacyConsentAtMs, null);

  await expectCode(fixture.application.updatePrivacyConsent('uid-alice', {
    version: 'tokenm-android-v2'
  }), 'invalid_request');
  await expectCode(fixture.application.updatePrivacyConsent('uid-alice', {
    version: core.PRIVACY_CONSENT_VERSION,
    ownerId: 'uid-bob'
  }), 'invalid_request');

  const updated = await fixture.application.updatePrivacyConsent('uid-alice', {
    version: core.PRIVACY_CONSENT_VERSION
  });
  assert.deepEqual(updated, {
    ok: true,
    privacyConsent: {
      requiredVersion: core.PRIVACY_CONSENT_VERSION,
      acceptedVersion: core.PRIVACY_CONSENT_VERSION,
      acceptedAt: new Date(FIXED_NOW).toISOString(),
      isCurrent: true
    }
  });
  assert.deepEqual(
    (await fixture.application.getPrivacyConsent('uid-alice')).privacyConsent,
    updated.privacyConsent
  );
  assert.equal(
    (await fixture.application.getPrivacyConsent('uid-bob')).privacyConsent.isCurrent,
    false
  );
  assert.deepEqual(
    (await fixture.application.bootstrap('uid-alice')).user.privacyConsent,
    updated.privacyConsent
  );
  assert.deepEqual(
    (await fixture.application.updateSettings('uid-alice', {
      notificationsEnabled: false
    })).settings.privacyConsent,
    updated.privacyConsent
  );
  const stored = await fixture.repository.findById(COLLECTIONS.users, 'uid-alice');
  assert.equal(stored.privacyConsentVersion, core.PRIVACY_CONSENT_VERSION);
  assert.equal(stored.privacyConsentAtMs, FIXED_NOW);
});

test('pairing is six-digit, 600-second, superseding, single-use, and server stores only AES-GCM fields', async () => {
  const fixture = createFixture();
  await fixture.application.bootstrap('uid-owner');
  const first = await fixture.application.createPairingCode('uid-owner');
  const second = await fixture.application.createPairingCode('uid-owner');

  assert.match(first.code, /^\d{6}$/);
  assert.equal(first.ttlSeconds, 600);
  assert.equal((await fixture.application.getPairingStatus('uid-owner', {
    sessionId: first.sessionId
  })).status, 'superseded');
  const sessions = fixture.repository.snapshot(COLLECTIONS.pairingSessions);
  const superseded = sessions.find((entry) => entry._id === first.sessionId);
  assert.equal(superseded.code, null);
  assert.equal(superseded.activeOwnerKey, null);
  assert.match(superseded.codeUniquenessKey, /^inactive:[0-9a-f-]{36}$/);
  assert.match(superseded.ownerUniquenessKey, /^inactive:[0-9a-f-]{36}$/);

  const paired = await fixture.application.pair({
    schemaVersion: 1,
    code: second.code,
    deviceName: 'Desktop One'
  }, { rateSubject: 'client-ip:203.0.113.7' });
  assert.match(
    paired.credential,
    new RegExp(`^tm_uc_d1\\.${paired.desktop.desktopId}\\.[A-Za-z0-9_-]{43}$`)
  );
  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: second.code,
    deviceName: 'Replay'
  }, { rateSubject: 'client-ip:203.0.113.7' }), 'pairing_invalid');

  const stored = await fixture.repository.findById(COLLECTIONS.desktops, paired.desktop.desktopId);
  assert.deepEqual(Object.keys(stored.encryptedSecret).sort(), [
    'ciphertext',
    'iv',
    'tag',
    'version'
  ]);
  assert.equal(JSON.stringify(stored).includes(paired.credential.split('.')[2]), false);
  const consumed = fixture.repository.snapshot(COLLECTIONS.pairingSessions)
    .find((entry) => entry._id === second.sessionId);
  assert.equal(consumed.code, null);
  assert.equal(consumed.activeOwnerKey, null);
  assert.notEqual(consumed.codeUniquenessKey, superseded.codeUniquenessKey);
  assert.equal((await fixture.application.status(paired.credential)).desktop.status, 'active');
});

test('pairing guesses are bounded per validated client IP and do not block another IP', async () => {
  const fixture = createFixture();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectCode(fixture.application.pair({
      schemaVersion: 1,
      code: String(attempt).padStart(6, '0'),
      deviceName: 'Guess'
    }, { rateSubject: 'client-ip:203.0.113.7' }), 'pairing_invalid');
  }
  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: '999999',
    deviceName: 'Guess'
  }, { rateSubject: 'client-ip:203.0.113.7' }), 'rate_limited');
  let buckets = fixture.repository.snapshot(COLLECTIONS.rateLimits)
    .filter((entry) => entry.scope === 'desktop-pair');
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].subject, 'client-ip:203.0.113.7');
  assert.equal(buckets[0].ownerId, null);
  assert.equal(Object.hasOwn(buckets[0], 'code'), false);

  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: '999999',
    deviceName: 'Other IP'
  }, { rateSubject: 'client-ip:198.51.100.8' }), 'pairing_invalid');
  buckets = fixture.repository.snapshot(COLLECTIONS.rateLimits)
    .filter((entry) => entry.scope === 'desktop-pair');
  assert.equal(buckets.length, 2);

  fixture.setNow(FIXED_NOW + 600_001);
  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: '999999',
    deviceName: 'Next bucket'
  }, { rateSubject: 'client-ip:198.51.100.8' }), 'pairing_invalid');
  buckets = fixture.repository.snapshot(COLLECTIONS.rateLimits)
    .filter((entry) => entry.scope === 'desktop-pair');
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].subject, 'client-ip:198.51.100.8');
  assert.equal(buckets[0].count, 1);
});

test('pairing rejects a wrong code and expires at the server-side 600-second boundary', async () => {
  const fixture = createFixture();
  await fixture.application.bootstrap('uid-expiry');
  const pairing = await fixture.application.createPairingCode('uid-expiry');
  const wrongCode = pairing.code === '000000' ? '000001' : '000000';

  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: wrongCode,
    deviceName: 'Wrong code'
  }, { rateSubject: 'client-ip:203.0.113.7' }), 'pairing_invalid');

  fixture.setNow(FIXED_NOW + core.PAIRING_TTL_MS);
  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: pairing.code,
    deviceName: 'Expired code'
  }, { rateSubject: 'client-ip:203.0.113.7' }), 'pairing_invalid');
  assert.equal((await fixture.application.getPairingStatus('uid-expiry', {
    sessionId: pairing.sessionId
  })).status, 'expired');
});

test('AES-GCM tampering and wrong secrets fail closed; self-unpair revokes immediately', async () => {
  const tamperedFixture = createFixture();
  const tamperedPair = await pairDesktop(tamperedFixture);
  const desktop = await tamperedFixture.repository.findById(
    COLLECTIONS.desktops,
    tamperedPair.desktop.desktopId
  );
  const first = desktop.encryptedSecret.tag[0];
  await tamperedFixture.repository.updateById(COLLECTIONS.desktops, desktop._id, {
    encryptedSecret: {
      ...desktop.encryptedSecret,
      tag: `${first === 'A' ? 'B' : 'A'}${desktop.encryptedSecret.tag.slice(1)}`
    }
  });
  await expectCode(tamperedFixture.application.status(tamperedPair.credential), 'unauthenticated');

  const fixture = createFixture();
  const paired = await pairDesktop(fixture);
  const wrongCredential = `tm_uc_d1.${paired.desktop.desktopId}.${'A'.repeat(43)}`;
  await expectCode(fixture.application.status(wrongCredential), 'unauthenticated');
  assert.deepEqual(await fixture.application.unpairSelf(paired.credential, {
    confirmation: 'UNPAIR'
  }), { ok: true });
  await expectCode(fixture.application.status(paired.credential), 'desktop_revoked');
});

test('event validation rejects unknown and private content while accepting nullable full fields and old ISO times', async () => {
  const fixture = createFixture();
  const paired = await pairDesktop(fixture);
  const desktopId = paired.desktop.desktopId;

  await expectCode(fixture.application.events(paired.credential, completionEvent(desktopId, {
    summary: 'must not be uploaded'
  })), 'privacy_payload_rejected');
  await expectCode(fixture.application.events(paired.credential, {
    ...completionEvent(desktopId),
    prompt: 'unknown'
  }), 'privacy_payload_rejected');
  await expectCode(fixture.application.events(paired.credential, completionEvent(desktopId, {
    eventId: 'contains spaces'
  })), 'invalid_request');

  const oldFullEvent = completionEvent(desktopId, {
    eventId: 'evt:session-old:turn-1',
    occurredAt: '2020-01-01T00:00:00.000Z',
    privacyMode: false,
    project: null,
    model: null,
    summary: null,
    durationMs: null
  });
  assert.equal((await fixture.application.events(paired.credential, oldFullEvent)).status, 'created');
  await expectCode(fixture.application.events(paired.credential, completionEvent(desktopId, {
    eventId: 'evt:session-long:turn-1',
    privacyMode: false,
    project: 'project',
    model: 'model',
    summary: 'x'.repeat(601),
    durationMs: 10
  })), 'invalid_request');
  await expectCode(fixture.application.events(paired.credential, completionEvent(desktopId, {
    eventId: 'evt:future:turn-1',
    occurredAt: new Date(FIXED_NOW + 5 * 60_000 + 1).toISOString()
  })), 'invalid_request');
});

test('concurrent identical events persist one random task and never call a provider; changed fields conflict', async () => {
  let providerCalls = 0;
  const fixture = createFixture({
    provider: {
      async submit() {
        providerCalls += 1;
      }
    }
  });
  const paired = await pairDesktop(fixture);
  const event = completionEvent(paired.desktop.desktopId);
  const firstPromise = fixture.application.events(paired.credential, event);
  const secondPromise = fixture.application.events(paired.credential, event);
  const results = await Promise.all([firstPromise, secondPromise]);

  assert.deepEqual(new Set(results.map((entry) => entry.status)), new Set(['created', 'duplicate']));
  assert.equal(results[0].taskId, results[1].taskId);
  assert.match(results[0].taskId, /^tsk_[0-9a-f-]{36}$/);
  assert.equal(results[0].notificationStatus, 'not_requested');
  assert.equal(results[1].notificationStatus, 'not_requested');
  assert.equal(providerCalls, 0);
  assert.equal(fixture.repository.snapshot(COLLECTIONS.tasks).length, 1);
  assert.equal(fixture.repository.snapshot(COLLECTIONS.tasks)[0].notificationStatus, 'not_requested');

  await expectCode(fixture.application.events(paired.credential, {
    ...event,
    sessionId: 'different-session'
  }), 'event_conflict');
  assert.equal(providerCalls, 0);
});

test('event persistence ignores mobile notification state and records no provider attempt', async () => {
  const fixture = createFixture();
  const noTarget = await pairDesktop(fixture, 'uid-no-target', { mobile: false });
  const first = await fixture.application.events(
    noTarget.credential,
    completionEvent(noTarget.desktop.desktopId)
  );
  assert.equal(first.notificationStatus, 'not_requested');

  const disabled = await pairDesktop(fixture, 'uid-disabled');
  await fixture.application.updateSettings('uid-disabled', { notificationsEnabled: false });
  const second = await fixture.application.events(
    disabled.credential,
    completionEvent(disabled.desktop.desktopId, { eventId: 'evt:disabled:turn-1' })
  );
  assert.equal(second.notificationStatus, 'not_requested');
  assert.equal(fixture.providerCalls.length, 0);
  assert.equal(fixture.repository.snapshot(COLLECTIONS.tasks)
    .every((entry) => entry.notificationStatus === 'not_requested'), true);
  assert.equal(fixture.repository.snapshot(COLLECTIONS.tasks).length, 2);
});

test('mobile registration gates every active push state on current privacy consent but permits disable', async () => {
  const fixture = createFixture();
  const registrationStatuses = ['notStarted', 'ready', 'error'];
  const identity = {
    deviceId: 'consent-gated-installation',
    platform: 'app',
    appVersion: '1.2.3'
  };
  await fixture.application.bootstrap('uid-mobile-gate');

  for (const pushRegistrationStatus of registrationStatuses) {
    await expectCode(fixture.application.registerMobileDevice('uid-mobile-gate', {
      deviceLabel: 'Consent-gated phone',
      pushRegistrationStatus,
      notificationPermissionState: 'authorized'
    }, identity), 'privacy_consent_required');
  }
  assert.equal(fixture.repository.snapshot(COLLECTIONS.mobileDevices).length, 0);

  for (const pushRegistrationStatus of registrationStatuses) {
    const disabled = await fixture.application.registerMobileDevice('uid-mobile-gate', {
      enabled: false,
      deviceLabel: 'Consent-gated phone',
      pushRegistrationStatus,
      notificationPermissionState: 'authorized'
    }, identity);
    assert.equal(disabled.device.status, 'disabled');
    assert.equal(disabled.device.pushRegistrationStatus, pushRegistrationStatus);
  }

  for (const pushRegistrationStatus of registrationStatuses) {
    await expectCode(fixture.application.registerMobileDevice('uid-mobile-gate', {
      enabled: true,
      deviceLabel: 'Consent-gated phone',
      pushRegistrationStatus,
      notificationPermissionState: 'authorized'
    }, identity), 'privacy_consent_required');
  }
  assert.equal(
    fixture.repository.snapshot(COLLECTIONS.mobileDevices)[0].status,
    'disabled'
  );

  await fixture.application.updatePrivacyConsent('uid-mobile-gate', {
    version: core.PRIVACY_CONSENT_VERSION
  });
  for (const pushRegistrationStatus of registrationStatuses) {
    const active = await fixture.application.registerMobileDevice('uid-mobile-gate', {
      enabled: true,
      deviceLabel: 'Consent-gated phone',
      pushRegistrationStatus,
      notificationPermissionState: 'authorized'
    }, identity);
    assert.equal(active.device.status, 'active');
    assert.equal(active.device.pushRegistrationStatus, pushRegistrationStatus);
  }
});

test('mobile registration stores the full safe business state, rejects owner injection, and requires ready push state', async () => {
  const fixture = createFixture();
  await fixture.application.bootstrap('uid-mobile');
  await fixture.application.updatePrivacyConsent('uid-mobile', {
    version: core.PRIVACY_CONSENT_VERSION
  });
  const registered = await fixture.application.registerMobileDevice('uid-mobile', {
    deviceLabel: 'Honor test phone',
    pushRegistrationStatus: 'ready',
    notificationPermissionState: 'denied'
  }, {
    deviceId: 'authoritative-installation',
    platform: 'app',
    appVersion: '1.2.3'
  });
  assert.match(registered.device.deviceRecordId, /^mob_[0-9a-f-]{36}$/);
  assert.deepEqual({
    deviceId: registered.device.deviceId,
    platform: registered.device.platform,
    deviceLabel: registered.device.deviceLabel,
    pushRegistrationStatus: registered.device.pushRegistrationStatus,
    notificationPermissionState: registered.device.notificationPermissionState,
    appVersion: registered.device.appVersion,
    status: registered.device.status
  }, {
    deviceId: 'authoritative-installation',
    platform: 'app',
    deviceLabel: 'Honor test phone',
    pushRegistrationStatus: 'ready',
    notificationPermissionState: 'denied',
    appVersion: '1.2.3',
    status: 'active'
  });
  const stored = fixture.repository.snapshot(COLLECTIONS.mobileDevices)[0];
  assert.equal(Object.hasOwn(stored, 'cid'), false);
  assert.equal(Object.hasOwn(stored, 'pushCid'), false);
  await expectCode(fixture.application.registerMobileDevice('uid-mobile', {
    ownerId: 'uid-attacker'
  }, {
    deviceId: 'authoritative-installation',
    platform: 'app',
    appVersion: '1.2.3'
  }), 'invalid_request');

  const paired = await pairDesktop(fixture, 'uid-mobile', { mobile: false });
  const eventResult = await fixture.application.events(
    paired.credential,
    completionEvent(paired.desktop.desktopId, { eventId: 'evt:not-ready:turn-1' })
  );
  assert.equal(eventResult.notificationStatus, 'not_requested');
  assert.equal(fixture.providerCalls.length, 0);

  await fixture.application.registerMobileDevice('uid-mobile', {
    deviceLabel: 'Honor test phone',
    pushRegistrationStatus: 'ready',
    notificationPermissionState: 'notDetermined'
  }, {
    deviceId: 'authoritative-installation',
    platform: 'app',
    appVersion: '1.2.3'
  });
  const notDetermined = await fixture.application.events(
    paired.credential,
    completionEvent(paired.desktop.desktopId, { eventId: 'evt:not-determined:turn-1' })
  );
  assert.equal(notDetermined.notificationStatus, 'not_requested');
  assert.equal(fixture.providerCalls.length, 0);

  await fixture.application.registerMobileDevice('uid-mobile', {
    deviceLabel: 'Honor test phone',
    pushRegistrationStatus: 'ready',
    notificationPermissionState: 'authorized'
  }, {
    deviceId: 'authoritative-installation',
    platform: 'app',
    appVersion: '1.2.3'
  });
  const authorized = await fixture.application.events(
    paired.credential,
    completionEvent(paired.desktop.desktopId, { eventId: 'evt:authorized:turn-1' })
  );
  assert.equal(authorized.notificationStatus, 'not_requested');
  assert.equal(fixture.providerCalls.length, 0);
});

test('rate limits retain only owner pairing-create and client-IP desktop-pair rules', async () => {
  const fixture = createFixture({
    rateRules: { desktopPair: { limit: 1, windowMs: 60_000 } }
  });
  assert.deepEqual(Object.keys(fixture.application.rateRules).sort(), [
    'desktopPair',
    'pairingCreate'
  ]);
  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: '123456',
    deviceName: 'Guess'
  }, { rateSubject: 'client-ip:203.0.113.7' }), 'pairing_invalid');
  await expectCode(fixture.application.pair({
    schemaVersion: 1,
    code: '654321',
    deviceName: 'Guess'
  }, { rateSubject: 'client-ip:203.0.113.7' }), 'rate_limited');

  const eventRate = fixture.repository.snapshot(COLLECTIONS.rateLimits)
    .find((entry) => entry.scope === 'desktop-pair');
  assert.deepEqual(
    { scope: eventRate.scope, subject: eventRate.subject, bucket: eventRate.bucket },
    {
      scope: 'desktop-pair',
      subject: 'client-ip:203.0.113.7',
      bucket: Math.floor(FIXED_NOW / 60_000)
    }
  );
  assert.equal(fixture.repository.snapshot(COLLECTIONS.rateLimits)
    .some((entry) => /desktop-(?:status|events|unpair)/.test(entry.scope)), false);
});

test('dashboard, rename, settings, history clearing, unbind, and custom-data account deletion work end to end', async () => {
  const fixture = createFixture();
  const paired = await pairDesktop(fixture);
  const created = await fixture.application.events(
    paired.credential,
    completionEvent(paired.desktop.desktopId)
  );
  const dashboard = await fixture.application.getDashboard('uid-owner', {
    dayStart: '2026-08-23T00:00:00.000Z',
    dayEnd: '2026-08-24T00:00:00.000Z'
  });
  assert.equal(dashboard.counts.tasks, 1);
  assert.equal(dashboard.counts.todayTasks, 1);
  assert.equal((await fixture.application.listTasks('uid-owner')).tasks[0].taskId, created.taskId);
  assert.equal((await fixture.application.renameDesktop('uid-owner', {
    desktopId: paired.desktop.desktopId,
    name: 'Renamed'
  })).desktop.name, 'Renamed');
  assert.equal((await fixture.application.updateSettings('uid-owner', {
    notificationsEnabled: false
  })).settings.notificationsEnabled, false);
  assert.equal((await fixture.application.clearTaskHistory('uid-owner', {
    confirmation: 'CLEAR'
  })).deletedCount, 1);
  assert.equal((await fixture.application.listTasks('uid-owner')).tasks.length, 0);
  assert.equal((await fixture.application.unbindDesktop('uid-owner', {
    desktopId: paired.desktop.desktopId,
    confirmation: 'UNBIND'
  })).desktop.status, 'revoked');
  assert.equal((await fixture.application.deleteAccount('uid-owner', {
    confirmation: 'DELETE'
  })).cleanupPending, false);
  assert.equal(await fixture.repository.findById(COLLECTIONS.users, 'uid-owner'), null);
});

test('task pagination uses an explicit timestamp and random task-id tuple without losing same-millisecond rows', async () => {
  const fixture = createFixture();
  const paired = await pairDesktop(fixture);
  for (const turn of [1, 2, 3]) {
    await fixture.application.events(paired.credential, completionEvent(paired.desktop.desktopId, {
      eventId: `evt:same-ms:turn-${turn}`,
      sessionId: `same-ms-${turn}`,
      privacyMode: turn !== 3,
      project: null,
      model: null,
      summary: null,
      durationMs: null
    }));
  }
  const first = await fixture.application.listTasks('uid-owner', { limit: 2 });
  const second = await fixture.application.listTasks('uid-owner', {
    limit: 2,
    cursor: first.nextCursor
  });
  assert.equal(first.tasks.length, 2);
  assert.deepEqual(Object.keys(first.nextCursor).sort(), ['createdAtMs', 'taskId']);
  assert.equal(second.tasks.length, 1);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.tasks, ...second.tasks].map((entry) => entry.taskId)).size, 3);
  assert.equal((await fixture.application.listTasks('uid-owner', {
    privacyMode: false
  })).tasks.length, 1);

  const stored = fixture.repository.snapshot(COLLECTIONS.tasks);
  await fixture.repository.runTransaction(async (transaction) => {
    for (const task of stored) {
      await transaction.updateById(COLLECTIONS.tasks, task._id, {
        notificationStatus: 'not_requested'
      });
    }
  });
  const recent = await fixture.application.listTasks('uid-owner', {
    notificationStatuses: ['not_requested']
  });
  assert.deepEqual(
    new Set(recent.tasks.map((entry) => entry.notificationStatus)),
    new Set(['not_requested'])
  );
  await expectCode(fixture.application.listTasks('uid-owner', {
    notificationStatus: 'not_requested',
    notificationStatuses: ['not_requested']
  }), 'invalid_request');
});

test('history updates all records in one operation; account cleanup remains bounded', async () => {
  const historyFixture = createFixture();
  await historyFixture.application.bootstrap('uid-history');
  const desktopId = core.randomId('desktop');
  for (let index = 0; index < 101; index += 1) {
    await historyFixture.repository.insert(COLLECTIONS.tasks, {
      _id: core.randomId('task'),
      ownerId: 'uid-history',
      desktopId,
      eventId: `evt:history:${index}`,
      createdAtMs: FIXED_NOW
    });
  }
  const firstClear = await historyFixture.application.clearTaskHistory('uid-history', {
    confirmation: 'CLEAR'
  });
  assert.equal(firstClear.deletedCount, 101);
  assert.equal(firstClear.cleanupPending, false);
  assert.equal((await historyFixture.application.listTasks('uid-history')).tasks.length, 0);
  const secondClear = await historyFixture.application.clearTaskHistory('uid-history', {
    confirmation: 'CLEAR'
  });
  assert.equal(secondClear.deletedCount, 0);
  assert.equal(secondClear.cleanupPending, false);

  const accountFixture = createFixture();
  await accountFixture.application.bootstrap('uid-delete-many');
  for (let index = 0; index < 101; index += 1) {
    await accountFixture.repository.insert(COLLECTIONS.tasks, {
      _id: core.randomId('task'),
      ownerId: 'uid-delete-many',
      desktopId: 'dev_11111111-1111-4111-8111-111111111111',
      eventId: `evt:delete:${index}`,
      createdAtMs: FIXED_NOW,
      notificationStatus: 'not_requested'
    });
  }
  assert.equal((await accountFixture.application.deleteAccount('uid-delete-many', {
    confirmation: 'DELETE'
  })).cleanupPending, true);
  assert.notEqual(await accountFixture.repository.findById(
    COLLECTIONS.users,
    'uid-delete-many'
  ), null);
  assert.equal((await accountFixture.application.deleteAccount('uid-delete-many', {
    confirmation: 'DELETE'
  })).cleanupPending, false);
  assert.equal(await accountFixture.repository.findById(
    COLLECTIONS.users,
    'uid-delete-many'
  ), null);
});


test('clear is owner-scoped, bounded to start time, preserves desktop and permits future events', async () => {
  const f = createFixture(); const paired = await pairDesktop(f);
  const first = completionEvent(paired.desktop.desktopId);
  await f.application.events(paired.credential, first);
  const desktopBefore = await f.repository.findById(COLLECTIONS.desktops, paired.desktop.desktopId);
  await f.repository.insert(COLLECTIONS.tasks, { _id: core.randomId('task'), ownerId: 'other', desktopId: 'other', eventId: 'other', createdAtMs: FIXED_NOW });
  const update = f.repository.updateWhere.bind(f.repository);
  let operations = 0;
  f.repository.updateWhere = async (collection, criteria, patch) => {
    if (patch.userDeletedAtMs !== undefined) {
      operations++;
      await f.repository.insert(COLLECTIONS.tasks, { _id: core.randomId('task'), ownerId: 'uid-owner', desktopId: paired.desktop.desktopId, eventId: 'future', createdAtMs: FIXED_NOW + 1 });
    }
    return update(collection, criteria, patch);
  };
  await f.application.clearTasks('uid-owner', { confirmation: 'CLEAR' });
  assert.equal(operations, 1);
  assert.equal(f.repository.snapshot(COLLECTIONS.tasks).find(t => t.eventId === 'other').userDeletedAtMs, undefined);
  assert.equal(f.repository.snapshot(COLLECTIONS.tasks).find(t => t.eventId === 'future').userDeletedAtMs, undefined);
  assert.deepEqual(await f.repository.findById(COLLECTIONS.desktops,paired.desktop.desktopId),desktopBefore);
  assert.equal((await f.application.events(paired.credential, first)).status,'duplicate');
  f.setNow(FIXED_NOW + 2);
  const created = await f.application.events(paired.credential,completionEvent(paired.desktop.desktopId,{eventId:'evt:new-after-clear'}));
  assert.ok((await f.application.listTasks('uid-owner')).tasks.some(t => t.taskId === created.taskId));
});
