/**
 * Provisioning job processor — drains a single job's step_rows sequentially.
 *
 * Invoked by the BullMQ worker with { jobId } as payload. Responsibilities:
 *
 *   1. Idempotency guard. If the job is already 'done' or 'failed', return
 *      without touching the DB. This covers retry-storms and BullMQ replays.
 *   2. Promote jobs.status / clients.status to 'in_progress' on first pick-up.
 *   3. For each step in step_order: in_progress → stub handler → done/failed.
 *      On failure the job + client are marked 'failed' and the BullMQ job
 *      is re-thrown so the queue surfaces the error; §10 forbids automatic
 *      retries, so attempts:1 in the enqueue means no replay.
 *   4. On success of every step, mark jobs and clients 'done' + audit log.
 *
 * The step handler is a 500ms sleep stub in this commit. Commit #16 replaces
 * runStep() with the 7 real provisioning steps (createIamUser, etc.) from
 * the registry. The processor shell stays identical — only the dispatch
 * table changes — so this file is the stable boundary between queue plumbing
 * and step business logic.
 *
 * Step rows already exist in the DB (created by POST /clients at onboarding
 * time, one row per tier step). The processor never invents new steps; it
 * just advances the state machine on rows the API already persisted. That
 * keeps the portal progress bar honest from t=0 and lets the registry evolve
 * without migrating historical rows.
 */

import type { Job as BullJob } from 'bullmq';

import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import type { JobPayload } from '../queue';

const STEP_STUB_DELAY_MS = 500;

interface JobRow {
  id: string;
  client_id: string;
  status: string;
}

interface StepRow {
  id: string;
  step_name: string;
  plain_label: string;
  status: string;
  step_order: number;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || 'unknown error';
  }
  return typeof err === 'string' ? err : 'unknown error';
}

/**
 * Stub step runner. Commit #16 dispatches on step_name into the real handler
 * registry; for now every step sleeps briefly and reports a canned log line,
 * which is enough to exercise the full state machine end-to-end (POST →
 * enqueue → worker → done). The delay makes mid-run GET /clients/:id polls
 * observable so the live test can catch an in_progress snapshot.
 */
async function runStep(
  step: StepRow,
  logger: Logger,
): Promise<{ log_message: string }> {
  await new Promise<void>((resolve) => setTimeout(resolve, STEP_STUB_DELAY_MS));
  logger.debug('stub step executed', { step_name: step.step_name });
  return { log_message: `${step.step_name} completed (stub)` };
}

export function createJobProcessor(db: Db, logger: Logger) {
  return async function processProvisioningJob(
    bullJob: BullJob<JobPayload>,
  ): Promise<void> {
    const { jobId } = bullJob.data;

    const jobResult = await db.query<JobRow>(
      `SELECT id, client_id, status FROM jobs WHERE id = $1`,
      [jobId],
    );
    const jobRow = jobResult.rows[0];
    if (jobRow === undefined) {
      logger.warn('job payload references missing row', { job_id: jobId });
      return;
    }
    if (jobRow.status === 'done' || jobRow.status === 'failed') {
      logger.info('job already terminal, skipping', {
        job_id: jobId,
        status: jobRow.status,
      });
      return;
    }

    if (jobRow.status === 'pending') {
      await db.withTransaction(async (tx) => {
        await tx.query(
          `UPDATE jobs SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
          [jobId],
        );
        await tx.query(
          `UPDATE clients SET status = 'in_progress' WHERE id = $1`,
          [jobRow.client_id],
        );
      });
      logger.info('job started', { job_id: jobId, client_id: jobRow.client_id });
    }

    const stepsResult = await db.query<StepRow>(
      `SELECT id, step_name, plain_label, status, step_order
         FROM job_steps
         WHERE job_id = $1 AND status IN ('pending', 'in_progress')
         ORDER BY step_order`,
      [jobId],
    );

    for (const step of stepsResult.rows) {
      await db.query(
        `UPDATE job_steps
            SET status = 'in_progress',
                started_at = COALESCE(started_at, NOW())
          WHERE id = $1`,
        [step.id],
      );
      logger.info('step starting', {
        job_id: jobId,
        step_name: step.step_name,
        step_order: step.step_order,
      });

      try {
        const result = await runStep(step, logger);
        await db.query(
          `UPDATE job_steps
              SET status = 'done',
                  completed_at = NOW(),
                  log_message = $2
            WHERE id = $1`,
          [step.id, result.log_message],
        );
        logger.info('step done', {
          job_id: jobId,
          step_name: step.step_name,
        });
      } catch (err: unknown) {
        const message = describeError(err);
        await db.withTransaction(async (tx) => {
          await tx.query(
            `UPDATE job_steps
                SET status = 'failed',
                    completed_at = NOW(),
                    error_message = $2
              WHERE id = $1`,
            [step.id, message],
          );
          await tx.query(
            `UPDATE jobs SET status = 'failed', completed_at = NOW() WHERE id = $1`,
            [jobId],
          );
          await tx.query(
            `UPDATE clients SET status = 'failed' WHERE id = $1`,
            [jobRow.client_id],
          );
          await tx.query(
            `INSERT INTO audit_log (client_id, message, actor) VALUES ($1, $2, 'worker')`,
            [jobRow.client_id, `Step failed: ${step.step_name} — ${message}`],
          );
        });
        logger.error('step failed', {
          job_id: jobId,
          step_name: step.step_name,
          error: message,
        });
        // Re-throw so BullMQ marks the queue job as failed. attempts:1 means
        // no automatic replay — retry is an explicit admin action.
        throw err;
      }
    }

    await db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE jobs SET status = 'done', completed_at = NOW() WHERE id = $1`,
        [jobId],
      );
      await tx.query(
        `UPDATE clients SET status = 'done' WHERE id = $1`,
        [jobRow.client_id],
      );
      await tx.query(
        `INSERT INTO audit_log (client_id, message, actor)
              VALUES ($1, 'Onboarding completed', 'worker')`,
        [jobRow.client_id],
      );
    });
    logger.info('job completed', {
      job_id: jobId,
      client_id: jobRow.client_id,
      step_count: stepsResult.rows.length,
    });
  };
}
