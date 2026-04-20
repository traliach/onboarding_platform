'use strict';

/**
 * Validates required environment variables on startup.
 * Refuses to start when any required variable is missing or invalid.
 * Contract required by CLAUDE.md section 5.
 */

const REQUIRED = Object.freeze([
  'NODE_ENV',
  'APP_TARGET',
  'PORT',
  'LOG_LEVEL',
  'DATABASE_URL',
  'REDIS_URL',
  'QUEUE_NAME',
]);

const ALLOWED_APP_TARGETS = Object.freeze(['api', 'worker']);
const ALLOWED_LOG_LEVELS = Object.freeze(['error', 'warn', 'info', 'debug']);
const ALLOWED_NODE_ENVS = Object.freeze(['development', 'test', 'production']);

function missingVars(env) {
  return REQUIRED.filter((key) => {
    const value = env[key];
    return value === undefined || value === null || value === '';
  });
}

function parsePort(raw) {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received: ${raw}`);
  }
  return port;
}

function assertOneOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of [${allowed.join(', ')}], received: ${value}`);
  }
}

function loadConfig(env = process.env) {
  const missing = missingVars(env);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  assertOneOf('NODE_ENV', env.NODE_ENV, ALLOWED_NODE_ENVS);
  assertOneOf('APP_TARGET', env.APP_TARGET, ALLOWED_APP_TARGETS);
  assertOneOf('LOG_LEVEL', env.LOG_LEVEL, ALLOWED_LOG_LEVELS);

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    appTarget: env.APP_TARGET,
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    queueName: env.QUEUE_NAME,
  });
}

module.exports = {
  loadConfig,
  REQUIRED,
  ALLOWED_APP_TARGETS,
  ALLOWED_LOG_LEVELS,
  ALLOWED_NODE_ENVS,
};
