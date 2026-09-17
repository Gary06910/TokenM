'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '../../apps/tokenm-android');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('uni-app x manifest keeps Honor Push disabled for this no-Push phase', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest['app-android'].distribute.modules['uni-push'], {});
  assert.equal(manifest.appid, '__UNI__46C9063');
});

test('Honor preparation keeps all real identity and credential values out of project config', () => {
  const manifest = read('manifest.json');
  const androidManifest = read('AndroidManifest.xml');
  assert.doesNotMatch(manifest, /HONOR_APP_ID|ClientSecret|AppSecret/);
  assert.doesNotMatch(androidManifest, /com\.hihonor\.push\.app_id/);
  assert.match(androidManifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(androidManifest, /dcloud_push_auto_request_permission[\s\S]{0,160}android:value="false"/);
});
