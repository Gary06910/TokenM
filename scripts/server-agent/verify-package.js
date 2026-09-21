'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadRuntimeManifest, validateRuntimeManifest } = require('./fetch-node-runtime');

const REQUIRED_PATHS = Object.freeze([
  'bin/toknow-agent',
  'install.sh',
  'runtime/manifest.json',
  'runtime/node/bin/node',
  'app/src/server-agent',
  'app/src/shared',
  'app/node_modules',
  'app/package.json',
  'app/LICENSE',
  'VERSION'
]);

const FORBIDDEN_TOP_LEVEL_PATHS = new Set(['.git', 'apps', 'docs', 'tests', 'src']);
const FORBIDDEN_SENSITIVE_BASENAMES = new Set([
  'auth.json',
  'credentials.json',
  'settings.json',
  'token-m-notification-runtime.json'
]);

class PackageVerificationError extends Error {
  constructor(errors) {
    super(`server-agent package verification failed: ${errors.join('; ')}`);
    this.name = 'PackageVerificationError';
    this.code = 'invalid-server-agent-package';
    this.errors = errors;
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function pathExists(root, relativePath) {
  return fs.existsSync(path.join(root, ...relativePath.split('/')));
}

function collectRelativePaths(root, current = '') {
  const absolute = path.join(root, current);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = toPosix(path.join(current, entry.name));
    const entryPath = path.join(root, ...relative.split('/'));
    result.push(relative);
    if (entry.isDirectory()) result.push(...collectRelativePaths(root, relative));
    if (entry.isSymbolicLink()) {
      let target;
      try {
        target = fs.realpathSync(entryPath);
      } catch (_) {
        result.push(`${relative} -> broken-symlink`);
        continue;
      }
      const targetRelative = path.relative(root, target);
      if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) {
        result.push(`${relative} -> symlink-escapes-package`);
      }
    }
  }
  return result;
}

function forbiddenReason(relativePath) {
  const normalized = toPosix(relativePath);
  const lower = normalized.toLowerCase();
  const segments = lower.split('/');
  const base = segments[segments.length - 1];
  if (segments[0] && FORBIDDEN_TOP_LEVEL_PATHS.has(segments[0])) return 'forbidden top-level source tree';
  if (segments.includes('.git')) return 'Git metadata';
  if (lower === 'app/src/electron' || lower.startsWith('app/src/electron/')) return 'Electron source';
  if (lower === 'app/apps/tokenm-android' || lower.startsWith('app/apps/tokenm-android/')) return 'Android source';
  if (base === '.env' || base.startsWith('.env.')) return 'environment file';
  if (FORBIDDEN_SENSITIVE_BASENAMES.has(base)) return 'sensitive runtime file';
  if (base.endsWith('.log')) return 'log file';
  if (/outbox.*\.json$/i.test(base)) return 'outbox JSON';
  if (base === 'config.json' && normalized !== 'app/package.json') return 'user-specific config';
  if (lower.includes('/.codex/') || lower.startsWith('.codex/')) return 'Codex session data';
  if (lower.includes('phase0') && lower.includes('credential')) return 'Phase0 credential';
  if (lower.includes('symlink-escapes-package') || lower.includes('broken-symlink')) return 'invalid symlink';
  return '';
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function verifyLauncher(packageRoot, errors) {
  const launcherPath = path.join(packageRoot, 'bin', 'toknow-agent');
  const launcher = readText(launcherPath);
  if (!launcher.includes('"$PACKAGE_ROOT/runtime/node/bin/node"')) {
    errors.push('launcher does not execute the bundled Node runtime');
  }
  if (!launcher.includes('"$PACKAGE_ROOT/app/src/server-agent/cli.js"')) {
    errors.push('launcher does not execute the packaged server-agent CLI');
  }
  if (/\b(?:npm|npx)\b/i.test(launcher)) errors.push('launcher invokes npm or npx');
  if (/\/usr\/(?:local\/)?bin\/node\b|\bnodejs\b/i.test(launcher)) errors.push('launcher invokes system Node');
  if (/ELECTRON_RUN_AS_NODE|electron(?:\.exe)?\b|\b(?:DISPLAY|WAYLAND_DISPLAY|X11|Wayland)\b/i.test(launcher)) {
    errors.push('launcher contains an Electron or display dependency');
  }
  if (/[A-Za-z]:[\\/]|\/home\/|\/Users\/|\/workspace\/|\/tmp\//i.test(launcher)) {
    errors.push('launcher contains a checkout or user absolute path');
  }
  if (launcher.includes('process.cwd') || !launcher.includes('$0')) errors.push('launcher is not self-relative');
}

function verifyInstallScript(packageRoot, errors) {
  const script = readText(path.join(packageRoot, 'install.sh'));
  if (/\bsudo\b|\/usr\/local|\/etc\/systemd|systemd/i.test(script)) {
    errors.push('install.sh contains a system-wide or systemd installation');
  }
  if (!script.includes('TO_KNOW_INSTALL_ROOT') || !script.includes('--prefix')) {
    errors.push('install.sh does not expose the installation-root override');
  }
  if (!script.includes('$HOME/.local/share/toknow-agent') || !script.includes('$HOME/.local/bin/toknow-agent')) {
    errors.push('install.sh does not use the required default user installation paths');
  }
}

function verifyPackage(packageRoot, options = {}) {
  const root = path.resolve(packageRoot);
  const errors = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new PackageVerificationError([`package root is not a directory: ${root}`]);
  }

  for (const relativePath of REQUIRED_PATHS) {
    if (!pathExists(root, relativePath)) errors.push(`missing ${relativePath}`);
  }

  let paths = [];
  try {
    paths = collectRelativePaths(root);
  } catch (error) {
    errors.push(`cannot enumerate package: ${error.message}`);
  }
  for (const relativePath of paths) {
    const reason = forbiddenReason(relativePath);
    if (reason) errors.push(`${relativePath}: ${reason}`);
  }

  if (pathExists(root, 'bin/toknow-agent')) verifyLauncher(root, errors);
  if (pathExists(root, 'install.sh')) verifyInstallScript(root, errors);

  let packageJson;
  let runtimeManifest;
  let version = '';
  try {
    packageJson = JSON.parse(readText(path.join(root, 'app', 'package.json')));
    version = readText(path.join(root, 'VERSION')).trim();
    if (!version || packageJson.version !== version) errors.push('VERSION does not match app/package.json');
    if (packageJson.main || packageJson.build || packageJson.devDependencies) {
      errors.push('app/package.json contains desktop or development packaging metadata');
    }
    runtimeManifest = JSON.parse(readText(path.join(root, 'runtime', 'manifest.json')));
    validateRuntimeManifest(runtimeManifest);
    const sourceRuntime = loadRuntimeManifest();
    if (JSON.stringify(runtimeManifest) !== JSON.stringify(sourceRuntime)) {
      errors.push('runtime/manifest.json differs from scripts/server-agent/runtime.json');
    }
  } catch (error) {
    errors.push(`invalid package metadata: ${error.message}`);
  }

  const bundledNode = path.join(root, 'runtime', 'node', 'bin', 'node');
  if (options.requireExecutable && fs.existsSync(bundledNode)) {
    const mode = fs.statSync(bundledNode).mode;
    if ((mode & 0o111) === 0) errors.push('bundled Node is not executable');
  }
  if (
    pathExists(root, 'app/node_modules/electron')
    || pathExists(root, 'app/node_modules/electron-builder')
    || pathExists(root, 'app/node_modules/electron-updater')
  ) {
    errors.push('desktop Electron runtime/build dependency is present');
  }

  if (errors.length > 0) throw new PackageVerificationError(errors);
  return { packageRoot: root, version, requiredPaths: REQUIRED_PATHS };
}

if (require.main === module) {
  const packageRoot = process.argv[2];
  if (!packageRoot) {
    process.stderr.write('usage: node scripts/server-agent/verify-package.js <package-root>\n');
    process.exitCode = 2;
  } else {
    try {
      const result = verifyPackage(packageRoot, { requireExecutable: process.platform === 'linux' });
      process.stdout.write(`server-agent package PASS: ${result.version}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  FORBIDDEN_SENSITIVE_BASENAMES,
  FORBIDDEN_TOP_LEVEL_PATHS,
  PackageVerificationError,
  REQUIRED_PATHS,
  forbiddenReason,
  verifyPackage
};
