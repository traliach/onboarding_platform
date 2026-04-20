'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { getPool, closePool } = require('./db/client');
const { buildApp } = require('./api');
const { createQueue, closeQueue } = require('./queue');

async function startServer() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const pool = getPool(config.databaseUrl);

  const queue = createQueue({ redisUrl: config.redisUrl, queueName: config.queueName });

  const enqueueProvisioning = (payload) => queue.add('provision-client', payload);

  const { app } = buildApp({ pool, enqueueProvisioning, logger });

  const server = app.listen(config.port, () => {
    logger.info({ msg: 'api.started', port: config.port, nodeEnv: config.nodeEnv });
  });

  const shutdown = async (signal) => {
    logger.info({ msg: 'api.shutdown', signal });
    server.close(async () => {
      try {
        await closeQueue();
        await closePool();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

module.exports = { startServer };
