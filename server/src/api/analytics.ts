/**
 * Analytics route (§10 — JWT protected).
 *
 *   GET /analytics/summary → Analytics
 *
 * Six aggregations fanned out in parallel — Postgres is on the same host in
 * dev and on a dedicated t2.micro in prod, so sequential would serialize
 * round-trips for no benefit. Every aggregate wraps an empty-state COALESCE
 * so the endpoint returns a valid Analytics body against a freshly seeded DB
 * with no jobs yet.
 */

import { Router, type Request, type Response } from 'express';

import type {
  Analytics,
  AnalyticsStepDuration,
  AnalyticsStepFailure,
} from '../../../client/src/types';
import type { AppConfig } from '../config';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';

interface CompletionRow {
  total: number;
  done: number;
}

interface AvgCompletionRow {
  avg_seconds: number | null;
}

interface OnboardedThisMonthRow {
  count: number;
}

interface AvgStepsPerClientRow {
  avg_steps: number | null;
}

interface StepDurationRow {
  step_name: AnalyticsStepDuration['step_name'];
  plain_label: string;
  avg_seconds: number | null;
}

interface StepFailureRow {
  step_name: AnalyticsStepFailure['step_name'];
  plain_label: string;
  total: number;
  failed: number;
}

export function createAnalyticsRouter(
  config: AppConfig,
  db: Db,
  logger: Logger,
): Router {
  const router = Router();
  router.use(requireAuth(config, db, logger));

  router.get('/summary', async (_req: Request, res: Response): Promise<void> => {
    const [
      completionResult,
      avgCompletionResult,
      onboardedResult,
      avgStepsResult,
      durationsResult,
      failuresResult,
    ] = await Promise.all([
      db.query<CompletionRow>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'done')::int AS done
           FROM clients`,
      ),
      db.query<AvgCompletionRow>(
        `SELECT AVG(EXTRACT(EPOCH FROM completed_at - started_at))::float AS avg_seconds
           FROM jobs
           WHERE status = 'done'
             AND started_at IS NOT NULL
             AND completed_at IS NOT NULL`,
      ),
      db.query<OnboardedThisMonthRow>(
        `SELECT COUNT(*)::int AS count
           FROM jobs
           WHERE status = 'done'
             AND completed_at >= date_trunc('month', now())
             AND completed_at <  date_trunc('month', now()) + interval '1 month'`,
      ),
      db.query<AvgStepsPerClientRow>(
        `SELECT AVG(step_count)::float AS avg_steps
           FROM (
             SELECT COUNT(js.id)::int AS step_count
               FROM clients c
               LEFT JOIN jobs j ON j.client_id = c.id
               LEFT JOIN job_steps js ON js.job_id = j.id
               GROUP BY c.id
           ) AS per_client`,
      ),
      db.query<StepDurationRow>(
        `SELECT step_name,
                MIN(plain_label) AS plain_label,
                AVG(EXTRACT(EPOCH FROM completed_at - started_at))::float AS avg_seconds
           FROM job_steps
           WHERE status = 'done'
             AND started_at IS NOT NULL
             AND completed_at IS NOT NULL
           GROUP BY step_name
           ORDER BY step_name`,
      ),
      db.query<StepFailureRow>(
        `SELECT step_name,
                MIN(plain_label) AS plain_label,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM job_steps
           GROUP BY step_name
           ORDER BY step_name`,
      ),
    ]);

    const completion = completionResult.rows[0];
    const totalClients = completion?.total ?? 0;
    const doneClients = completion?.done ?? 0;

    const body: Analytics = {
      success_rate: totalClients === 0 ? 0 : doneClients / totalClients,
      avg_completion_seconds: avgCompletionResult.rows[0]?.avg_seconds ?? 0,
      onboarded_this_month: onboardedResult.rows[0]?.count ?? 0,
      avg_steps_per_client: avgStepsResult.rows[0]?.avg_steps ?? 0,
      step_durations: durationsResult.rows.map(
        (r): AnalyticsStepDuration => ({
          step_name: r.step_name,
          plain_label: r.plain_label,
          avg_seconds: r.avg_seconds ?? 0,
        }),
      ),
      step_failures: failuresResult.rows.map(
        (r): AnalyticsStepFailure => ({
          step_name: r.step_name,
          plain_label: r.plain_label,
          failure_rate: r.total === 0 ? 0 : r.failed / r.total,
        }),
      ),
    };

    logger.debug('analytics.summary served', {
      total_clients: totalClients,
      done_clients: doneClients,
    });
    res.status(200).json(body);
  });

  return router;
}
