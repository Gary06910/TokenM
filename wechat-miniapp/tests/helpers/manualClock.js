'use strict';

function createManualClock(start = '2026-08-18T08:00:00.000Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms;
      return new Date(current);
    },
  };
}

module.exports = { createManualClock };
