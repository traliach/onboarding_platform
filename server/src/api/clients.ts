/**
 * Client routes (§10 — JWT protected).
 *
 *   GET /clients     → ClientListEntry[] with steps_total / steps_done
 *   GET /clients/:id → ClientDetail (client + job + steps + tasks + audit)
 *
 * Invalid UUIDs on :id collapse to 404 along with "not found" so the client
 * response never leaks whether the id was malformed or simply absent.
 */

import { Router, type Request, type Response } from 'express';

import type {
  ClientDetail,
  ClientListEntry,
} from '../../../client/src/types';
import type { AppConfig } from '../config';
import type { Db } from '../db/pool';
import {
  UUID_REGEX,
  type AuditLogRow,
  type ClientRow,
  type HumanTaskRow,
  type JobRow,
  type JobStepRow,
  toAuditLog,
  toClient,
  toHumanTask,
  toJob,
  toJobStep,
} from '../db/mappers';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';

interface ClientListRow extends ClientRow {
  steps_total: number;
  steps_done: number;
}

export function createClientsRouter(
  config: AppConfig,
  db: Db,
  logger: Logger,
): Router {
  const router = Router();
  router.use(requireAuth(config, db, logger));

  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    // Subqueries cast COUNT to int so the node pg driver hands us a number
    // instead of a bigint string. COALESCE covers clients with no job yet.
    const result = await db.query<ClientListRow>(
      `SELECT c.id, c.name, c.company, c.email, c.phone, c.tier, c.status,
              c.portal_token, c.created_at, c.updated_at,
              COALESCE((
                SELECT COUNT(*)::int
                  FROM job_steps js
                  JOIN jobs j ON j.id = js.job_id
                 WHERE j.client_id = c.id
              ), 0) AS steps_total,
              COALESCE((
                SELECT COUNT(*)::int
                  FROM job_steps js
                  JOIN jobs j ON j.id = js.job_id
                 WHERE j.client_id = c.id AND js.status = 'done'
              ), 0) AS steps_done
         FROM clients c
         ORDER BY c.created_at DESC`,
    );

    const body: ClientListEntry[] = result.rows.map((row) => ({
      ...toClient(row),
      steps_total: row.steps_total,
      steps_done: row.steps_done,
    }));

    res.status(200).json(body);
  });

  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const clientResult = await db.query<ClientRow>(
      `SELECT id, name, company, email, phone, tier, status,
              portal_token, created_at, updated_at
         FROM clients
         WHERE id = $1`,
      [id],
    );
    const clientRow = clientResult.rows[0];
    if (clientRow === undefined) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    // The four related datasets are independent — fan out in parallel rather
    // than serial-chain. For a one-off detail view on t2.micro-sized Postgres
    // the four cached queries finish inside a single network round-trip.
    const [jobResult, stepsResult, tasksResult, auditResult] = await Promise.all(
      [
        db.query<JobRow>(
          `SELECT id, client_id, status, started_at, completed_at, created_at
             FROM jobs
             WHERE client_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
          [id],
        ),
        db.query<JobStepRow>(
          `SELECT js.id, js.job_id, js.step_name, js.plain_label, js.status,
                  js.log_message, js.error_message, js.started_at, js.completed_at
             FROM job_steps js
             JOIN jobs j ON j.id = js.job_id
             WHERE j.client_id = $1
             ORDER BY js.started_at NULLS LAST, js.id`,
          [id],
        ),
        db.query<HumanTaskRow>(
          `SELECT id, client_id, label, done, completed_at, completed_by
             FROM human_tasks
             WHERE client_id = $1
             ORDER BY id`,
          [id],
        ),
        db.query<AuditLogRow>(
          `SELECT id, client_id, message, actor, created_at
             FROM audit_log
             WHERE client_id = $1
             ORDER BY created_at DESC`,
          [id],
        ),
      ],
    );

    const jobRow = jobResult.rows[0];
    const body: ClientDetail = {
      client: toClient(clientRow),
      job: jobRow === undefined ? null : toJob(jobRow),
      steps: stepsResult.rows.map(toJobStep),
      human_tasks: tasksResult.rows.map(toHumanTask),
      audit_log: auditResult.rows.map(toAuditLog),
    };

    logger.debug('clients.detail served', {
      client_id: id,
      step_count: body.steps.length,
    });
    res.status(200).json(body);
  });

  return router;
}
