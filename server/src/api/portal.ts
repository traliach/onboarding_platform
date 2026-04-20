/**
 * Portal route — public, no JWT required (§10).
 *
 *   GET /portal/:token → PortalView (scoped to one client)
 *
 * The response is deliberately narrow: no internal IDs, no step_name, no
 * log_message, no error_message, no audit log. The client sees plain-English
 * step labels and a progress percentage — nothing else. Invalid tokens get a
 * clean 404 JSON error with no stack trace.
 */

import { Router, type Request, type Response } from 'express';

import type { PortalView } from '../../../client/src/types';
import type { AppConfig } from '../config';
import type { Db } from '../db/pool';
import { UUID_REGEX, type ClientRow } from '../db/mappers';
import type { Logger } from '../logger';

interface PortalStepRow {
  plain_label: string;
  status: ClientRow['status'];
}

interface PortalTaskRow {
  label: string;
  done: boolean;
}

export function createPortalRouter(
  _config: AppConfig,
  db: Db,
  logger: Logger,
): Router {
  const router = Router();

  router.get('/:token', async (req: Request, res: Response): Promise<void> => {
    const token = req.params.token;
    if (typeof token !== 'string' || !UUID_REGEX.test(token)) {
      res.status(404).json({ error: 'link not found' });
      return;
    }

    const clientResult = await db.query<
      Pick<ClientRow, 'id' | 'name' | 'company' | 'tier' | 'status'>
    >(
      `SELECT id, name, company, tier, status
         FROM clients
         WHERE portal_token = $1`,
      [token],
    );
    const clientRow = clientResult.rows[0];
    if (clientRow === undefined) {
      logger.info('portal.not_found', { token });
      res.status(404).json({ error: 'link not found' });
      return;
    }

    const [stepsResult, tasksResult] = await Promise.all([
      db.query<PortalStepRow>(
        `SELECT js.plain_label, js.status
           FROM job_steps js
           JOIN jobs j ON j.id = js.job_id
           WHERE j.client_id = $1
           ORDER BY js.step_order`,
        [clientRow.id],
      ),
      db.query<PortalTaskRow>(
        `SELECT label, done
           FROM human_tasks
           WHERE client_id = $1
           ORDER BY id`,
        [clientRow.id],
      ),
    ]);

    const total = stepsResult.rows.length;
    const completed = stepsResult.rows.filter((s) => s.status === 'done').length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

    const body: PortalView = {
      client: {
        name: clientRow.name,
        company: clientRow.company,
        tier: clientRow.tier,
        status: clientRow.status,
      },
      progress: { completed, total, percentage },
      steps: stepsResult.rows,
      human_tasks: tasksResult.rows,
    };

    res.status(200).json(body);
  });

  return router;
}
