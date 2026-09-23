'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  detectServiceEnvironment,
  inspectSupervisorBackend,
  parseSupervisorIncludePatterns,
  supervisorConfigFromPid1
} = require('../../src/server-agent/serviceDetection');

class FixtureFileSystem {
  constructor() {
    this.directories = new Set(['/']);
    this.files = new Map();
    this.handles = new Map();
    this.nextHandle = 1;
    this.mutations = [];
  }

  addDirectory(directory, { writable = true, symlink = false } = {}) {
    const absolute = path.posix.normalize(directory);
    const parts = absolute.split('/').filter(Boolean);
    let cursor = '/';
    for (const part of parts) {
      cursor = path.posix.join(cursor, part);
      this.directories.add(cursor);
    }
    if (symlink) this.files.set(absolute, { type: 'symlink', writable, data: '' });
    return absolute;
  }

  addFile(filePath, content = '', { writable = true } = {}) {
    const absolute = path.posix.normalize(filePath);
    this.addDirectory(path.posix.dirname(absolute));
    this.files.set(absolute, { type: 'file', writable, data: String(content) });
    return absolute;
  }

  statSync(filePath) {
    const absolute = path.posix.normalize(filePath);
    const entry = this.files.get(absolute);
    if (entry && entry.type !== 'symlink') return this.statObject('file', entry);
    if (entry?.type === 'symlink') throw Object.assign(new Error('fixture path missing'), { code: 'ENOENT' });
    if (this.directories.has(absolute)) return this.statObject('directory', { writable: true });
    throw Object.assign(new Error('fixture path missing'), { code: 'ENOENT' });
  }

  lstatSync(filePath) {
    const absolute = path.posix.normalize(filePath);
    const entry = this.files.get(absolute);
    if (entry) return this.statObject(entry.type, entry);
    if (this.directories.has(absolute)) return this.statObject('directory', { writable: true });
    throw Object.assign(new Error('fixture path missing'), { code: 'ENOENT' });
  }

  statObject(type, entry) {
    return {
      size: Buffer.byteLength(entry.data || '', 'utf8'),
      isFile: () => type === 'file',
      isDirectory: () => type === 'directory',
      isSymbolicLink: () => type === 'symlink'
    };
  }

  accessSync(filePath) {
    const entry = this.files.get(path.posix.normalize(filePath));
    const dirExists = this.directories.has(path.posix.normalize(filePath));
    if (entry?.writable === false || (!entry && !dirExists)) {
      throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' });
    }
  }

  realpathSync(filePath) {
    const absolute = path.posix.normalize(filePath);
    this.lstatSync(absolute);
    return absolute;
  }

  readFileSync(filePath, encoding) {
    const entry = this.files.get(path.posix.normalize(filePath));
    if (!entry || entry.type !== 'file') throw Object.assign(new Error('fixture file missing'), { code: 'ENOENT' });
    return encoding ? entry.data : Buffer.from(entry.data);
  }

  openSync(filePath) {
    const absolute = path.posix.normalize(filePath);
    const entry = this.files.get(absolute);
    if (!entry || entry.type !== 'file') throw Object.assign(new Error('fixture file missing'), { code: 'ENOENT' });
    const handle = this.nextHandle++;
    this.handles.set(handle, entry.data);
    return handle;
  }

  readSync(handle, buffer, offset, length) {
    const value = Buffer.from(this.handles.get(handle) || '');
    const bytes = value.subarray(0, length);
    bytes.copy(buffer, offset);
    return bytes.length;
  }

  closeSync(handle) {
    this.handles.delete(handle);
  }

  readdirSync(directory, options = {}) {
    const normalized = path.posix.normalize(directory);
    if (!this.directories.has(normalized)) throw Object.assign(new Error('fixture directory missing'), { code: 'ENOENT' });
    const entries = [];
    for (const filePath of this.files.keys()) {
      if (path.posix.dirname(filePath) !== normalized) continue;
      const entry = this.files.get(filePath);
      entries.push({
        name: path.posix.basename(filePath),
        isFile: () => entry.type === 'file',
        isDirectory: () => false,
        isSymbolicLink: () => entry.type === 'symlink'
      });
    }
    return options.withFileTypes ? entries : entries.map((entry) => entry.name);
  }
}

function baseFs() {
  const fsApi = new FixtureFileSystem();
  fsApi.addFile('/proc/1/comm', 'unknown\n');
  fsApi.addFile('/proc/1/cmdline', '/sbin/init\0');
  fsApi.addFile('/proc/1/cgroup', '0::/init.scope\n');
  fsApi.addFile('/proc/self/mountinfo', '1 0 0:1 / / rw - ext4 /dev/root rw\n');
  return fsApi;
}

function dependencySet(fsApi, available, { systemdOnline = false, supervisorOnline = false } = {}) {
  const commands = [];
  const commandAvailable = (name) => available.includes(name);
  const runCommand = (name, args) => {
    commands.push([name, ...args]);
    if (name === 'systemctl' && args[1] === 'show-environment') {
      return systemdOnline
        ? { status: 0, stdout: 'PRIVATE_TOKEN=must-not-leak\n' }
        : { status: 1, stdout: '', stderr: 'not connected' };
    }
    if (name === 'systemctl' && args[1] === 'is-system-running') {
      return { status: 0, stdout: 'running\n' };
    }
    if (name === 'supervisord') return { status: 0, stdout: '4.2.5\n' };
    if (name === 'supervisorctl') {
      return supervisorOnline
        ? { status: 0, stdout: 'toknow-agent RUNNING pid 123, uptime 0:01:00\n' }
        : { status: 1, stdout: '', stderr: 'unix socket unavailable' };
    }
    return { status: 1, stdout: '' };
  };
  return { fsApi, commandAvailable, runCommand, commands };
}

function addSupervisorFixture(fsApi, { configPath = '/etc/supervisor/supervisord.conf', include = 'conf.d/*.conf' } = {}) {
  const configDir = path.posix.dirname(configPath);
  fsApi.addDirectory(configDir);
  const includeDir = path.posix.resolve(configDir, path.posix.dirname(include));
  fsApi.addDirectory(includeDir);
  fsApi.addFile(configPath, `[supervisorctl]\nserverurl=unix:///tmp/supervisor.sock\n[include]\nfiles=${include}\n`);
  fsApi.addFile(path.posix.join(includeDir, 'existing.conf'), '[program:existing]\ncommand=/bin/true\n');
  return { configPath, includeDir };
}

test('current A800 fixture recommends container-external when supervisor control is unavailable', () => {
  const fsApi = baseFs();
  fsApi.addFile('/.dockerenv', '');
  fsApi.addFile('/proc/1/comm', 'supervisord\n');
  fsApi.addFile('/proc/1/cmdline', 'supervisord\0-c\0/usr/local/iCompute/etc/supervisord/supervisord.conf\0');
  fsApi.addFile('/proc/1/cgroup', '0::/kubepods.slice/pod-abc/containerd-xyz\n');
  fsApi.addFile('/proc/self/mountinfo', [
    '1 0 0:1 / / rw - overlay overlay rw',
    '2 1 0:2 / /home rw - ceph ceph-fuse rw'
  ].join('\n'));
  fsApi.addFile(
    '/usr/local/iCompute/etc/supervisord/supervisord.conf',
    '[unix_http_server]\nfile=/usr/local/libexec/.run/supervisor.sock\n[include]\nfiles=supervisord.d/*.conf\n'
  );
  fsApi.addDirectory('/usr/local/iCompute/etc/supervisord/supervisord.d');
  fsApi.addFile('/usr/local/iCompute/etc/supervisord/supervisord.d/platform.conf', '[program:platform]\ncommand=/bin/true\n');
  const deps = dependencySet(fsApi, ['systemctl', 'supervisord', 'supervisorctl']);
  const report = detectServiceEnvironment({
    ...deps,
    pathApi: path.posix,
    env: {
      HOME: '/home/user',
      PATH: '/usr/bin',
      KUBERNETES_SERVICE_HOST: '10.0.0.1',
      CODEX_HOME: '/secret/codex-home',
      AUTHORIZATION: 'secret-value'
    }
  });

  assert.equal(report.environment.container, true);
  assert.equal(report.environment.containerType, 'kubernetes');
  assert.equal(report.environment.kubernetes, true);
  assert.equal(report.environment.processManager, 'supervisord');
  assert.equal(report.backends['systemd-user'].available, false);
  assert.equal(report.backends['systemd-user'].binaryPresent, true);
  assert.equal(report.backends['systemd-user'].reason, 'user_manager_unavailable');
  assert.equal(report.backends.supervisord.processManagerDetected, true);
  assert.equal(report.backends.supervisord.supervisordBinaryPresent, true);
  assert.equal(report.backends.supervisord.version, '4.2.5');
  assert.equal(report.backends.supervisord.includeDirectoryAvailable, true);
  assert.equal(report.backends.supervisord.controlAvailable, false);
  assert.equal(report.backends.supervisord.managedInstallAvailable, false);
  assert.equal(report.backends.supervisord.reason, 'control_socket_unavailable');
  assert.equal(report.backends['container-external'].available, true);
  assert.equal(report.recommended, 'container-external');
  assert.deepEqual(report.runtimeContract.command, ['/home/user/.local/bin/toknow-agent', 'run']);
  assert.equal(report.runtimeContract.persistence.configPersistence, 'persistent-volume-supported');
  assert.equal(report.runtimeContract.persistence.runtimeDataPersistence, 'persistent-volume-supported');
  assert.equal(report.runtimeContract.persistence.serviceManagerConfig, 'ephemeral_or_orchestrator_managed');
  assert.deepEqual(deps.commands.map((command) => command.at(-1)), ['show-environment', '--version', 'status']);
  assert.equal(deps.commands.some((command) => /^(?:reread|update|enable|start|restart|stop)$/.test(command.at(-1))), false);
  assert.equal(fsApi.mutations.length, 0);

  const json = JSON.stringify(report);
  for (const secret of ['secret-value', 'CODEX_HOME', '/secret/codex-home', '10.0.0.1', 'supervisord -c']) {
    assert.equal(json.includes(secret), false, `JSON must not contain ${secret}`);
  }
});

test('ordinary Ubuntu fixture recommends a reachable systemd user manager', () => {
  const fsApi = baseFs();
  fsApi.addFile('/proc/1/comm', 'systemd\n');
  const deps = dependencySet(fsApi, ['systemctl'], { systemdOnline: true });
  const report = detectServiceEnvironment({
    ...deps,
    pathApi: path.posix,
    env: { HOME: '/home/alice', PATH: '/usr/bin' }
  });

  assert.equal(report.environment.container, false);
  assert.equal(report.environment.processManager, 'systemd');
  assert.equal(report.backends['systemd-user'].binaryPresent, true);
  assert.equal(report.backends['systemd-user'].userManagerReachable, true);
  assert.equal(report.backends['systemd-user'].userManagerState, 'running');
  assert.equal(report.backends['systemd-user'].available, true);
  assert.equal(report.recommended, 'systemd-user');
});

test('reachable systemd user manager remains authority when PID 1 is not systemd', () => {
  const fsApi = baseFs();
  fsApi.addFile('/proc/1/comm', 'tini\n');
  const deps = dependencySet(fsApi, ['systemctl'], { systemdOnline: true });
  const report = detectServiceEnvironment({
    ...deps,
    pathApi: path.posix,
    env: { HOME: '/home/alice', PATH: '/usr/bin' }
  });
  assert.equal(report.environment.processManager, 'tini');
  assert.equal(report.backends['systemd-user'].available, true);
  assert.equal(report.recommended, 'systemd-user');
});

test('traditional supervisord fixture recommends the controllable backend', () => {
  const fsApi = baseFs();
  fsApi.addFile('/proc/1/comm', 'supervisord\n');
  fsApi.addFile('/proc/1/cmdline', 'supervisord\0-c\0/etc/supervisor/supervisord.conf\0');
  const { configPath } = addSupervisorFixture(fsApi);
  const deps = dependencySet(fsApi, ['supervisord', 'supervisorctl'], { supervisorOnline: true });
  const report = detectServiceEnvironment({
    ...deps,
    pathApi: path.posix,
    env: { HOME: '/home/operator', PATH: '/usr/bin' }
  });
  assert.equal(report.environment.container, false);
  assert.equal(report.backends.supervisord.version, '4.2.5');
  assert.equal(report.backends.supervisord.configDiscovered, true);
  assert.equal(report.backends.supervisord.controlAvailable, true);
  assert.equal(report.backends.supervisord.managedInstallAvailable, true);
  assert.equal(report.recommended, 'supervisord');
  assert.equal(JSON.stringify(report).includes(configPath), false);
});

test('Kubernetes with tini and no in-container manager recommends container-external', () => {
  const fsApi = baseFs();
  fsApi.addFile('/proc/1/comm', 'tini\n');
  fsApi.addFile('/proc/1/cgroup', '0::/kubepods/burstable/pod-abcd\n');
  const deps = dependencySet(fsApi, []);
  const report = detectServiceEnvironment({
    ...deps,
    pathApi: path.posix,
    env: { HOME: '/home/app', PATH: '/usr/bin', KUBERNETES_SERVICE_HOST: '10.0.0.2' }
  });
  assert.equal(report.environment.container, true);
  assert.equal(report.environment.kubernetes, true);
  assert.equal(report.environment.processManager, 'tini');
  assert.equal(report.recommended, 'container-external');
});

test('unknown Linux without manager or container evidence recommends foreground', () => {
  const fsApi = baseFs();
  const deps = dependencySet(fsApi, []);
  const report = detectServiceEnvironment({
    ...deps,
    pathApi: path.posix,
    env: { HOME: '/home/operator', PATH: '/usr/bin' }
  });
  assert.equal(report.environment.container, false);
  assert.equal(report.recommended, 'none');
  assert.equal(report.backends.none.available, true);
  assert.equal(report.backends.none.autoRestart, false);
  assert.equal(report.runtimeContract.persistence.processRestart, 'manual');
});

test('supervisord binary and control tools are reported separately', () => {
  const fsApi = baseFs();
  const { configPath } = addSupervisorFixture(fsApi);
  const missingSupervisor = inspectSupervisorBackend({
    fsApi,
    pathApi: path.posix,
    env: { PATH: '/usr/bin' },
    supervisorConfig: configPath,
    commandAvailable: (name) => name === 'supervisorctl',
    runCommand: () => ({ status: 0, stdout: '' })
  });
  assert.equal(missingSupervisor.report.supervisordBinaryPresent, false);
  assert.equal(missingSupervisor.report.supervisorctlBinaryPresent, true);
  assert.equal(missingSupervisor.report.reason, 'supervisord_binary_missing');

  const missingCtl = inspectSupervisorBackend({
    fsApi,
    pathApi: path.posix,
    env: { PATH: '/usr/bin' },
    supervisorConfig: configPath,
    commandAvailable: (name) => name === 'supervisord',
    runCommand: () => ({ status: 0, stdout: '4.2.5' })
  });
  assert.equal(missingCtl.report.supervisordBinaryPresent, true);
  assert.equal(missingCtl.report.supervisorctlBinaryPresent, false);
  assert.equal(missingCtl.report.controlAvailable, false);
  assert.equal(missingCtl.report.reason, 'supervisorctl_binary_missing');
});

test('PID 1 config parsing accepts only bounded absolute supervisor paths', () => {
  assert.equal(supervisorConfigFromPid1('supervisord\0-c\0/usr/local/etc/supervisord.conf\0', path.posix), '/usr/local/etc/supervisord.conf');
  assert.equal(supervisorConfigFromPid1(`supervisord\0-c\0${'x'.repeat(5000)}\0`, path.posix), null);
  assert.equal(supervisorConfigFromPid1('sh\0-c\0/etc/supervisord.conf\0', path.posix), null);
  assert.equal(supervisorConfigFromPid1('supervisord\0-c\0relative.conf\0', path.posix), null);
});

test('include discovery resolves config-relative glob directories without shell execution', () => {
  const patterns = parseSupervisorIncludePatterns('[include]\nfiles=supervisord.d/*.conf\n', '/usr/local/etc/supervisord/supervisord.conf', {
    pathApi: path.posix
  });
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].directory, '/usr/local/etc/supervisord/supervisord.d');
  assert.equal(patterns[0].basenamePattern, '*.conf');
});
