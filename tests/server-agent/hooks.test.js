'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { serverHookCommand } = require('../../src/server-agent/hooks');
const { parseServerAgentConfig } = require('../../src/server-agent/config');
const { createServerAgentPaths } = require('../../src/server-agent/paths');
const {
  disableCodexStopHook,
  enableCodexStopHook,
  readCodexHookState
} = require('../../src/shared/notification/codexStopHook');
const { writePrivateJsonAtomic } = require('../../src/shared/credentialStore');

const DESKTOP_ID = 'dev_11111111-1111-4111-8111-111111111111';
const CREDENTIAL = `tm_uc_d1.${DESKTOP_ID}.${'x'.repeat(43)}`;

function cleanupFixture(root, files, directories) {
  for (const file of files) if (fs.existsSync(file)) fs.unlinkSync(file);
  for (const directory of directories.slice().reverse()) {
    if (fs.existsSync(directory)) {
      for (const name of fs.readdirSync(directory)) {
        const candidate = path.join(directory, name);
        if (fs.lstatSync(candidate).isFile()) fs.unlinkSync(candidate);
      }
      try { fs.rmdirSync(directory); } catch (_) {}
    }
  }
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-server-hooks-'));
  const codexHome = path.join(root, 'codex business 演示');
  fs.mkdirSync(codexHome, { recursive: true });
  const paths = createServerAgentPaths({ root });
  const config = parseServerAgentConfig({
    version: 1,
    endpoint: 'https://android.example.test/tokenm-desktop-http',
    profiles: [{ id: 'business', name: 'Business', codexHome, enabled: true }]
  });
  writePrivateJsonAtomic(paths.credentialFile, {
    version: 1,
    credential: CREDENTIAL,
    desktopId: DESKTOP_ID,
    desktopName: 'A800 Server'
  });
  const hooksPath = path.join(codexHome, 'hooks.json');
  t.after(() => cleanupFixture(root, [paths.credentialFile, hooksPath, `${hooksPath}.token-m-backup-placeholder`], [paths.notificationRoot, paths.stateRoot, path.dirname(paths.credentialFile), codexHome, root]));
  return { root, codexHome, paths, config, hooksPath };
}

test('serverHookCommand is stable, correctly quoted, and contains no runtime identity', () => {
  const command = serverHookCommand({
    launcherPath: '/home/用户/.local/bin/to know-agent',
    profileId: 'business'
  });
  assert.equal(command, "'/home/用户/.local/bin/to know-agent' hook --profile 'business'");
  assert.doesNotMatch(command, /1\.0\.0|credential|runtime|CODEX_HOME/i);
  assert.equal(
    serverHookCommand({ launcherPath: '/home/用户/.local/bin/to know-agent', profileId: 'business' }),
    serverHookCommand({ launcherPath: '/home/用户/.local/bin/to know-agent', profileId: 'business' })
  );
  assert.throws(() => serverHookCommand({ launcherPath: 'relative/toknow-agent', profileId: 'business' }), /absolute/);
  assert.throws(() => serverHookCommand({ launcherPath: '/home/toknow-agent', profileId: 'Business' }), /profile/);
});

test('enable and disable preserve unrelated hooks and require first trust', (t) => {
  const setup = fixture(t);
  const original = {
    hooks: {
      Stop: [
        { matcher: 'always', hooks: [{ type: 'command', command: 'other-tool' }] }
      ],
      Start: [{ hooks: [{ type: 'command', command: 'start-tool' }] }]
    },
    unrelated: true
  };
  fs.writeFileSync(setup.hooksPath, `${JSON.stringify(original, null, 2)}\n`);
  const command = serverHookCommand({ launcherPath: '/home/user/.local/bin/toknow-agent', profileId: 'business' });
  const enabled = enableCodexStopHook({ codexHome: setup.codexHome, command });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.needsTrust, true);
  assert.equal(readCodexHookState({ codexHome: setup.codexHome, commandIdentity: command }).needsTrust, true);
  const merged = JSON.parse(fs.readFileSync(setup.hooksPath, 'utf8'));
  assert.equal(merged.unrelated, true);
  assert.equal(merged.hooks.Start[0].hooks[0].command, 'start-tool');
  assert.equal(merged.hooks.Stop.length, 2);
  assert.equal(merged.hooks.Stop[1].hooks[0].command, command);

  const disabled = disableCodexStopHook({ codexHome: setup.codexHome, commandIdentity: command });
  assert.equal(disabled.enabled, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(setup.hooksPath, 'utf8')), original);
});

test('separate profile homes receive isolated Hook files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-server-profile-hooks-'));
  const businessHome = path.join(root, 'business');
  const personalHome = path.join(root, 'personal');
  fs.mkdirSync(businessHome, { recursive: true });
  fs.mkdirSync(personalHome, { recursive: true });
  const business = serverHookCommand({ launcherPath: '/home/user/.local/bin/toknow-agent', profileId: 'business' });
  const personal = serverHookCommand({ launcherPath: '/home/user/.local/bin/toknow-agent', profileId: 'personal' });
  t.after(() => cleanupFixture(root, [path.join(businessHome, 'hooks.json'), path.join(personalHome, 'hooks.json')], [businessHome, personalHome, root]));

  enableCodexStopHook({ codexHome: businessHome, command: business });
  enableCodexStopHook({ codexHome: personalHome, command: personal });
  disableCodexStopHook({ codexHome: businessHome, commandIdentity: business });
  assert.equal(readCodexHookState({ codexHome: personalHome, commandIdentity: personal }).enabled, true);
  assert.equal(readCodexHookState({ codexHome: businessHome, commandIdentity: business }).enabled, false);
});
