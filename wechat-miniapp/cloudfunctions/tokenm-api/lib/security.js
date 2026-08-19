'use strict';

const crypto = require('node:crypto');
const { AppError } = require('./errors');

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/u;

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

function hmacHex(key, value) {
  return crypto.createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function hmacBuffer(key, value) {
  return crypto.createHmac('sha256', key).update(String(value), 'utf8').digest();
}

function deterministicId(prefix, value) {
  return prefix + base64url(sha256(value)).slice(0, 22);
}

function randomId(prefix, randomBytes = crypto.randomBytes) {
  return prefix + base64url(randomBytes(16));
}

function requestId(randomBytes = crypto.randomBytes) {
  return 'req_' + base64url(randomBytes(16));
}

function pairingCode(randomInt = crypto.randomInt) {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

function credential(desktopId, randomBytes = crypto.randomBytes) {
  const secret = base64url(randomBytes(32));
  return { plaintext: `tm_wx_d1.${desktopId}.${secret}`, secret };
}

function parseCredential(value) {
  if (typeof value !== 'string' || value.length > 160) return null;
  const match = /^tm_wx_d1\.(dev_[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u.exec(value);
  if (!match) return null;
  return { desktopId: match[1], secret: match[2] };
}

function timingSafeHexEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== 64 || right.length !== 64) return false;
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function canonicalDigest(value) {
  return sha256(canonicalJson(value)).toString('hex');
}

function assertExactKeys(value, allowed, required = []) {
  if (!isPlainObject(value)) throw new AppError('invalid_request');
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new AppError('invalid_request');
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new AppError('invalid_request');
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertString(value, { min = 0, max, pattern, allowEmpty = true } = {}) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) throw new AppError('invalid_request');
  const length = [...value].length;
  if (length < min || (max !== undefined && length > max) || (!allowEmpty && length === 0)) throw new AppError('invalid_request');
  if (pattern && !pattern.test(value)) throw new AppError('invalid_request');
  return value;
}

function sanitizeDeviceName(value) {
  if (typeof value !== 'string') throw new AppError('invalid_request');
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  if ([...cleaned].length < 1 || [...cleaned].length > 80) throw new AppError('invalid_request');
  return cleaned;
}

function assertRequestId(value) {
  if (typeof value !== 'string' || !/^req_[A-Za-z0-9_-]{16,43}$/u.test(value)) throw new AppError('invalid_request');
  return value;
}

function truncateId(value) {
  if (typeof value !== 'string') return null;
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function encodeCursor(payload, key) {
  const encoded = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = base64url(hmacBuffer(key, `cursor:v1:${encoded}`)).slice(0, 22);
  return `${encoded}.${signature}`;
}

function decodeCursor(value, key) {
  if (typeof value !== 'string' || value.length > 512) throw new AppError('invalid_request');
  const parts = value.split('.');
  if (parts.length !== 2 || !BASE64URL_RE.test(parts[0]) || !BASE64URL_RE.test(parts[1])) throw new AppError('invalid_request');
  const expected = base64url(hmacBuffer(key, `cursor:v1:${parts[0]}`)).slice(0, 22);
  const left = Buffer.from(parts[1]);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new AppError('invalid_request');
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw new AppError('invalid_request');
  }
  if (!isPlainObject(decoded) || typeof decoded.occurredAt !== 'string' || typeof decoded.taskId !== 'string') throw new AppError('invalid_request');
  return decoded;
}

module.exports = {
  CONTROL_RE,
  assertExactKeys,
  assertRequestId,
  assertString,
  base64url,
  canonicalDigest,
  credential,
  decodeCursor,
  deterministicId,
  encodeCursor,
  hmacHex,
  isPlainObject,
  pairingCode,
  parseCredential,
  randomId,
  requestId,
  sanitizeDeviceName,
  sha256,
  timingSafeHexEqual,
  truncateId
};
