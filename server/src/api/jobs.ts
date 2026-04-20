/**
 * Job routes (§10 — JWT protected).
 *
 *   GET   /jobs/:id                        → JobDetail (job + its steps)
 *   PATCH /jobs/:id/steps/:stepId/retry    → StepRetryResponse
 *
 * Retry is the admin escape hatch for failed steps. §7 forbids automatic
 * retries (BullMQ is enqueued with attempts:1); a human must explicitly
 * push the button. The endpoint:
 *
 *   1. Validates the step is in 'failed'. Retrying a done/in_progress/
 *      pending step makes no sense and returns 409.
 *   2. Resets the step to 'pending' (clears error_message + timestamps so
 *      the UI re-renders cleanly on next poll).
 *   3. Unwinds the parent job + client out of their 'failed' terminal
 *      state back to 'in_progress' so the processor's idempotency guard
 *      (which early-returns on 'failed') doesn't skip the re-enqueued job.
 *   4. Writes an audit entry so the retry is visible in the audit log
 *      tab alongside the original failure.
 *   5. Re-enqueues the job. BullMQ hands it back to the worker, which
 *      picks up the step now in 'pending' plus any never-started steps
 *      after it and resumes the sequence.
 *
 * The DB mutations are transactional; the enqueue happens after commit
 * for the same reason as POST /clients (see clients.ts): a worker cannot
 * race ahead of the state it needs to see.
 */

import { Router, type Request, type Response } from 'express';

import type {
  JobDetail,
  StepRetryResponse,
} from '../../../client/src/types';
import type { AppConfig } from '../config';
import type { Db } from '../db/pool';
import {
  UUID_REGEX,
  type JobRow,
  type JobStepRow,
  toJob,
  toJobStep,
} from '../db/mappers';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import type { JobQueue } from '../queue';

export function createJobsRouter(
  config: AppConfig,
  db: Db,
  logger: Logger,
  queue: JobQueue,
): Router {
  const router = Router();
  router.use(requireAuth(config, db, logger));

  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const jobResult = await db.query<JobRow>(
      `SELECT id, client_id, status, started_at, completed_at, created_at
         FROM jobs
         WHERE id = $1`,
      [id],
    );
    const jobRow = jobResult.rows[0];
    if (jobRow === undefined) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const stepsResult = await db.query<JobStepRow>(
      `SELECT id, job_id, step_name, plain_label, status,
              log_message, error_message, started_at, completed_at
         FROM job_steps
         WHERE job_id = $1
         ORDER BY step_order`,
      [id],
    );

    const body: JobDetail = {
      job: toJob(jobRow),
      steps: stepsResult.rows.map(toJobStep),
    };

    logger.debug('jobs.detail served', {
      job_id: id,
      step_count: body.steps.length,
    });
    res.status(200).json(body);
  });

  router.patch(
    '/:id/steps/:stepId/retry',
    async (req: Request, res: Response): Promise<void> => {
      const jobId = req.params.id;
      const stepId = req.params.stepId;
      if (
        typeof jobId !== 'string' || !UUID_REGEX.test(jobId) ||
        typeof stepId !== 'string' || !UUID_REGEX.test(stepId)
      ) {
        res.status(404).json({ error: 'not found' });
        return;
      }

      const actor = req.user?.email ?? 'unknown';

      const outcome = await db.withTransaction(async (tx) => {
        // Lock the step row to serialise concurrent retry clicks. Without
        // FOR UPDATE, two admins hitting retry in the same millisecond
        // could both pass the status === 'failed' check and enqueue twice.
        const stepResult = await tx.query<JobStepRow>(
          `SELECT id, job_id, step_name, plain_label, status,
                  log_message, error_message, started_at, completed_at
             FROM job_steps
             WHERE id = $1 AND job_id = $2
             FOR UPDATE`,
          [stepId, jobId],
        );
        const stepRow = stepResult.rows[0];
        if (stepRow === undefined) {
          return { kind: 'not_found' as const };
        }
        if (stepRow.status !== 'failed') {
          return { kind: 'wrong_state' as const, status: stepRow.status };
        }

        await tx.query(
          `UPDATE job_steps
              SET status = 'pending',
                  error_message = NULL,
                  started_at = NULL,
                  completed_at = NULL
            WHERE id = $1`,
          [stepId],
        );

        const jobUpdate = await tx.query<JobRow>(
          `UPDATE jobs
              SET status = 'in_progress',
                  completed_at = NULL
            WHERE id = $1
           RETURNING id, client_id, status, started_at, completed_at, created_at`,
          [jobId],
        );
        const updatedJob = jobUpdate.rows[0];
        if (updatedJob === undefined) {
          // jobId referenced by step is a FK so this should be unreachable.
          throw new Error(`job ${jobId} vanished mid-transaction`);
        }

        await tx.query(
          `UPDATE clients SET status = 'in_progress' WHERE id = $1`,
          [updatedJob.client_id],
        );

        await tx.query(
          `INSERT INTO audit_log (client_id, message, actor)
                VALUES ($1, $2, $3)`,
          [
            updatedJob.client_id,
            `Step retry triggered: ${stepRow.step_name}`,
            actor,
          ],
        );

        const refreshed = await tx.query<JobStepRow>(
          `SELECT id, job_id, step_name, plain_label, status,
                  log_message, error_message, started_at, completed_at
             FROM job_steps
             WHERE id = $1`,
          [stepId],
        );
        const refreshedStep = refreshed.rows[0];
        if (refreshedStep === undefined) {
          throw new Error(`step ${stepId} vanished mid-transaction`);
        }

        return {
          kind: 'ok' as const,
          job: updatedJob,
          step: refreshedStep,
          clientId: updatedJob.client_id,
        };
      });

      if (outcome.kind === 'not_found') {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (outcome.kind === 'wrong_state') {
        res.status(409).json({
          error: `step is ${outcome.status}, only failed steps can be retried`,
        });
        return;
      }

      try {
        await queue.enqueueJob(jobId);
      } catch (err: unknown) {
        logger.error('enqueue failed after step retry', {
          job_id: jobId,
          step_id: stepId,
          error: err instanceof Error ? err.message : 'unknown error',
        });
      }

      logger.info('jobs.step_retried', {
        job_id: jobId,
        step_id: stepId,
        client_id: outcome.clientId,
        actor,
      });

      const body: StepRetryResponse = {
        job: toJob(outcome.job),
        step: toJobStep(outcome.step),
      };
      res.status(200).json(body);
    },
  );

  return router;
}
