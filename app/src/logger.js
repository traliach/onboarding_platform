'use strict';

const winston = require('winston');

function createLogger(level) {
  return winston.createLogger({
    level: level || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    defaultMeta: { service: 'onboarding_platform' },
    transports: [new winston.transports.Console()],
  });
}

module.exports = { createLogger };
