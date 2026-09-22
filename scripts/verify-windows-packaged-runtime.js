'use strict';

const path = require('node:path');
const asar = require('@electron/asar');

const REQUIRED = ['electron-updater', 'fs-extra', 'graceful-fs', 'jsonfile',
  'universalify', 'builder-util-runtime', 'js-yaml', 'lazy-val', 'semver'];

function verifyPackagedRuntime(archive = path.resolve(__dirname, '../dist/win-unpacked/resources/app.asar')) {
  const files = new Set(asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')));
  const readManifest = name => JSON.parse(asar.extractFile(archive, path.normalize(name)).toString());
  const visited = new Set();
  function resolveManifest(from, name) {
    let directory = from;
    while (true) {
      const candidate = path.posix.join(directory, 'node_modules', name, 'package.json');
      if (files.has(candidate)) return candidate;
      if (!directory) throw new Error(`Missing packaged runtime dependency: ${name} (required by ${from || 'app'})`);
      const parent = path.posix.dirname(directory);
      directory = parent === '.' ? '' : parent;
    }
  }
  function visit(manifestPath) {
    if (visited.has(manifestPath)) return;
    visited.add(manifestPath);
    const manifest = readManifest(manifestPath);
    const directory = path.posix.dirname(manifestPath);
    for (const name of Object.keys(manifest.dependencies || {})) {
      // Optional platform packages may legitimately be absent on Windows.
      if (Object.hasOwn(manifest.optionalDependencies || {}, name)) continue;
      visit(resolveManifest(directory === '.' ? '' : directory, name));
    }
  }
  for (const name of REQUIRED) visit(resolveManifest('', name));
  visit('package.json');
  return { archive, packages: visited.size - 1, required: REQUIRED };
}

if (require.main === module) {
  try {
    const result = verifyPackagedRuntime(process.argv[2] && path.resolve(process.argv[2]));
    console.log(`Packaged runtime verifier PASS: ${result.packages} production packages in ${result.archive}`);
    for (const name of result.required) console.log(`${name}: PRESENT`);
  } catch (error) {
    console.error(`Packaged runtime verifier FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyPackagedRuntime };
