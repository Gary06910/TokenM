'use strict';

function createRuntimeApplication() {
  const {
    TokenMApplication,
    createUniCloudRepository,
    readCredentialKey
  } = require('tokenm-core');
  return new TokenMApplication({
    repository: createUniCloudRepository(globalThis.uniCloud),
    credentialKey: readCredentialKey(process.env)
  });
}

module.exports = {
  createRuntimeApplication
};
