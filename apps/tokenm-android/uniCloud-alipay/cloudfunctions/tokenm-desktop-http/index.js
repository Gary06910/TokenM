'use strict';

const { createHttpHandler } = require('./http-contract');

let application;

function getRuntimeApplication() {
  if (!application) {
    const {
      TokenMApplication,
      createTaskCompletedPushSender,
      createUniCloudRepository,
      readCredentialKey
    } = require('tokenm-core');
    application = new TokenMApplication({
      repository: createUniCloudRepository(globalThis.uniCloud),
      credentialKey: readCredentialKey(process.env),
      sendTaskCompletedNotification: createTaskCompletedPushSender({
        runtime: globalThis.uniCloud
      })
    });
  }
  return application;
}

const handle = createHttpHandler({ getApplication: getRuntimeApplication });

exports.main = async function main(event, context) {
  return handle(event, context);
};

exports.createHttpHandler = createHttpHandler;
