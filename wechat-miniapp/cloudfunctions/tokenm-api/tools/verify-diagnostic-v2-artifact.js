'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  EXPECTED_VERSION,
  PATCH_MARKER,
  verifyPatchedSource
} = require('../patches/wx-server-sdk+4.0.2-tokenm-diagnostic-v2');

const LOCAL_DEPENDENCY = 'file:vendor/wx-server-sdk-4.0.2-tokenm-diagnostic-v2.tgz';

function verifyArtifact(root) {
  const artifactRoot = path.resolve(root);
  const sdkRoot = path.join(artifactRoot, 'node_modules', 'wx-server-sdk');
  const sdkPackage = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
  if (sdkPackage.version !== EXPECTED_VERSION) {
    throw new Error(`artifact has wx-server-sdk ${sdkPackage.version}; expected ${EXPECTED_VERSION}`);
  }
  verifyPatchedSource(fs.readFileSync(path.join(sdkRoot, 'index.js'), 'utf8'));
  const provenancePath = path.join(sdkRoot, 'TOKENM_DIAGNOSTIC_V2_PROVENANCE.json');
  if (!fs.existsSync(provenancePath)) throw new Error('artifact wx-server-sdk lacks Token M provenance');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const installedIndex = fs.readFileSync(path.join(sdkRoot, 'index.js'));
  const installedHash = crypto.createHash('sha256').update(installedIndex).digest('hex');
  if (provenance.packageName !== 'wx-server-sdk' || provenance.upstreamVersion !== EXPECTED_VERSION ||
      provenance.patchMarker !== PATCH_MARKER || provenance.patchedIndexSha256 !== installedHash) {
    throw new Error('artifact wx-server-sdk provenance verification failed');
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'package.json'), 'utf8'));
  if (manifest.dependencies?.['wx-server-sdk'] !== LOCAL_DEPENDENCY) {
    throw new Error('artifact manifest does not use the vendored wx-server-sdk dependency');
  }
  if (manifest.scripts?.postinstall !== undefined) {
    throw new Error('artifact must not depend on a postinstall mutation');
  }
  const lock = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'package-lock.json'), 'utf8'));
  if (lock.packages?.['']?.dependencies?.['wx-server-sdk'] !== LOCAL_DEPENDENCY ||
      lock.packages?.['node_modules/wx-server-sdk']?.resolved !== LOCAL_DEPENDENCY) {
    throw new Error('artifact lockfile does not resolve wx-server-sdk from the vendored package');
  }
  if (!fs.existsSync(path.join(artifactRoot, 'vendor', 'wx-server-sdk-4.0.2-tokenm-diagnostic-v2.tgz'))) {
    throw new Error('artifact is missing the vendored wx-server-sdk package');
  }
  return { version: sdkPackage.version, provenance, installedHash };
}

if (require.main === module) {
  const artifactRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const result = verifyArtifact(artifactRoot);
  process.stdout.write(`diagnostic V2 artifact verified: vendored wx-server-sdk ${result.version}\n`);
}

module.exports = { LOCAL_DEPENDENCY, verifyArtifact };
