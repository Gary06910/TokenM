'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNTIME_MANIFEST_PATH = path.join(__dirname, 'runtime.json');
const SHASUMS_ASSET = 'SHASUMS256.txt';
const MAX_NODE_ARCHIVE_BYTES = 200 * 1024 * 1024;

function loadRuntimeManifest(filePath = RUNTIME_MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateRuntimeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('server-agent runtime metadata must be an object');
  }
  const nodeVersion = String(manifest.nodeVersion || '');
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) {
    throw new Error('server-agent runtime metadata has an invalid Node version');
  }
  if (manifest.platform !== 'linux' || manifest.arch !== 'x64') {
    throw new Error('server-agent runtime metadata must target linux x64');
  }
  const expectedAsset = `node-v${nodeVersion}-linux-x64.tar.xz`;
  if (manifest.nodeAsset !== expectedAsset) {
    throw new Error(`server-agent runtime metadata must use ${expectedAsset}`);
  }
  const expectedBaseUrl = `https://nodejs.org/dist/v${nodeVersion}/`;
  if (manifest.distributionBaseUrl !== expectedBaseUrl) {
    throw new Error(`server-agent runtime metadata must use official Node distribution URL ${expectedBaseUrl}`);
  }
  return manifest;
}

function distributionUrls(manifest) {
  validateRuntimeManifest(manifest);
  const baseUrl = manifest.distributionBaseUrl;
  return {
    archive: `${baseUrl}${manifest.nodeAsset}`,
    shasums: `${baseUrl}${SHASUMS_ASSET}`
  };
}

async function downloadBuffer(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Node runtime download requires fetch');
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Node runtime download failed: ${response.status} ${url}`);
  if (response.url && new URL(response.url).hostname !== 'nodejs.org') {
    throw new Error(`Node runtime download redirected away from nodejs.org: ${response.url}`);
  }
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > MAX_NODE_ARCHIVE_BYTES) throw new Error(`Node runtime download is too large: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_NODE_ARCHIVE_BYTES) throw new Error(`Node runtime download is too large: ${url}`);
  return buffer;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseShasums256(text, asset) {
  const expectedAsset = String(asset || '');
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([a-f0-9]{64})\s+[ *]?(.+?)\s*$/i);
    if (match && match[2] === expectedAsset) return match[1].toLowerCase();
  }
  throw new Error(`SHASUMS256.txt does not contain ${expectedAsset}`);
}

function extractNodeArchive(archivePath, destination, spawn = spawnSync) {
  fs.mkdirSync(destination, { recursive: true });
  const result = spawn('tar', ['-xJf', archivePath, '-C', destination], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw new Error(`Node runtime extraction failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Node runtime extraction failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return destination;
}

async function fetchNodeRuntime({
  manifest = loadRuntimeManifest(),
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toknow-agent-node-runtime-')),
  fetchImpl = globalThis.fetch,
  spawn = spawnSync
} = {}) {
  validateRuntimeManifest(manifest);
  const urls = distributionUrls(manifest);
  fs.mkdirSync(workDir, { recursive: true });
  const archivePath = path.join(workDir, manifest.nodeAsset);
  const archive = await downloadBuffer(urls.archive, fetchImpl);
  const shasums = await downloadBuffer(urls.shasums, fetchImpl);
  const expected = parseShasums256(shasums.toString('utf8'), manifest.nodeAsset);
  const actual = sha256(archive);
  if (actual !== expected) throw new Error(`Node runtime sha256 mismatch: expected ${expected}, got ${actual}`);
  fs.writeFileSync(archivePath, archive);

  const extractedRoot = path.join(workDir, 'extracted');
  extractNodeArchive(archivePath, extractedRoot, spawn);
  const nodeRoot = path.join(extractedRoot, `node-v${manifest.nodeVersion}-linux-x64`);
  if (!fs.existsSync(path.join(nodeRoot, 'bin', 'node'))) {
    throw new Error(`Node runtime archive did not contain ${nodeRoot}/bin/node`);
  }
  return { archivePath, expectedSha256: expected, nodeRoot, urls };
}

module.exports = {
  MAX_NODE_ARCHIVE_BYTES,
  RUNTIME_MANIFEST_PATH,
  SHASUMS_ASSET,
  distributionUrls,
  downloadBuffer,
  extractNodeArchive,
  fetchNodeRuntime,
  loadRuntimeManifest,
  parseShasums256,
  sha256,
  validateRuntimeManifest
};
