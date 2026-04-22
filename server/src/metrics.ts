/**
 * Prometheus metrics for the API and worker processes.
 *
 * The default Node.js metrics (event loop lag, GC, memory, active handles)
 * are registered automatically. BullMQ counters are incremented by the
 * worker event handlers in queue/index.ts.
 *
 * All metrics live on a single shared Registry so /metrics returns one
 * consolidated text payload regardless of which counters are active.
 *
 * Metric names match the alert rules in monitoring/prometheus/alerts.yml:
 *   bullmq_jobs_completed_total  — used by JobFailureRate alert (denominator)
 *   bullmq_jobs_failed_total     — used by JobFailureRate alert (numerator)
 *   bullmq_queue_depth           — used by JobQueueDepth alert
 */

import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();

collectDefaultMetrics({ register });

export const bullmqJobsCompleted = new Counter({
  name: 'bullmq_jobs_completed_total',
  help: 'Total number of BullMQ jobs that completed successfully',
  registers: [register],
});

export const bullmqJobsFailed = new Counter({
  name: 'bullmq_jobs_failed_total',
  help: 'Total number of BullMQ jobs that failed',
  registers: [register],
});

export const bullmqQueueDepth = new Gauge({
  name: 'bullmq_queue_depth',
  help: 'Number of jobs currently waiting in the BullMQ queue',
  registers: [register],
});
