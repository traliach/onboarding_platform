'use strict';

function fakeLogger() {
  const calls = { info: [], warn: [], error: [], debug: [] };
  return {
    info: (msg) => calls.info.push(msg),
    warn: (msg) => calls.warn.push(msg),
    error: (msg) => calls.error.push(msg),
    debug: (msg) => calls.debug.push(msg),
    calls,
  };
}

module.exports = { fakeLogger };
