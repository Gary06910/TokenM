'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  disableCodexStopHook,
  enableCodexStopHook,
  readCodexHookState
} = require('../../src/electron/codexStopHook');

function fixture(t) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'token-m-hooks-'));
  const files = new Set();
  t.after(() => {
    for (const file of files) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(codexHome);
  });
  return { codexHome, files };
}

test('merges and exactly disables the Token M Stop hook while preserving other hooks', (t) => {
  const { codexHome, files } = fixture(t);
  const configPath = path.join(codexHome, 'hooks.json');
  files.add(configPath);
  const original = {
    custom: { retained: true },
    hooks: {
      Stop: [{ matcher: 'always', hooks: [{ type: 'command', command: 'other-tool', timeout: 30 }] }],
      Start: [{ hooks: [{ type: 'command', command: 'start-tool' }] }]
    }
  };
  fs.writeFileSync(configPath, `${JSON.stringify(original, null, 2)}\n`);

  const enabled = enableCodexStopHook({
    codexHome,
    command: 'token-m-posix',
    commandWindows: 'token-m-win'
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.needsTrust, true);
  assert.ok(enabled.backupPath);
  files.add(enabled.backupPath);
  assert.equal(fs.readFileSync(enabled.backupPath, 'utf8'), `${JSON.stringify(original, null, 2)}\n`);

  const merged = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(merged.custom.retained, true);
  assert.equal(merged.hooks.Start[0].hooks[0].command, 'start-tool');
  assert.equal(merged.hooks.Stop.length, 2);
  assert.equal(merged.hooks.Stop[1].hooks[0].command, 'token-m-posix');
  assert.equal(merged.hooks.Stop[1].hooks[0].commandWindows, 'token-m-win');
  assert.equal(merged.hooks.Stop[1].hooks[0].timeout, 5);

  const duplicate = enableCodexStopHook({ codexHome, command: 'token-m-posix', commandWindows: 'token-m-win' });
  assert.equal(duplicate.backupPath, null);
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).hooks.Stop.length, 2);

  const disabled = disableCodexStopHook({
    codexHome,
    commandIdentity: { command: 'token-m-posix', commandWindows: 'token-m-win' }
  });
  assert.equal(disabled.enabled, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), original);
});

test('migrates the legacy Windows shell command in place without adding a duplicate Stop hook', (t) => {
  const { codexHome, files } = fixture(t);
  const configPath = path.join(codexHome, 'hooks.json');
  files.add(configPath);
  const legacy = 'set "ELECTRON_RUN_AS_NODE=1"&&"C:\\Program Files (x86)\\Token M\\electron.exe"';
  fs.writeFileSync(configPath, `${JSON.stringify({
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: legacy, timeout: 5 }] }] }
  }, null, 2)}\n`);

  const state = enableCodexStopHook({
    codexHome,
    command: 'powershell.exe -EncodedCommand stable',
    commandWindows: 'powershell.exe -EncodedCommand stable',
    legacyCommands: [legacy]
  });
  files.add(state.backupPath);
  assert.equal(state.enabled, true);
  const stop = JSON.parse(fs.readFileSync(configPath, 'utf8')).hooks.Stop;
  assert.equal(stop.length, 1);
  assert.deepEqual(stop[0].hooks[0], {
    type: 'command',
    command: 'powershell.exe -EncodedCommand stable',
    commandWindows: 'powershell.exe -EncodedCommand stable',
    timeout: 5
  });
});

test('reports malformed files without overwriting them', (t) => {
  const { codexHome, files } = fixture(t);
  const configPath = path.join(codexHome, 'hooks.json');
  files.add(configPath);
  fs.writeFileSync(configPath, '{broken');
  const state = enableCodexStopHook({ codexHome, command: 'token-m' });
  assert.equal(state.enabled, false);
  assert.match(state.error, /JSON/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{broken');
});

test('refuses a hooks.json reported as a symlink', (t) => {
  const { codexHome } = fixture(t);
  const configPath = path.join(codexHome, 'hooks.json');
  const fsApi = Object.create(fs);
  fsApi.lstatSync = (target) => {
    if (target === configPath) return { isFile: () => false, isSymbolicLink: () => true, size: 0 };
    return fs.lstatSync(target);
  };
  const state = readCodexHookState({ codexHome, commandIdentity: 'token-m', fs: fsApi });
  assert.equal(state.enabled, false);
  assert.match(state.error, /regular file/);
});
