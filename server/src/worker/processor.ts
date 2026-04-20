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

import type { StepName } from '../../../client/src/types';
import type { ClientRow } from '../db/mappers';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import type { JobPayload } from '../queue';
import { STEP_HANDLERS } from './steps';

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
 * Dispatch a step to its registered handler. Unknown step_name is a coding
 * error (schema CHECK allows any VARCHAR, but migrations + the registry's
 * Record<StepName, StepHandler> keep them in sync) — treat it as a
 * permanent failure so the step is marked failed and surfaces in the UI
 * instead of silently being skipped.
 */
async function runStep(
  step: StepRow,
  client: ClientRow,
  logger: Logger,
): Promise<{ log_message: string }> {
  const handler = STEP_HANDLERS[step.step_name as StepName];
  if (handler === undefined) {
    throw new Error(`no handler registered for step ${step.step_name}`);
  }
  return handler({ client, logger });
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

    // Load the full client row once — step handlers need real fields
    // (name, email, company, tier) to parameterise their log messages.
    // Reading outside the transaction is fine: clients.id is immutable
    // and mutable fields aren't semantically required for provisioning.
    const clientResult = await db.query<ClientRow>(
      `SELECT id, name, company, email, phone, tier, status,
              portal_token, created_at, updated_at
         FROM clients WHERE id = $1`,
      [jobRow.client_id],
    );
    const clientRow = clientResult.rows[0];
    if (clientRow === undefined) {
      logger.error('job references missing client row', {
        job_id: jobId,
        client_id: jobRow.client_id,
      });
      throw new Error(`client ${jobRow.client_id} not found for job ${jobId}`);
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
        const result = await runStep(step, clientRow, logger);
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
