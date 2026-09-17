'use strict';

const STATUS_BY_CODE = Object.freeze({
  body_too_large: 413,
  configuration_required: 503,
  desktop_revoked: 401,
  event_conflict: 409,
  internal_error: 500,
  invalid_request: 422,
  pairing_invalid: 404,
  privacy_consent_required: 403,
  privacy_payload_rejected: 422,
  rate_limited: 429,
  task_not_found: 404,
  unauthenticated: 401,
  unauthorized: 403
});

const PUBLIC_MESSAGES = Object.freeze({
  body_too_large: 'Request body is too large.',
  configuration_required: 'Server configuration is incomplete.',
  desktop_revoked: 'Desktop credential is not active.',
  event_conflict: 'The event identifier is already used by different event data.',
  internal_error: 'The request could not be completed.',
  invalid_request: 'The request is invalid.',
  pairing_invalid: 'The pairing code is invalid.',
  privacy_consent_required: 'Privacy consent is required.',
  privacy_payload_rejected: 'The privacy payload is invalid.',
  rate_limited: 'Too many requests.',
  task_not_found: 'Task was not found.',
  unauthenticated: 'Authentication is required.',
  unauthorized: 'The operation is not allowed.'
});

class AppError extends Error {
  constructor(code, details = undefined) {
    const safeCode = Object.hasOwn(STATUS_BY_CODE, code) ? code : 'internal_error';
    super(PUBLIC_MESSAGES[safeCode]);
    this.name = 'AppError';
    this.code = safeCode;
    this.status = STATUS_BY_CODE[safeCode];
    this.details = details;
  }
}

class RepositoryConflictError extends Error {
  constructor(constraint) {
    super('Repository uniqueness conflict.');
    this.name = 'RepositoryConflictError';
    this.constraint = constraint;
  }
}

function invalidRequest(field) {
  return new AppError('invalid_request', field ? { field } : undefined);
}

function asAppError(error) {
  return error instanceof AppError ? error : new AppError('internal_error');
}

module.exports = {
  AppError,
  PUBLIC_MESSAGES,
  RepositoryConflictError,
  STATUS_BY_CODE,
  asAppError,
  invalidRequest
};
