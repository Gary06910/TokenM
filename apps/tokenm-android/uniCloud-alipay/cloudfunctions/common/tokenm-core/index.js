'use strict';

const {
  CURRENT_PRIVACY_VERSION,
  DELIVERY_STATUS,
  DELIVERY_STATUSES,
  NOTIFICATION_STATUS,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_MS,
  PRIVACY_CONSENT_VERSION,
  TokenMApplication
} = require('./application');
const credential = require('./credential');
const errors = require('./errors');
const ids = require('./ids');
const { MemoryRepository } = require('./repository-memory');
const pushNotification = require('./push-notification');
const uniCloudRepository = require('./repository-unicloud');
const repositoryContract = require('./repository-contract');
const validation = require('./validation');

module.exports = {
  MemoryRepository,
  CURRENT_PRIVACY_VERSION,
  DELIVERY_STATUS,
  DELIVERY_STATUSES,
  NOTIFICATION_STATUS,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_MS,
  PRIVACY_CONSENT_VERSION,
  TokenMApplication,
  ...credential,
  ...errors,
  ...ids,
  ...pushNotification,
  ...repositoryContract,
  ...uniCloudRepository,
  ...validation
};
