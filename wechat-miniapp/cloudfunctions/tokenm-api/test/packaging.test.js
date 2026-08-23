'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  EXPECTED_VERSION,
  PATCH_MARKER,
  applyPatch,
  verifyPatchedSource
} = require('../patches/wx-server-sdk+4.0.2-tokenm-diagnostic-v2');
const { LOCAL_DEPENDENCY, verifyArtifact } = require('../tools/verify-diagnostic-v2-artifact');

const root = path.resolve(__dirname, '..');
const vendorPath = path.join(root, 'vendor', 'wx-server-sdk-4.0.2-tokenm-diagnostic-v2.tgz');
const sdkRoot = path.join(root, 'node_modules', 'wx-server-sdk');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const sdkManifest = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
const sdkSource = fs.readFileSync(path.join(sdkRoot, 'index.js'), 'utf8');
const provenance = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'TOKENM_DIAGNOSTIC_V2_PROVENANCE.json'), 'utf8'));

test('PKG-01 manifest resolves wx-server-sdk from the checked-in local package', () => {
  assert.equal(manifest.dependencies['wx-server-sdk'], LOCAL_DEPENDENCY);
});

test('PKG-02 lockfile resolves wx-server-sdk from the same local package', () => {
  assert.equal(lock.packages[''].dependencies['wx-server-sdk'], LOCAL_DEPENDENCY);
  assert.equal(lock.packages['node_modules/wx-server-sdk'].resolved, LOCAL_DEPENDENCY);
});

test('PKG-03 lockfile integrity matches the checked-in vendored tarball', () => {
  const actual = `sha512-${crypto.createHash('sha512').update(fs.readFileSync(vendorPath)).digest('base64')}`;
  assert.equal(lock.packages['node_modules/wx-server-sdk'].integrity, actual);
});

test('PKG-04 packaging requires no preinstall, install, or postinstall lifecycle script', () => {
  assert.equal(manifest.scripts?.preinstall, undefined);
  assert.equal(manifest.scripts?.install, undefined);
  assert.equal(manifest.scripts?.postinstall, undefined);
});

test('PKG-05 installed package retains official wx-server-sdk identity and version', () => {
  assert.equal(sdkManifest.name, 'wx-server-sdk');
  assert.equal(sdkManifest.version, EXPECTED_VERSION);
  assert.equal(sdkManifest.license, 'MIT');
});

test('PKG-06 installed package contains explicit Token M provenance', () => {
  assert.equal(provenance.packageName, 'wx-server-sdk');
  assert.equal(provenance.upstreamVersion, EXPECTED_VERSION);
  assert.equal(provenance.patchMarker, PATCH_MARKER);
});

test('PKG-07 provenance hash matches the installed patched index', () => {
  const actual = crypto.createHash('sha256').update(sdkSource).digest('hex');
  assert.equal(provenance.patchedIndexSha256, actual);
});

test('PKG-08 installed SDK contains the V2 marker', () => {
  assert.equal(sdkSource.includes(PATCH_MARKER), true);
});

test('PKG-09 installed SDK contains the pre-normalization interception', () => {
  assert.equal(sdkSource.includes('upstreamEvidence: tokenmBuildUpstreamEvidence(err, tokenmStartedAt)'), true);
});

test('PKG-10 installed SDK passes the exact marker verifier', () => {
  assert.equal(verifyPatchedSource(sdkSource), true);
});

test('PKG-11 wrong upstream version fails closed', () => {
  assert.throws(() => applyPatch(sdkSource, '4.0.3'), /requires 4\.0\.2/u);
});

test('PKG-12 source anchor mismatch fails closed', () => {
  assert.throws(() => applyPatch('unrecognized upstream source', EXPECTED_VERSION), /anchor missing/u);
});

test('PKG-13 already-patched source cannot be silently generated as a fresh upstream package', () => {
  assert.equal(applyPatch(sdkSource, EXPECTED_VERSION).changed, false);
  const generator = fs.readFileSync(path.join(root, 'tools', 'build-vendored-wx-server-sdk.js'), 'utf8');
  assert.match(generator, /if \(!patched\.changed\) throw new Error\('official upstream source was already patched'\)/u);
});

test('PKG-14 upstream LICENSE and package metadata are retained in the installed package', () => {
  assert.equal(fs.existsSync(path.join(sdkRoot, 'LICENSE')), true);
  assert.equal(fs.existsSync(path.join(sdkRoot, 'README.md')), true);
  assert.equal(sdkManifest.dependencies['@cloudbase/node-sdk'], '3.17.2');
});

test('PKG-15 final function directory passes the production artifact verifier', () => {
  const result = verifyArtifact(root);
  assert.equal(result.version, EXPECTED_VERSION);
});
