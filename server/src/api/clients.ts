/**
 * Client routes (§10 — JWT protected).
 *
 *   GET    /clients     → ClientListEntry[]  (list + progress)
 *   GET    /clients/:id → ClientDetail       (client + job + steps + audit)
 *   POST   /clients     → Client             (create + job + tier-scoped steps)
 *   PATCH  /clients/:id → Client             (partial update: mutable fields only)
 *
 * Invalid UUIDs on :id collapse to 404 "not found" — never leak whether the
 * id was malformed vs. simply absent. Create and update both run inside a
 * transaction so a partial failure never leaves a half-onboarded client.
 *
 * BullMQ enqueue after create lives in commit #15 once the queue module
 * exists. For now the TODO marker calls out the missing side effect so a
 * future reader cannot miss it.
 */

import { Router, type Request, type Response } from 'express';

import type {
  Client,
  ClientDetail,
  ClientListEntry,
  CreateClientRequest,
  Tier,
  UpdateClientRequest,
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
import { stepsForTier } from '../workflow/registry';

const VALID_TIERS: readonly Tier[] = ['basic', 'professional', 'enterprise'];

interface ClientListRow extends ClientRow {
  steps_total: number;
  steps_done: number;
}

function parseCreateBody(body: unknown): CreateClientRequest | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { name, company, email, phone, tier } = body as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0) {
    return null;
  }
  if (typeof company !== 'string' || company.trim().length === 0) {
    return null;
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    return null;
  }
  if (typeof tier !== 'string' || !VALID_TIERS.includes(tier as Tier)) {
    return null;
  }
  let phoneValue: string | null;
  if (phone === undefined || phone === null) {
    phoneValue = null;
  } else if (typeof phone === 'string') {
    phoneValue = phone.trim() === '' ? null : phone.trim();
  } else {
    return null;
  }
  return {
    name: name.trim(),
    company: company.trim(),
    email: email.trim().toLowerCase(),
    phone: phoneValue,
    tier: tier as Tier,
  };
}

function parseUpdateBody(body: unknown): UpdateClientRequest | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const src = body as Record<string, unknown>;
  const out: UpdateClientRequest = {};
  if (src.name !== undefined) {
    if (typeof src.name !== 'string' || src.name.trim().length === 0) {
      return null;
    }
    out.name = src.name.trim();
  }
  if (src.company !== undefined) {
    if (typeof src.company !== 'string' || src.company.trim().length === 0) {
      return null;
    }
    out.company = src.company.trim();
  }
  if (src.email !== undefined) {
    if (typeof src.email !== 'string' || !src.email.includes('@')) {
      return null;
    }
    out.email = src.email.trim().toLowerCase();
  }
  if (src.phone !== undefined) {
    if (src.phone === null) {
      out.phone = null;
    } else if (typeof src.phone === 'string') {
      out.phone = src.phone.trim() === '' ? null : src.phone.trim();
    } else {
      return null;
    }
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function createClientsRouter(
  config: AppConfig,
  db: Db,
  logger: Logger,
): Router {
  const router = Router();
  router.use(requireAuth(config, db, logger));

  router.get('/', async (_req: Request, res: Response): Promise<void> => {
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
         FROM clients WHERE id = $1`,
      [id],
    );
    const clientRow = clientResult.rows[0];
    if (clientRow === undefined) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const [jobResult, stepsResult, tasksResult, auditResult] = await Promise.all(
      [
        db.query<JobRow>(
          `SELECT id, client_id, status, started_at, completed_at, created_at
             FROM jobs WHERE client_id = $1
             ORDER BY created_at DESC LIMIT 1`,
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
             FROM human_tasks WHERE client_id = $1
             ORDER BY id`,
          [id],
        ),
        db.query<AuditLogRow>(
          `SELECT id, client_id, message, actor, created_at
             FROM audit_log WHERE client_id = $1
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

    res.status(200).json(body);
  });

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    const parsed = parseCreateBody(req.body);
    if (parsed === null) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }

    const actor = req.user?.email ?? 'unknown';
    const steps = stepsForTier(parsed.tier);

    const created = await db.withTransaction(async (tx) => {
      const clientInsert = await tx.query<ClientRow>(
        `INSERT INTO clients (name, company, email, phone, tier)
              VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, company, email, phone, tier, status,
                     portal_token, created_at, updated_at`,
        [parsed.name, parsed.company, parsed.email, parsed.phone, parsed.tier],
      );
      const clientRow = clientInsert.rows[0];
      if (clientRow === undefined) {
        throw new Error('client insert returned no row');
      }

      const jobInsert = await tx.query<{ id: string }>(
        `INSERT INTO jobs (client_id, status) VALUES ($1, 'pending')
           RETURNING id`,
        [clientRow.id],
      );
      const jobId = jobInsert.rows[0]?.id;
      if (jobId === undefined) {
        throw new Error('job insert returned no row');
      }

      // One INSERT per step rather than VALUES ($1,$2),($3,$4)... — the row
      // count is tiny (3-7) and keeping each insert parameter-bound beats
      // building a dynamic VALUES list.
      for (const step of steps) {
        await tx.query(
          `INSERT INTO job_steps (job_id, step_name, plain_label, status)
                VALUES ($1, $2, $3, 'pending')`,
          [jobId, step.step_name, step.plain_label],
        );
      }

      await tx.query(
        `INSERT INTO audit_log (client_id, message, actor)
              VALUES ($1, $2, $3)`,
        [clientRow.id, `Client onboarded at tier ${parsed.tier}`, actor],
      );

      return clientRow;
    });

    // TODO(commit #15): enqueue a BullMQ provisioning job for `created.id`
    // here. Until the queue module lands the worker will not pick up the
    // pending step rows, but the HTTP surface is stable.
    logger.info('clients.created', {
      client_id: created.id,
      tier: created.tier,
      step_count: steps.length,
      actor,
    });

    const body: Client = toClient(created);
    res.status(201).json(body);
  });

  router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const parsed = parseUpdateBody(req.body);
    if (parsed === null) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }

    const actor = req.user?.email ?? 'unknown';
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (parsed.name !== undefined) {
      fields.push(`name = $${String(idx)}`);
      values.push(parsed.name);
      idx += 1;
    }
    if (parsed.company !== undefined) {
      fields.push(`company = $${String(idx)}`);
      values.push(parsed.company);
      idx += 1;
    }
    if (parsed.email !== undefined) {
      fields.push(`email = $${String(idx)}`);
      values.push(parsed.email);
      idx += 1;
    }
    if (parsed.phone !== undefined) {
      fields.push(`phone = $${String(idx)}`);
      values.push(parsed.phone);
      idx += 1;
    }

    const updated = await db.withTransaction(async (tx) => {
      values.push(id);
      const sql = `UPDATE clients SET ${fields.join(', ')}
                      WHERE id = $${String(idx)}
                   RETURNING id, name, company, email, phone, tier, status,
                             portal_token, created_at, updated_at`;
      const result = await tx.query<ClientRow>(sql, values);
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }

      await tx.query(
        `INSERT INTO audit_log (client_id, message, actor)
              VALUES ($1, $2, $3)`,
        [id, `Client updated: ${Object.keys(parsed).join(', ')}`, actor],
      );
      return row;
    });

    if (updated === null) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    logger.info('clients.updated', {
      client_id: id,
      fields: Object.keys(parsed),
      actor,
    });

    const body: Client = toClient(updated);
    res.status(200).json(body);
  });

  return router;
}
