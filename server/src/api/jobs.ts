/**
 * Job routes (§10 — JWT protected).
 *
 *   GET /jobs/:id → JobDetail (job + its steps)
 *
 * The retry endpoint (PATCH /jobs/:id/steps/:stepId/retry) lands in a later
 * commit alongside the BullMQ producer wiring it needs.
 */

import { Router, type Request, type Response } from 'express';

import type { JobDetail } from '../../../client/src/types';
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

export function createJobsRouter(
  config: AppConfig,
  db: Db,
  logger: Logger,
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
         ORDER BY started_at NULLS LAST, id`,
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

  return router;
}
