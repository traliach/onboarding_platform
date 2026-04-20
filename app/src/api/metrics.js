'use strict';

const express = require('express');
const client = require('prom-client');

function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled by the API',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });

  const httpRequestDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const jobsCompletedTotal = new client.Counter({
    name: 'onboarding_jobs_completed_total',
    help: 'Total provisioning jobs that finished successfully',
    registers: [registry],
  });

  const jobsFailedTotal = new client.Counter({
    name: 'onboarding_jobs_failed_total',
    help: 'Total provisioning jobs that failed',
    registers: [registry],
  });

  const queueDepth = new client.Gauge({
    name: 'onboarding_queue_depth',
    help: 'Pending jobs in the BullMQ queue',
    registers: [registry],
  });

  return {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    jobsCompletedTotal,
    jobsFailedTotal,
    queueDepth,
  };
}

function metricsMiddleware(metrics) {
  return function metricsHandler(req, res, next) {
    const end = metrics.httpRequestDurationSeconds.startTimer();
    res.on('finish', () => {
      const route = req.route ? req.route.path : req.path;
      const labels = { method: req.method, route, status: String(res.statusCode) };
      metrics.httpRequestsTotal.inc(labels);
      end(labels);
    });
    next();
  };
}

function metricsRouter(metrics) {
  const router = express.Router();
  router.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });
  return router;
}

module.exports = { createMetrics, metricsMiddleware, metricsRouter };
