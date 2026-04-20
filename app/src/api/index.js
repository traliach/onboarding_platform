'use strict';

const express = require('express');
const { healthRouter } = require('./health');
const { metricsRouter, metricsMiddleware, createMetrics } = require('./metrics');
const { clientsRouter } = require('./clients');
const { jobsRouter } = require('./jobs');

function buildApp({ pool, enqueueProvisioning, logger, metrics }) {
  const app = express();
  const appMetrics = metrics || createMetrics();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(metricsMiddleware(appMetrics));

  app.use(healthRouter());
  app.use(metricsRouter(appMetrics));
  app.use(clientsRouter({ pool, enqueueProvisioning, logger }));
  app.use(jobsRouter({ pool }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logger.error({ msg: 'request.error', route: req.path, method: req.method, err: err.message, stack: err.stack });
    res.status(500).json({ error: 'internal server error' });
  });

  return { app, metrics: appMetrics };
}

module.exports = { buildApp };
