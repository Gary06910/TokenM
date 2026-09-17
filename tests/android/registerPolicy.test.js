'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '../../apps/tokenm-android');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function evaluateRegisterPolicy() {
  let source = read('services/register-policy.uts');
  source = source
    .replaceAll('export const ', 'const ')
    .replaceAll('(value: string): string', '(value)')
    .replaceAll('(code: string): boolean', '(code)');
  source += '\nmodule.exports = { registrationUsernameError, registrationPasswordError, registrationCaptchaShouldReload };';
  const context = { module: { exports: {} } };
  vm.runInNewContext(source, context, { filename: 'register-policy.uts' });
  return context.module.exports;
}

function evaluatePresentErrorCode() {
  const source = read('services/presentation.uts');
  const start = source.indexOf('export const presentErrorCode');
  const end = source.indexOf('export const presentError =', start);
  assert.ok(start >= 0 && end > start);
  let functionSource = source.slice(start, end)
    .replace('export const ', 'const ')
    .replace('(code: string, fallback: string): string', '(code, fallback)');
  functionSource += '\nmodule.exports = { presentErrorCode };';
  const context = { module: { exports: {} } };
  vm.runInNewContext(functionSource, context, { filename: 'presentation.uts' });
  return context.module.exports.presentErrorCode;
}

test('registration input policy executes the deployed medium password contract', () => {
  const { registrationUsernameError, registrationPasswordError } = evaluateRegisterPolicy();

  assert.equal(registrationUsernameError('valid_user-1'), '');
  assert.equal(registrationUsernameError('123456'), '用户名不能为纯数字。');
  assert.equal(registrationUsernameError('invalid user'), '用户名仅支持字母、数字、下划线和短横线。');

  assert.equal(registrationPasswordError('letters123'), '');
  assert.equal(registrationPasswordError('letters!'), '');
  assert.equal(registrationPasswordError('12345678'), '密码需为 8–16 位，并至少包含字母、数字、特殊符号中的两类。');
  assert.equal(registrationPasswordError('abcdefghijklmnopq1'), '密码需为 8–16 位，并至少包含字母、数字、特殊符号中的两类。');
});

test('registration error mapping executes distinct user-facing branches', () => {
  const presentErrorCode = evaluatePresentErrorCode();
  const fallback = 'unknown';

  assert.equal(presentErrorCode('uni-id-account-exists', fallback), '用户名已存在，请直接登录或更换用户名。');
  assert.equal(presentErrorCode('uni-id-invalid-username', fallback), '用户名仅支持字母、数字、下划线和短横线，且不能为纯数字。');
  assert.equal(presentErrorCode('uni-id-invalid-password-medium', fallback), '密码需为 8–16 位，并至少包含字母、数字、特殊符号中的两类。');
  assert.equal(presentErrorCode('uni-captcha-verify-fail', fallback), '验证码错误，请重新输入。');
  assert.equal(presentErrorCode('uni-captcha-verify-overdue', fallback), '验证码已失效，请刷新后重试。');
  assert.equal(presentErrorCode('uni-id-system-error', fallback), '注册服务暂时不可用，请稍后重试。');
  assert.equal(presentErrorCode('uni-cloud-request-timeout', fallback), '网络连接失败，请检查网络后重试。');
  assert.equal(presentErrorCode('unclassified-error', fallback), fallback);
});

test('captcha reload policy follows server verification order', () => {
  const { registrationCaptchaShouldReload } = evaluateRegisterPolicy();

  assert.equal(registrationCaptchaShouldReload('uni-id-account-exists'), true);
  assert.equal(registrationCaptchaShouldReload('uni-captcha-verify-fail'), true);
  assert.equal(registrationCaptchaShouldReload('uni-captcha-verify-overdue'), true);
  assert.equal(registrationCaptchaShouldReload('uni-id-system-error'), true);
  assert.equal(registrationCaptchaShouldReload('uni-id-invalid-password-medium'), false);
  assert.equal(registrationCaptchaShouldReload('uni-id-invalid-username'), false);
});

test('register page separates backend failure from successful-account navigation failure', () => {
  const registerPage = read('pages/register/index.uvue');
  const registerCall = registerPage.indexOf('await registerWithUsername');
  const registerCatch = registerPage.indexOf('} catch (error)', registerCall);
  const registerFinally = registerPage.indexOf('} finally {', registerCatch);
  const navigation = registerPage.indexOf('uni.redirectTo({', registerFinally);

  assert.ok(registerCall >= 0);
  assert.ok(registerCatch > registerCall);
  assert.ok(registerFinally > registerCatch);
  assert.ok(navigation > registerFinally);
  assert.match(registerPage.slice(registerCall, registerCatch), /if \(!account\.authenticated\)/);
  assert.match(registerPage.slice(registerCall, registerCatch), /账户已创建，但登录会话未建立/);
  assert.match(registerPage.slice(navigation), /账户已创建，但无法打开下一步/);
});
