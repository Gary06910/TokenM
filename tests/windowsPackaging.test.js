'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const { verifyPackagedRuntime } = require('../scripts/verify-windows-packaged-runtime');
const { verifyLocalNodeModules } = require('../scripts/windows-packaging-preflight');

async function fixture(t, mutate = () => {}) {
  const manifests = { 'package.json': { dependencies: { 'electron-updater': '1' } } };
  for (const name of ['electron-updater', 'fs-extra', 'graceful-fs', 'jsonfile',
    'universalify', 'builder-util-runtime', 'js-yaml', 'lazy-val', 'semver']) {
    manifests[`node_modules/${name}/package.json`] = {};
  }
  manifests['node_modules/electron-updater/package.json'].dependencies = { 'fs-extra': '1' };
  mutate(manifests);
  const archive = path.join(os.tmpdir(), `toknow-runtime-${randomUUID()}.asar`);
  t.after(() => { asar.uncache(archive); fs.unlinkSync(archive); });
  const output = await asar.createPackageFromStreams(archive, Object.entries(manifests).map(([name, manifest]) => {
    const content = Buffer.from(JSON.stringify(manifest));
    return { path: name, type: 'file', unpacked: false,
      stat: { size: content.length, mode: 0o644 }, streamGenerator: () => Readable.from(content) };
  }));
  await finished(output);
  return archive;
}

test('packaged runtime accepts a complete archive', async t => {
  const archive = await fixture(t);
  assert.equal(verifyPackagedRuntime(archive).packages, 9);
});

test('packaged runtime rejects missing fs-extra even when installed in source', async t => {
  assert.ok(require.resolve('fs-extra'));
  const archive = await fixture(t, manifests => { delete manifests['node_modules/fs-extra/package.json']; });
  assert.throws(() => verifyPackagedRuntime(archive), /Missing packaged runtime dependency: fs-extra/);
});

test('packaged runtime checks transitive dependencies beyond the required list', async t => {
  const archive = await fixture(t, manifests => {
    manifests['node_modules/fs-extra/package.json'].dependencies = { 'missing-transitive': '1' };
  });
  assert.throws(() => verifyPackagedRuntime(archive), /missing-transitive/);
});

test('packaged runtime resolves nested dependencies and skips optional platform packages', async t => {
  const archive = await fixture(t, manifests => {
    manifests['node_modules/fs-extra/package.json'] = {
      dependencies: { nested: '1', optional: '1' }, optionalDependencies: { optional: '1' }
    };
    manifests['node_modules/fs-extra/node_modules/nested/package.json'] = {};
  });
  assert.equal(verifyPackagedRuntime(archive).packages, 10);
});

test('Windows packaging rejects junctions before following the target', t => {
  t.mock.method(fs, 'lstatSync', () => ({ isDirectory: () => true, isSymbolicLink: () => true }));
  assert.throws(() => verifyLocalNodeModules(), /requires a real local node_modules installed with npm ci/);
});

test('Windows packaging rejects missing node_modules', t => {
  t.mock.method(fs, 'lstatSync', () => { throw new Error('ENOENT'); });
  assert.throws(() => verifyLocalNodeModules(), /requires a real local node_modules installed with npm ci/);
});
