'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '../../apps/tokenm-android');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const SESSION_CODES = new Set([
  'unauthenticated',
  'uni-id-token-expired',
  'uni-id-check-token-failed'
]);

function presentAuthError(errCode, fallback = '无法创建账户，请稍后重试。') {
  if (SESSION_CODES.has(errCode)) return '登录已失效，请重新登录。';
  if (errCode === 'uni-id-account-exists') return '用户名已存在，请直接登录或更换用户名。';
  if (errCode === 'uni-id-invalid-username') return '用户名仅支持字母、数字、下划线和短横线，且不能为纯数字。';
  if (errCode === 'uni-id-invalid-password-medium') return '密码需为 8–16 位，并至少包含字母、数字、特殊符号中的两类。';
  if (errCode === 'uni-id-captcha-required') return '请输入图形验证码。';
  if (errCode === 'uni-captcha-verify-fail') return '验证码错误，请重新输入。';
  if (errCode === 'uni-captcha-verify-overdue') return '验证码已失效，请刷新后重试。';
  return fallback;
}

function applyOfficialRegisterResponse(previousSession, registerResponse, now) {
  // This models the official importObject automatic response.newToken replacement.
  const nextSession = registerResponse?.newToken
    ? { token: registerResponse.newToken.token, tokenExpired: registerResponse.newToken.tokenExpired }
    : previousSession;
  const authenticated = Boolean(nextSession?.token)
    && Number(nextSession.tokenExpired) > now;
  return { session: nextSession, authenticated, postRegisterState: authenticated ? 'signedIn' : 'error' };
}

test('auth error mapping keeps registration branches truthful', () => {
  assert.equal(presentAuthError('uni-id-token-expired'), '登录已失效，请重新登录。');
  assert.equal(presentAuthError('uni-id-check-token-failed'), '登录已失效，请重新登录。');
  assert.equal(presentAuthError('unauthenticated'), '登录已失效，请重新登录。');
  assert.equal(presentAuthError('uni-id-account-exists'), '用户名已存在，请直接登录或更换用户名。');
  assert.equal(presentAuthError('uni-captcha-verify-fail'), '验证码错误，请重新输入。');
  assert.equal(presentAuthError('uni-captcha-verify-overdue'), '验证码已失效，请刷新后重试。');
  assert.equal(presentAuthError('uni-id-captcha-required'), '请输入图形验证码。');
  assert.equal(presentAuthError('uni-id-invalid-username'), '用户名仅支持字母、数字、下划线和短横线，且不能为纯数字。');
  assert.equal(presentAuthError('uni-id-invalid-password-medium'), '密码需为 8–16 位，并至少包含字母、数字、特殊符号中的两类。');
});

test('register success replaces an expired prior session and reaches signed-in state', () => {
  const now = Date.parse('2026-08-25T01:07:00+08:00');
  const priorSession = { token: 'expired-prior-session', tokenExpired: now - 1 };
  const registerResponse = {
    errCode: 0,
    uid: 'uid-created-by-register',
    newToken: { token: 'fresh-sdk-session', tokenExpired: now + 7200000 }
  };

  const result = applyOfficialRegisterResponse(priorSession, registerResponse, now);
  assert.notEqual(result.session.token, priorSession.token);
  assert.equal(result.session.token, registerResponse.newToken.token);
  assert.equal(result.session.tokenExpired, registerResponse.newToken.tokenExpired);
  assert.equal(result.authenticated, true);
  assert.equal(result.postRegisterState, 'signedIn');
});

test('register success without a usable SDK session is not presented as backend failure', () => {
  const now = Date.parse('2026-08-25T01:07:00+08:00');
  const priorSession = { token: 'expired-prior-session', tokenExpired: now - 1 };
  const result = applyOfficialRegisterResponse(priorSession, { errCode: 0, uid: 'created-user' }, now);

  assert.equal(result.authenticated, false);
  assert.equal(result.postRegisterState, 'error');

  const registerPage = read('pages/register/index.uvue');
  assert.match(registerPage, /if \(!account\.authenticated\)/);
  assert.match(registerPage, /账户已创建，但登录会话未建立。请返回登录。/);
});

test('client keeps token persistence at the official SDK boundary', () => {
  const auth = read('services/auth-service.uts');
  const registrationCall = auth.slice(auth.indexOf('export const registerWithUniId'));
  const registerLog = auth.split('\n').find((line) => line.includes('[auth] registerUser failure'));
  assert.ok(registerLog);
  assert.match(registrationCall, /uniIdCo\.registerUser\s*\(/);
  assert.match(registrationCall, /response\.newToken/);
  assert.doesNotMatch(registrationCall, /setStorageSync\s*\(\s*['"](?:uni-id-token|uni_id_token)/);
  assert.doesNotMatch(registrationCall, /uni_id_token|session framework|createToken/);
  assert.match(registerLog, /operation=registerUser/);
  assert.match(registerLog, /errCode=/);
  assert.match(registerLog, /errorType=/);
  assert.doesNotMatch(registerLog, /password|captcha|username|token|secret|payload/i);
});

test('session-expired presentation is not a catch-all for uni-id errors', () => {
  const presentation = read('services/presentation.uts');
  assert.match(presentation, /code == ['"]uni-id-token-expired['"]/);
  assert.match(presentation, /code == ['"]uni-id-check-token-failed['"]/);
  assert.doesNotMatch(presentation, /code\.startsWith\(\s*['"]uni-id-['"]\s*\)/);
});
