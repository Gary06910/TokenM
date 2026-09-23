'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MANAGED_CONFIG_NAME,
  installSupervisordService,
  removeSupervisordService,
  validateSupervisordService
} = require('../../src/server-agent/serviceInstaller');

const template = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'packaging', 'server-agent', 'supervisord', 'toknow-agent.conf.template'),
  'utf8'
);

function createSupervisorFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-supervisor-installer-'));
  const includeDirectory = path.join(root, 'supervisord.d');
  fs.mkdirSync(includeDirectory, { recursive: true });
  const configPath = path.join(root, 'supervisord.conf');
  fs.writeFileSync(configPath, `[supervisorctl]\nserverurl=unix:///tmp/supervisor.sock\n[include]\nfiles=${path.basename(includeDirectory)}/*.conf\n`, 'utf8');
  fs.writeFileSync(path.join(includeDirectory, 'platform.conf'), '[program:platform]\ncommand=/bin/true\n', 'utf8');

  const calls = [];
  const commandAvailable = (name) => ['supervisord', 'supervisorctl'].includes(name);
  const runCommand = (name, args) => {
    calls.push([name, ...args]);
    if (name === 'supervisord') return { status: 0, stdout: '4.2.5\n' };
    if (args[args.length - 1] === 'status' && args.length === 3) {
      return options.controlAvailable === false
        ? { status: 1, stdout: '', stderr: 'unix socket unavailable' }
        : { status: 0, stdout: 'platform RUNNING pid 88, uptime 1 day\n' };
    }
    if (args[args.length - 2] === 'status' && args[args.length - 1] === 'toknow-agent') {
      return {
        status: options.controlAvailable === false ? 1 : 0,
        stdout: options.programState === 'STOPPED'
          ? 'toknow-agent STOPPED not started\n'
          : 'toknow-agent RUNNING pid 123, uptime 0:01:00\n'
      };
    }
    return { status: 0, stdout: '' };
  };

  return {
    root,
    includeDirectory,
    configPath,
    calls,
    commandAvailable,
    runCommand,
    env: { HOME: path.join(root, 'user home'), PATH: '/usr/bin' },
    launcherPath: path.join(root, 'user home', '.local', 'bin', 'toknow-agent')
  };
}

function installerOptions(fixture, extra = {}) {
  return {
    env: fixture.env,
    supervisorConfig: fixture.configPath,
    launcherPath: fixture.launcherPath,
    templateContent: template,
    commandAvailable: fixture.commandAvailable,
    runCommand: fixture.runCommand,
    ...extra
  };
}

test('supervisord install writes one managed config and applies only the To Know program', () => {
  const fixture = createSupervisorFixture();
  const result = installSupervisordService(installerOptions(fixture));
  const configPath = path.join(fixture.includeDirectory, MANAGED_CONFIG_NAME);
  const config = fs.readFileSync(configPath, 'utf8');

  assert.equal(result.configPath, configPath);
  assert.match(config, /^; Managed by To Know Server Agent installer\.$/m);
  assert.match(config, /^\[program:toknow-agent\]$/m);
  assert.ok(config.includes(`command="${fixture.launcherPath.replaceAll('\\', '\\\\')}" run`));
  assert.doesNotMatch(config, /1\.0\.0|toknow-agent\/1\.0\.0/);
  assert.deepEqual(fixture.calls.slice(-3), [
    ['supervisorctl', '-c', fixture.configPath, 'reread'],
    ['supervisorctl', '-c', fixture.configPath, 'update', 'toknow-agent'],
    ['supervisorctl', '-c', fixture.configPath, 'status', 'toknow-agent']
  ]);
  assert.equal(fixture.calls.some((call) => call.at(-1) === 'all'), false);
});

test('supervisord preflight validates control, include, and ownership without writing', () => {
  const fixture = createSupervisorFixture();
  const result = validateSupervisordService(installerOptions(fixture));
  assert.equal(result.targetPath, path.join(fixture.includeDirectory, MANAGED_CONFIG_NAME));
  assert.match(result.generatedConfig, /^\[program:toknow-agent\]$/m);
  assert.equal(fs.existsSync(result.targetPath), false);
  assert.equal(fixture.calls.some((call) => call.at(-1) === 'reread' || call.at(-2) === 'update'), false);
});

test('supervisord install refuses control-socket absence before writing a config', () => {
  const fixture = createSupervisorFixture({ controlAvailable: false });
  assert.throws(
    () => installSupervisordService(installerOptions(fixture)),
    (error) => error.code === 'control_socket_unavailable'
  );
  assert.equal(fs.existsSync(path.join(fixture.includeDirectory, MANAGED_CONFIG_NAME)), false);
  assert.equal(fixture.calls.some((call) => call.at(-1) === 'reread'), false);
});

test('supervisord install refuses an unknown destination program without overwriting it', () => {
  const fixture = createSupervisorFixture();
  const targetPath = path.join(fixture.includeDirectory, MANAGED_CONFIG_NAME);
  const unknown = '[program:toknow-agent]\ncommand=/custom/toknow-agent run\n';
  fs.writeFileSync(targetPath, unknown, 'utf8');
  assert.throws(
    () => installSupervisordService(installerOptions(fixture)),
    (error) => error.code === 'unknown_supervisor_config_refused'
  );
  assert.equal(fs.readFileSync(targetPath, 'utf8'), unknown);
  assert.equal(fixture.calls.some((call) => call.at(-1) === 'reread'), false);
});

test('supervisord install refuses an unknown existing toknow-agent program in another include file', () => {
  const fixture = createSupervisorFixture();
  const unknownPath = path.join(fixture.includeDirectory, 'local.conf');
  const unknown = '[program:toknow-agent]\ncommand=/custom/toknow-agent run\n';
  fs.writeFileSync(unknownPath, unknown, 'utf8');
  assert.throws(
    () => installSupervisordService(installerOptions(fixture)),
    (error) => error.code === 'unknown_existing_program_refused'
  );
  assert.equal(fs.readFileSync(unknownPath, 'utf8'), unknown);
  assert.equal(fs.existsSync(path.join(fixture.includeDirectory, MANAGED_CONFIG_NAME)), false);
});

test('safe supervisord removal stops and deletes only the marked To Know program', () => {
  const fixture = createSupervisorFixture();
  installSupervisordService(installerOptions(fixture));
  fixture.calls.length = 0;
  const result = removeSupervisordService(installerOptions(fixture));

  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(path.join(fixture.includeDirectory, MANAGED_CONFIG_NAME)), false);
  assert.equal(fs.existsSync(path.join(fixture.includeDirectory, 'platform.conf')), true);
  assert.ok(fixture.calls.some((call) => call.at(-2) === 'stop' && call.at(-1) === 'toknow-agent'));
  assert.ok(fixture.calls.some((call) => call.at(-2) === 'update' && call.at(-1) === 'toknow-agent'));
  assert.equal(fixture.calls.some((call) => call.at(-1) === 'all' || call.at(-1) === 'platform'), false);
});

test('safe supervisord removal refuses unmarked configs and leaves them untouched', () => {
  const fixture = createSupervisorFixture();
  const targetPath = path.join(fixture.includeDirectory, MANAGED_CONFIG_NAME);
  const unknown = '[program:toknow-agent]\ncommand=/custom/toknow-agent run\n';
  fs.writeFileSync(targetPath, unknown, 'utf8');
  assert.throws(
    () => removeSupervisordService(installerOptions(fixture)),
    (error) => error.code === 'unknown_supervisor_config_refused'
  );
  assert.equal(fs.readFileSync(targetPath, 'utf8'), unknown);
  assert.equal(fixture.calls.some((call) => call.at(-2) === 'stop'), false);
});

test('supervisord removal does not stop an already stopped To Know program', () => {
  const fixture = createSupervisorFixture();
  installSupervisordService(installerOptions(fixture));
  fixture.calls.length = 0;
  fixture.runCommand = (name, args) => {
    fixture.calls.push([name, ...args]);
    if (name === 'supervisord') return { status: 0, stdout: '4.2.5' };
    if (args.at(-2) === 'status' && args.at(-1) === 'toknow-agent') {
      return { status: 0, stdout: 'toknow-agent STOPPED not started\n' };
    }
    return { status: 0, stdout: '' };
  };
  const result = removeSupervisordService(installerOptions(fixture));
  assert.equal(result.removed, true);
  assert.equal(fixture.calls.some((call) => call.at(-2) === 'stop'), false);
});
