'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../../apps/tokenm-android');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('uni-app x manifest keeps Xiaomi Push disabled for this no-Push phase', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest['app-android'].distribute.modules['uni-push'], {});
  assert.equal(manifest.appid, '__UNI__46C9063');
  assert.doesNotMatch(JSON.stringify(manifest), /AppSecret|AppKey|channel_id|template_id/);
});

test('Xiaomi provider setup is not required before the real Push phase', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest['app-android'].distribute.modules['uni-push'], {});
  assert.doesNotMatch(JSON.stringify(manifest), /uni-push.*(?:honor|xiaomi)/i);
});
