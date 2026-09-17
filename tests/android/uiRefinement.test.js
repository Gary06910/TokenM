'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../../apps/tokenm-android');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const page = (name) => read(`pages/${name}/index.uvue`);
const template = (source) => source.slice(0, source.indexOf('<script'));

test('application UI uses labeled controls without font glyph or Web CSS dependencies', () => {
  const pages = JSON.parse(read('pages.json')).pages.map(({ path: p }) => read(`${p}.uvue`));
  const components = fs.readdirSync(path.join(root, 'components')).map((name) => read(`components/${name}/${name}.uvue`));
  const source = [read('App.uvue'), ...pages, ...components].join('\n');
  assert.doesNotMatch(source, /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u);
  assert.doesNotMatch(source, /iconfont|uni-id-pages-x-icons|::before|@keyframes|\banimation\s*:|:active|\b(?:calc|var)\s*\(|\d(?:vh|vw)\b/);
  for (const source of pages) assert.match(source, /<scroll-view\b[^>]*direction="vertical"/);
  assert.match(read('components/tm-tab-bar/tm-tab-bar.uvue'), /env\(safe-area-inset-bottom\)/);
  assert.match(read('App.uvue'), /\$tm-touch/);
});

test('home uses real notification preference and bounds recent content without onboarding facts', () => {
  const source = template(page('dashboard'));
  assert.match(source, /!dashboard\.notifications\.notificationsEnabled/);
  assert.match(source, /runtimeFacts\.pushReadiness == 'ready'/);
  assert.match(source, /dashboard\.recentTasks\.slice\(0, 3\)/);
  assert.match(source, /dashboard\.desktops\.slice\(0, 3\)/);
  assert.ok(source.indexOf('最近任务') < source.indexOf('section-title">电脑'));
  assert.doesNotMatch(source, /loginFactView|consentFactView|mobileRegistrationFactView/);
});

test('task privacy and completion are distinct from notification delivery', () => {
  const tasks = template(page('tasks'));
  assert.match(tasks, /已完成/);
  assert.match(tasks, /v-if="item\.privacyMode"[^>]*>隐私模式 · 未同步任务内容/);
  assert.match(tasks, /item\.desktopName/);
  assert.match(tasks, /formatRelativeTime\(item\.occurredAt/);
  const detail = template(page('task-detail'));
  for (const title of ['电脑与时间', '通知', '隐私']) assert.ok(detail.includes(title));
  assert.doesNotMatch(tasks + detail, /\{\{[^}]*\b(?:eventId|sessionId|notificationProviderStage|notificationProviderCode|ownerId)\b/);
  const presentation = read('services/presentation.uts');
  assert.match(presentation, /case 'submitted': return \{ label: '通知已发送'/);
  assert.match(presentation, /推送服务已接受发送请求/);
  assert.doesNotMatch(presentation, /下一阶段接入/);
});

test('pairing success hides the code and preserves copy refresh confirmation and lifecycle cleanup', () => {
  const source = page('pairing');
  assert.match(source, /<view v-if="!paired" :class="\['pair-card'/);
  assert.match(source, /@click="copyCode"/);
  assert.match(source, /@click="confirmRefresh"/);
  assert.match(source, /if \(result\.confirm\) createCode\(\)/);
  assert.match(source, /onHide\(\(\) => \{\s*stopTimers\(\)/);
  assert.match(source, /onUnload\(\(\) => \{\s*stopTimers\(\)/);
  assert.match(source, /取消并返回电脑列表/);
  assert.match(source, /离开后，配对码仍在显示的有效期内可用/);
});

test('settings and permission retain guarded notification consent and destructive actions', () => {
  const settings = page('settings');
  for (const action of ['toggleNotifications', 'goNotifications', 'goDesktops', 'goPrivacy', 'goAbout', 'confirmLogout']) assert.ok(settings.includes(`="${action}"`));
  assert.match(settings, /if \(!result\.confirm\) return\s+runLogout\(\)/);
  assert.match(page('desktops'), /if \(!result\.confirm\) return\s+runUnbind\(desktop\)/);
  const privacy = page('privacy');
  assert.match(privacy, /if \(!result\.confirm\) return\s+runClear\(\)/);
  assert.match(privacy, /if \(!result\.confirm\) return\s+runDelete\(\)/);
  const permission = page('permission');
  assert.match(permission, /:disabled="!privacyConfirmed \|\| working"/);
  assert.match(permission, /@click="acceptConsent"/);
  assert.match(permission, /@click="requestNotificationPermissionFromCtaAction"/);
  assert.match(permission, /@click="continueToApp"/);
  assert.doesNotMatch(template(permission) + template(page('notifications')), /Phase 1|Push API|listener|CID/);
});

test('warm columns continue rendering cache before nonblocking refresh and retain error banners', () => {
  for (const name of ['dashboard', 'tasks', 'desktops', 'settings']) {
    const source = page(name);
    assert.match(source, /restoreCached\(\)/);
    assert.match(source, /\.peek\(\)/);
    assert.match(source, /if \(!keepExisting\) state\.value = 'loading'/);
    assert.match(source, /if \(keepExisting\)[\s\S]*banner\.value/);
    assert.match(source, /isPageCacheSessionCurrent\(session\)/);
    const onShow = source.match(/onShow\(\(\) => \{([^}]+)\}/)[1];
    assert.match(onShow, /restoreCached\(\)/);
    assert.doesNotMatch(onShow, /await|bootstrap/);
  }
});
