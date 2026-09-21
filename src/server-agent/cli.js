'use strict';

const { parseArgs } = require('../shared/config');
const { loadServerAgentConfig } = require('./config');
const { createServerAgentPaths } = require('./paths');
const { createServerAgentSupervisor } = require('./supervisor');

async function run(argv = process.argv.slice(2)) {
  const command = argv.find((value) => !String(value).startsWith('--')) || 'run';
  if (!['run', 'once'].includes(command)) throw new Error(`unknown server-agent command: ${command}`);
  const args = parseArgs(argv.filter((value) => value !== command));
  const paths = createServerAgentPaths({
    configRoot: args.configRoot,
    dataRoot: args.dataRoot,
    stateRoot: args.stateRoot
  });
  const configPath = args.config || paths.configFile;
  const config = loadServerAgentConfig(configPath);
  const supervisor = createServerAgentSupervisor({
    config,
    paths,
    once: command === 'once',
    agentVersion: args.agentVersion,
    watchEnabled: args.watch === '0' ? false : undefined
  });

  await supervisor.start();
  if (command === 'once') {
    await supervisor.waitForSnapshots();
    const snapshots = supervisor.getAllSnapshots();
    process.stdout.write(`${JSON.stringify(snapshots)}\n`);
    await supervisor.stop();
    return snapshots;
  }

  const stop = () => { void supervisor.stop(); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
  return supervisor;
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`server-agent failed: ${error.code || 'runtime-error'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run };
