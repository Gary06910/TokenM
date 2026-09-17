'use strict';

const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual
} = require('node:crypto');
const { AppError } = require('./errors');

const CREDENTIAL_PREFIX = 'tm_uc_d1';
const KEY_ENV_NAME = 'TOKEN_M_DESKTOP_CREDENTIAL_KEY';
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DESKTOP_PATTERN = /^dev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function readCredentialKey(environment = process.env) {
  const encoded = environment[KEY_ENV_NAME];
  if (typeof encoded !== 'string' || !SECRET_PATTERN.test(encoded)) {
    throw new AppError('configuration_required');
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== encoded) {
    throw new AppError('configuration_required');
  }
  return key;
}

function createDesktopCredential(desktopId, key) {
  if (!DESKTOP_PATTERN.test(desktopId) || !Buffer.isBuffer(key) || key.length !== 32) {
    throw new AppError('configuration_required');
  }
  const secret = randomBytes(32).toString('base64url');
  return {
    credential: `${CREDENTIAL_PREFIX}.${desktopId}.${secret}`,
    encryptedSecret: encryptSecret(secret, desktopId, key)
  };
}

function encryptSecret(secret, desktopId, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(desktopId, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final()
  ]);
  return {
    version: 1,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  };
}

function decryptSecret(encryptedSecret, desktopId, key) {
  try {
    if (!encryptedSecret || encryptedSecret.version !== 1) throw new Error('invalid version');
    const iv = decodePart(encryptedSecret.iv, 12);
    const ciphertext = decodePart(encryptedSecret.ciphertext, 43);
    const tag = decodePart(encryptedSecret.tag, 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(desktopId, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');
  } catch (_error) {
    throw new AppError('unauthenticated');
  }
}

function decodePart(value, expectedLength) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('invalid encrypted value');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedLength || decoded.toString('base64url') !== value) {
    throw new Error('invalid encrypted length');
  }
  return decoded;
}

function parseDesktopCredential(value) {
  if (typeof value !== 'string') throw new AppError('unauthenticated');
  const parts = value.split('.');
  if (
    parts.length !== 3
    || parts[0] !== CREDENTIAL_PREFIX
    || !DESKTOP_PATTERN.test(parts[1])
    || !SECRET_PATTERN.test(parts[2])
  ) {
    throw new AppError('unauthenticated');
  }
  return { desktopId: parts[1], secret: parts[2] };
}

function secretsMatch(provided, expected) {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  const sameLength = left.length === right.length;
  const comparable = sameLength ? left : Buffer.alloc(right.length);
  const equal = timingSafeEqual(comparable, right);
  return sameLength && equal;
}

module.exports = {
  CREDENTIAL_PREFIX,
  KEY_ENV_NAME,
  createDesktopCredential,
  decryptSecret,
  parseDesktopCredential,
  readCredentialKey,
  secretsMatch
};
