'use strict';

const ALLOWED = new Set(['requestId', 'route', 'code', 'subjectId', 'providerErrcode', 'durationMs', 'transition']);

function createLogger(output = console) {
  function emit(level, fields) {
    const safe = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (ALLOWED.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
    }
    const writer = typeof output[level] === 'function' ? output[level].bind(output) : output.log.bind(output);
    writer(JSON.stringify(safe));
  }
  return {
    info: (fields) => emit('info', fields),
    warn: (fields) => emit('warn', fields),
    error: (fields) => emit('error', fields)
  };
}

module.exports = { createLogger };
