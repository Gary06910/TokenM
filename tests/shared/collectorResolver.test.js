'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { decideResolver } = require('../../src/shared/collector');

test('decideResolver prefers downloaded binary only when it is newer than bundled', () => {
  const bundled = { source: 'bundled', version: '2.1.3', path: '/bundled/tokscale' };
  const downloaded = { source: 'downloaded', version: '2.3.0', path: '/downloaded/tokscale' };

  assert.equal(decideResolver({ downloaded, bundled }), downloaded);
});

test('decideResolver keeps bundled as floor when bundled is same or newer', () => {
  const bundled = { source: 'bundled', version: '2.5.0', path: '/bundled/tokscale' };
  const downloaded = { source: 'downloaded', version: '2.3.0', path: '/downloaded/tokscale' };

  assert.equal(decideResolver({ downloaded, bundled }), bundled);
  assert.equal(decideResolver({ downloaded: { ...downloaded, version: '2.5.0' }, bundled }), bundled);
});

test('decideResolver falls back to JS shim when no bundled binary exists', () => {
  const shim = { source: 'shim', version: '2.1.3', path: '/shim/bin.js' };

  assert.equal(decideResolver({ downloaded: null, bundled: null, shim }), shim);
});
