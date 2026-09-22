'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../shared/config');
const { reportFailure, run: runHookForwarder } = require('../shared/notification/codexHookForwarder');
const { disableCodexStopHook, enableCodexStopHook, readCodexHookState } = require('../shared/notification/codexStopHook');
const { loadServerAgentConfig, normalizeProfileId } = require('./config');
const { loadServerCredential } = require('./notificationRuntime');
const { serverHookCommand, stableLauncherPath } = require('./hooks');
const { createServerAgentPaths } = require('./paths');

function packageJsonPath() {
  return path.join(__dirname, '..', '..', 'package.json');
}

function readServerAgentVersion() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath(), 'utf8'));
  return String(packageJson.version || '0.0.0');
}

function isVersionRequest(argv) {
  return argv.includes('--version') || argv.includes('-v');
}

function safeCode(error, fallback = 'server_agent_failed') {
  const code = String(error?.code || fallback);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : fallback;
}

function commandError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function enabledProfileIds(config) {
  return config.profiles.filter((profile) => profile.enabled).map((profile) => profile.id);
}

function assertCompleteSnapshots(config, snapshots) {
  const expected = enabledProfileIds(config);
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)
    || expected.length === 0 || expected.some((profileId) => !Object.hasOwn(snapshots, profileId))) {
    throw commandError('snapshot_incomplete');
  }
  return snapshots;
}

function optionValue(args, ...names) {
  for (const name of names) {
    if (args[name] !== undefined) return args[name];
  }
  return undefined;
}

function pathsForArgs(args) {
  return createServerAgentPaths({
    root: optionValue(args, 'root'),
    configRoot: optionValue(args, 'configRoot', 'config-root'),
    dataRoot: optionValue(args, 'dataRoot', 'data-root'),
    stateRoot: optionValue(args, 'stateRoot', 'state-root')
  });
}

function configForArgs(args, paths) {
  const configPath = optionValue(args, 'config') || paths.configFile;
  return { config: loadServerAgentConfig(configPath), configPath };
}

function profileForConfig(config, profileId) {
  let id;
  try { id = normalizeProfileId(profileId); } catch (_) { throw commandError('invalid_profile'); }
  const profile = config.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw commandError('unknown_profile');
  return profile;
}

function launcherForArgs(args) {
  return optionValue(args, 'launcherPath', 'launcher') || stableLauncherPath();
}

function configFileState(codexHome) {
  const filePath = path.join(codexHome, 'hooks.json');
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() ? 'present' : 'invalid';
  } catch (error) {
    return error.code === 'ENOENT' ? 'missing' : 'unreadable';
  }
}

function hookIdentity(profileId, args) {
  return serverHookCommand({ launcherPath: launcherForArgs(args), profileId });
}

function hookStatus(config, profile, args) {
  const command = hookIdentity(profile.id, args);
  const state = readCodexHookState({ codexHome: profile.codexHome, commandIdentity: command });
  return {
    profileId: profile.id,
    configured: state.enabled,
    configFileState: configFileState(profile.codexHome),
    needsTrust: state.needsTrust === true,
    error: state.error ? 'hook_config_error' : null
  };
}

function notificationCredentialState(paths) {
  try {
    const credential = loadServerCredential(paths.credentialFile);
    return credential.state;
  } catch (error) {
    return safeCode(error, 'invalid_credential');
  }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  return value;
}

async function runHooks(subcommand, args) {
  if (!['status', 'enable', 'disable'].includes(subcommand)) {
    throw commandError('unknown_hooks_command');
  }
  const paths = pathsForArgs(args);
  const { config } = configForArgs(args, paths);
  const profile = profileForConfig(config, optionValue(args, 'profile'));
  if (subcommand === 'status') return writeJson(hookStatus(config, profile, args));
  if (subcommand === 'enable') {
    const credentialState = notificationCredentialState(paths);
    if (credentialState === 'unconfigured') throw commandError('notification_not_configured');
    if (credentialState !== 'configured') throw commandError('invalid_credential');
    const command = hookIdentity(profile.id, args);
    const state = enableCodexStopHook({ codexHome: profile.codexHome, command });
    if (state.error || !state.enabled) throw commandError('hook_enable_failed');
    return writeJson({ profileId: profile.id, configured: true, needsTrust: true });
  }
  const command = hookIdentity(profile.id, args);
  const state = disableCodexStopHook({ codexHome: profile.codexHome, commandIdentity: command });
  if (state.error) throw commandError('hook_disable_failed');
  return writeJson({ profileId: profile.id, configured: false, needsTrust: false });
}

async function runHookFailOpen(args) {
  try {
    const paths = pathsForArgs(args);
    const profileId = optionValue(args, 'profile');
    await runHookForwarder({ runtimePath: paths.notificationRuntimePath, profileId });
    process.stdout.write('{}\n');
  } catch (error) {
    // The Stop Hook is an optional notification side effect. Never let an
    // unavailable bridge, credential, or cloud endpoint fail the Codex task.
    reportFailure(error);
  }
  return undefined;
}

async function run(argv = process.argv.slice(2), deps = {}) {
  if (isVersionRequest(argv)) {
    const version = readServerAgentVersion();
    process.stdout.write(`To Know Server Agent ${version}\n`);
    return version;
  }

  const args = parseArgs(argv);
  const positional = argv.filter((value) => !String(value).startsWith('--'));
  const command = positional[0] || 'run';
  if (command === 'hook') return runHookFailOpen(args);
  if (command === 'hooks') return runHooks(positional[1], args);
  if (!['run', 'once'].includes(command)) throw commandError('unknown_server_agent_command');
  const paths = pathsForArgs(args);
  const { config } = configForArgs(args, paths);
  const createServerAgentSupervisor = deps.createServerAgentSupervisor
    || require('./supervisor').createServerAgentSupervisor;
  const supervisor = createServerAgentSupervisor({
    config,
    paths,
    once: command === 'once',
    agentVersion: args.agentVersion,
    watchEnabled: args.watch === '0' ? false : undefined
  });

  await supervisor.start();
  if (command === 'once') {
    try {
      await supervisor.waitForSnapshots();
      const snapshots = assertCompleteSnapshots(config, supervisor.getAllSnapshots());
      process.stdout.write(`${JSON.stringify(snapshots)}\n`);
      return snapshots;
    } finally {
      await supervisor.stop();
    }
  }

  const stop = () => { void supervisor.stop(); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
  return supervisor;
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`server-agent failed: ${safeCode(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  configFileState,
  hookStatus,
  isVersionRequest,
  packageJsonPath,
  readServerAgentVersion,
  assertCompleteSnapshots,
  enabledProfileIds,
  run,
  runHookFailOpen,
  runHooks
};
