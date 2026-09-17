'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const maintenanceRoot = path.resolve(__dirname, '..');
const canonicalRoot = path.resolve(maintenanceRoot, '..', 'tokenm-api');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort();
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function build(outputPath) {
  const output = path.resolve(outputPath);
  if (fs.existsSync(output)) throw new Error('output directory already exists');
  fs.mkdirSync(output, { recursive: false });

  for (const relative of ['index.js', 'config.json', 'deployment-spec.json']) {
    copyFile(path.join(maintenanceRoot, relative), path.join(output, relative));
  }
  for (const source of listFiles(path.join(maintenanceRoot, 'lib'))) {
    copyFile(source, path.join(output, 'lib', path.relative(path.join(maintenanceRoot, 'lib'), source)));
  }
  for (const source of listFiles(path.join(canonicalRoot, 'lib'))) {
    copyFile(source, path.join(output, 'runtime', 'lib', path.relative(path.join(canonicalRoot, 'lib'), source)));
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(canonicalRoot, 'package.json'), 'utf8'));
  packageJson.name = 'tokenm-maintenance';
  packageJson.description = 'One-time Token M unknown-delivery maintenance function';
  packageJson.main = 'index.js';
  packageJson.engines = { node: '>=20' };
  packageJson.scripts = {};
  fs.writeFileSync(path.join(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);

  const packageLock = JSON.parse(fs.readFileSync(path.join(canonicalRoot, 'package-lock.json'), 'utf8'));
  packageLock.name = 'tokenm-maintenance';
  if (packageLock.packages?.['']) packageLock.packages[''].name = 'tokenm-maintenance';
  fs.writeFileSync(path.join(output, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`);

  const manifest = {};
  for (const source of listFiles(path.join(canonicalRoot, 'lib'))) {
    manifest[`tokenm-api/lib/${path.relative(path.join(canonicalRoot, 'lib'), source).split(path.sep).join('/')}`] = hashFile(source);
  }
  for (const relative of ['index.js', 'config.json', 'deployment-spec.json', 'lib/operator.js']) {
    manifest[`tokenm-maintenance/${relative}`] = hashFile(path.join(maintenanceRoot, relative));
  }
  fs.writeFileSync(path.join(output, 'SOURCE_MANIFEST.json'), `${JSON.stringify({
    canonicalSource: 'wechat-miniapp/cloudfunctions/tokenm-api/lib',
    files: manifest
  }, null, 2)}\n`);
  return output;
}

function parseOutput(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || typeof argv[1] !== 'string' || !argv[1]) {
    throw new Error('usage: npm run build -- --output <new-directory>');
  }
  return argv[1];
}

if (require.main === module) {
  try {
    process.stdout.write(`${build(parseOutput(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { build };
