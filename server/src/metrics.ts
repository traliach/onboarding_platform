/**
 * Prometheus metrics for the API process.
 *
 * The default Node.js metrics (event loop lag, GC, memory, active handles)
 * are registered automatically. BullMQ queue counts are polled from Redis
 * every 30 s by the API process and exposed as gauges — see index.ts.
 *
 * All metrics live on a single shared Registry so /metrics returns one
 * consolidated text payload.
 *
 * Metric names match the alert rules in monitoring/prometheus/alerts.yml:
 *   bullmq_queue_depth   — used by JobQueueDepth alert (waiting jobs)
 *   bullmq_jobs_failed   — used by JobFailureRate alert
 */

import { Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();

collectDefaultMetrics({ register });

export const bullmqQueueDepth = new Gauge({
  name: 'bullmq_queue_depth',
  help: 'Number of jobs currently waiting in the BullMQ queue',
  registers: [register],
});

export const bullmqJobsActive = new Gauge({
  name: 'bullmq_jobs_active',
  help: 'Number of BullMQ jobs currently being processed',
  registers: [register],
});

export const bullmqJobsCompleted = new Gauge({
  name: 'bullmq_jobs_completed',
  help: 'Number of BullMQ jobs in the completed state (last 100 retained)',
  registers: [register],
});

export const bullmqJobsFailed = new Gauge({
  name: 'bullmq_jobs_failed',
  help: 'Number of BullMQ jobs currently in the failed state (last 100 retained)',
  registers: [register],
});
