'use strict';

const { AppError } = require('./errors');
const { CONTROL_RE, isPlainObject, sha256 } = require('./security');

const TEMPLATE_TYPES = new Set(['thing', 'phrase', 'name', 'character_string', 'number', 'date', 'time']);
const TEMPLATE_SOURCES = new Set(['completion', 'completedAt', 'desktopName', 'status', 'project', 'model']);
const SOURCE_TYPES = {
  completion: new Set(['thing']),
  completedAt: new Set(['date', 'time']),
  desktopName: new Set(['thing', 'name']),
  status: new Set(['phrase']),
  project: new Set(['thing']),
  model: new Set(['thing', 'character_string'])
};

function positiveInteger(value, fallback, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new AppError('configuration_required');
  return parsed;
}

function parseTemplateKeywords(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || '');
  } catch {
    throw new AppError('configuration_required');
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).length < 1) throw new AppError('configuration_required');
  const used = new Set();
  const result = {};
  for (const [source, descriptor] of Object.entries(parsed)) {
    if (!TEMPLATE_SOURCES.has(source) || !isPlainObject(descriptor)) throw new AppError('configuration_required');
    const keys = Object.keys(descriptor);
    if (keys.length !== 2 || !keys.includes('key') || !keys.includes('type')) throw new AppError('configuration_required');
    if (typeof descriptor.key !== 'string' || !/^(thing|phrase|name|character_string|number|date|time)\d{1,3}$/u.test(descriptor.key)) {
      throw new AppError('configuration_required');
    }
    if (!TEMPLATE_TYPES.has(descriptor.type) || !SOURCE_TYPES[source].has(descriptor.type) || !descriptor.key.startsWith(descriptor.type) || used.has(descriptor.key)) {
      throw new AppError('configuration_required');
    }
    used.add(descriptor.key);
    result[source] = { key: descriptor.key, type: descriptor.type };
  }
  return result;
}

function loadConfig(env = process.env) {
  if (env.MOCK_SENDER === 'true') throw new AppError('configuration_required');
  const pairingPepper = env.PAIRING_CODE_PEPPER;
  const devicePepper = env.DEVICE_SECRET_PEPPER;
  const templateId = env.WECHAT_SUBSCRIBE_TEMPLATE_ID;
  const publicOrigin = env.WECHAT_HTTP_PUBLIC_ORIGIN;
  const miniprogramState = env.WECHAT_MINIPROGRAM_STATE;
  const lang = env.WECHAT_SUBSCRIBE_LANG || 'zh_CN';
  if (![pairingPepper, devicePepper, templateId, publicOrigin, miniprogramState].every((value) => typeof value === 'string' && value.length >= 1 && !CONTROL_RE.test(value))) {
    throw new AppError('configuration_required');
  }
  if (pairingPepper.length < 32 || devicePepper.length < 32 || pairingPepper === devicePepper) throw new AppError('configuration_required');
  if (!['developer', 'trial', 'formal'].includes(miniprogramState) || !['zh_CN', 'en_US', 'zh_HK', 'zh_TW'].includes(lang)) {
    throw new AppError('configuration_required');
  }
  let origin;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new AppError('configuration_required');
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(origin.hostname);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))) {
    throw new AppError('configuration_required');
  }
  const initialQuota = Number(env.INITIAL_NOTIFICATION_QUOTA || 0);
  if (!Number.isSafeInteger(initialQuota) || initialQuota < 0 || initialQuota > 1000) throw new AppError('configuration_required');
  return Object.freeze({
    pairingPepper,
    devicePepper,
    cursorKey: `${devicePepper}:cursor:v1`,
    templateId,
    templateIdHash: sha256(templateId).toString('hex'),
    templateKeywords: parseTemplateKeywords(env.WECHAT_TEMPLATE_KEYWORDS || env.WECHAT_TEMPLATE_KEYWORD_MAPPING),
    publicOrigin: origin.origin,
    miniprogramState,
    lang,
    initialQuota,
    pairingTtlMs: positiveInteger(env.PAIRING_TTL_SECONDS, 600, 3600) * 1000,
    grantTtlMs: positiveInteger(env.SUBSCRIPTION_GRANT_TTL_SECONDS, 300, 1800) * 1000,
    cleanupBatchSize: positiveInteger(env.CLEANUP_BATCH_SIZE, 50, 100),
    pairRateLimit: positiveInteger(env.PAIR_RATE_LIMIT, 10, 1000),
    pairRateWindowMs: positiveInteger(env.PAIR_RATE_WINDOW_SECONDS, 600, 86400) * 1000,
    pairingSessionMaxAttempts: positiveInteger(env.PAIR_SESSION_MAX_ATTEMPTS, 5, 100),
    eventRateLimit: positiveInteger(env.EVENT_RATE_LIMIT_PER_MINUTE, 120, 10000),
    statusRateLimit: positiveInteger(env.STATUS_RATE_LIMIT_PER_MINUTE, 60, 10000),
    grantRateLimit: positiveInteger(env.GRANT_RATE_LIMIT, 10, 1000),
    grantRateWindowMs: positiveInteger(env.GRANT_RATE_WINDOW_SECONDS, 600, 86400) * 1000
  });
}

module.exports = { loadConfig, parseTemplateKeywords };
