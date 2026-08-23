'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  EXPECTED_VERSION,
  PATCH_MARKER,
  applyPatch,
  verifyPatchedSource
} = require('../patches/wx-server-sdk+4.0.2-tokenm-diagnostic-v2');

const UPSTREAM_SPEC = `wx-server-sdk@${EXPECTED_VERSION}`;
const UPSTREAM_INTEGRITY = 'sha512-dgpgWxYvOFWnQdGOb78sU+uQGELoEQSKzmJ7m8Y6eTCJKsfkdIHLMhRrdN5S5oDfAqr8Pc83jZKQeNRMZASIcg==';
const OUTPUT_FILENAME = `wx-server-sdk-${EXPECTED_VERSION}-tokenm-diagnostic-v2.tgz`;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${(result.error?.message || result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout;
}

function mkdirEmpty(directory) {
  if (fs.existsSync(directory)) throw new Error(`refusing to reuse build path: ${directory}`);
  fs.mkdirSync(directory);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parsePackResult(stdout) {
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0].filename !== 'string') {
    throw new Error('unexpected npm pack result');
  }
  return result[0];
}

function main() {
  const functionRoot = path.resolve(__dirname, '..');
  const buildRoot = process.argv[2] && path.resolve(process.argv[2]);
  if (!buildRoot) throw new Error('usage: node tools/build-vendored-wx-server-sdk.js <new-empty-build-directory>');
  const vendorDirectory = path.join(functionRoot, 'vendor');
  const outputPath = path.join(vendorDirectory, OUTPUT_FILENAME);
  if (fs.existsSync(outputPath)) throw new Error(`vendored dependency already exists: ${outputPath}`);
  if (!fs.existsSync(vendorDirectory)) fs.mkdirSync(vendorDirectory);

  mkdirEmpty(buildRoot);
  const upstreamDirectory = path.join(buildRoot, 'upstream');
  const extractDirectory = path.join(buildRoot, 'extract');
  const packedDirectory = path.join(buildRoot, 'packed');
  fs.mkdirSync(upstreamDirectory);
  fs.mkdirSync(extractDirectory);
  fs.mkdirSync(packedDirectory);

  const npmCli = process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null;
  if (npmCli && !fs.existsSync(npmCli)) throw new Error(`npm CLI not found: ${npmCli}`);
  const npmCommand = npmCli ? process.execPath : 'npm';
  const npmArgs = (args) => npmCli ? [npmCli, ...args] : args;
  const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const upstream = parsePackResult(run(npmCommand, npmArgs([
    'pack', UPSTREAM_SPEC, '--json', '--ignore-scripts', '--pack-destination', upstreamDirectory
  ]), functionRoot));
  if (upstream.integrity !== UPSTREAM_INTEGRITY) {
    throw new Error(`upstream integrity mismatch: ${upstream.integrity || 'missing'}`);
  }

  const upstreamArchive = path.join(upstreamDirectory, upstream.filename);
  run(tarCommand, ['-xf', upstreamArchive, '-C', extractDirectory], functionRoot);
  const packageDirectory = path.join(extractDirectory, 'package');
  const manifestPath = path.join(packageDirectory, 'package.json');
  const indexPath = path.join(packageDirectory, 'index.js');
  const licensePath = path.join(packageDirectory, 'LICENSE');
  const manifestBefore = fs.readFileSync(manifestPath);
  const licenseBefore = fs.readFileSync(licensePath);
  const manifest = JSON.parse(manifestBefore.toString('utf8'));
  if (manifest.name !== 'wx-server-sdk' || manifest.version !== EXPECTED_VERSION) {
    throw new Error(`unexpected upstream package identity: ${manifest.name}@${manifest.version}`);
  }

  const upstreamSource = fs.readFileSync(indexPath, 'utf8');
  const patched = applyPatch(upstreamSource, manifest.version);
  if (!patched.changed) throw new Error('official upstream source was already patched');
  verifyPatchedSource(patched.source);
  fs.writeFileSync(indexPath, patched.source, 'utf8');
  const provenance = {
    packageName: manifest.name,
    upstreamVersion: manifest.version,
    upstreamIntegrity: UPSTREAM_INTEGRITY,
    upstreamIndexSha256: sha256(upstreamSource),
    patchedIndexSha256: sha256(patched.source),
    patchMarker: PATCH_MARKER,
    generationTool: 'tools/build-vendored-wx-server-sdk.js'
  };
  fs.writeFileSync(
    path.join(packageDirectory, 'TOKENM_DIAGNOSTIC_V2_PROVENANCE.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
    'utf8'
  );
  if (!fs.readFileSync(manifestPath).equals(manifestBefore)) throw new Error('upstream package metadata changed');
  if (!fs.readFileSync(licensePath).equals(licenseBefore)) throw new Error('upstream license changed');

  const packed = parsePackResult(run(npmCommand, npmArgs([
    'pack', packageDirectory, '--json', '--ignore-scripts', '--pack-destination', packedDirectory
  ]), functionRoot));
  const generatedPath = path.join(packedDirectory, packed.filename);
  fs.renameSync(generatedPath, outputPath);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    upstreamVersion: EXPECTED_VERSION,
    upstreamIntegrity: UPSTREAM_INTEGRITY,
    patchedIndexSha256: provenance.patchedIndexSha256,
    licenseRetained: true,
    lifecycleScriptsRequired: false
  })}\n`);
}

main();
