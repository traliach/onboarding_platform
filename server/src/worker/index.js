'use strict';

const { Worker } = require('bullmq');
const { loadConfig } = require('../config');
const { createLogger } = require('../logger');
const { getPool, closePool } = require('../db/client');
const { getConnection } = require('../queue');

const stepModules = [
  require('./steps/createIamUser'),
  require('./steps/scaffoldS3Folder'),
  require('./steps/sendWelcomeEmail'),
  require('./steps/postSlackNotification'),
];

async function loadClient(pool, clientId) {
  const { rows } = await pool.query(
    `SELECT id, name, email, company, status FROM clients WHERE id = $1`,
    [clientId],
  );
  if (rows.length === 0) {
    throw new Error(`client not found: ${clientId}`);
  }
  return rows[0];
}

async function markJobStatus(pool, jobId, status, error) {
  await pool.query(
    `UPDATE jobs
     SET status = $1,
         error = $2,
         started_at = COALESCE(started_at, CASE WHEN $1 = 'in_progress' THEN NOW() ELSE NULL END),
         completed_at = CASE WHEN $1 IN ('done', 'failed') THEN NOW() ELSE completed_at END,
         updated_at = NOW()
     WHERE id = $3`,
    [status, error || null, jobId],
  );
}

async function ensureStepRow(pool, jobId, stepName, stepOrder) {
  await pool.query(
    `INSERT INTO job_steps (job_id, step_name, step_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (job_id, step_name) DO NOTHING`,
    [jobId, stepName, stepOrder],
  );
}

async function markStepStatus(pool, jobId, stepName, status, extras = {}) {
  await pool.query(
    `UPDATE job_steps
     SET status = $1,
         result = COALESCE($2::jsonb, result),
         error = $3,
         started_at = COALESCE(started_at, CASE WHEN $1 = 'in_progress' THEN NOW() ELSE NULL END),
         completed_at = CASE WHEN $1 IN ('done', 'failed') THEN NOW() ELSE completed_at END,
         updated_at = NOW()
     WHERE job_id = $4 AND step_name = $5`,
    [status, extras.result ? JSON.stringify(extras.result) : null, extras.error || null, jobId, stepName],
  );
}

async function processJob(pool, logger, payload) {
  const { jobId, clientId } = payload || {};
  if (!jobId || !clientId) {
    throw new Error('job payload must include jobId and clientId');
  }

  await markJobStatus(pool, jobId, 'in_progress');
  await pool.query(
    `UPDATE clients SET status = 'provisioning', updated_at = NOW() WHERE id = $1`,
    [clientId],
  );

  const client = await loadClient(pool, clientId);

  try {
    for (const step of stepModules) {
      await ensureStepRow(pool, jobId, step.STEP_NAME, step.STEP_ORDER);
      await markStepStatus(pool, jobId, step.STEP_NAME, 'in_progress');
      try {
        const stepFn = step[step.STEP_NAME];
        if (typeof stepFn !== 'function') {
          throw new Error(`step module missing function export: ${step.STEP_NAME}`);
        }
        const result = await stepFn({ client, logger });
        await markStepStatus(pool, jobId, step.STEP_NAME, 'done', { result });
      } catch (stepErr) {
        await markStepStatus(pool, jobId, step.STEP_NAME, 'failed', { error: stepErr.message });
        throw stepErr;
      }
    }
    await markJobStatus(pool, jobId, 'done');
    await pool.query(
      `UPDATE clients SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [clientId],
    );
    logger.info({ msg: 'job.done', jobId, clientId });
  } catch (err) {
    await markJobStatus(pool, jobId, 'failed', err.message);
    await pool.query(
      `UPDATE clients SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [clientId],
    );
    logger.error({ msg: 'job.failed', jobId, clientId, err: err.message });
    throw err;
  }
}

async function startWorker() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const pool = getPool(config.databaseUrl);
  const connection = getConnection(config.redisUrl);

  const worker = new Worker(
    config.queueName,
    async (job) => processJob(pool, logger, job.data),
    { connection },
  );

  worker.on('completed', (job) => {
    logger.info({ msg: 'worker.job.completed', id: job.id });
  });
  worker.on('failed', (job, err) => {
    logger.error({ msg: 'worker.job.failed', id: job && job.id, err: err.message });
  });

  const shutdown = async (signal) => {
    logger.info({ msg: 'worker.shutdown', signal });
    await worker.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info({ msg: 'worker.started', queue: config.queueName });
  return worker;
}

module.exports = { startWorker, processJob };
