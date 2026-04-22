/**
 * Invite-only registration endpoints (CLAUDE.md §6).
 *
 * Surface:
 *   POST /auth/invite             [JWT required]
 *       Body: { email }
 *       201 — { token, email, expires_at }
 *       400 — malformed body
 *       409 — email already registered
 *
 *   GET  /auth/invite/:token      [public]
 *       200 — { email, valid: true }
 *       404 — token not found, expired, or already used
 *
 *   POST /auth/register/:token    [public]
 *       Body: { password }
 *       201 — { user: User }
 *       400 — bad body or password too short
 *       404 — token not found, expired, or already used
 *       409 — email from token already registered
 *
 * Token lifecycle:
 *   - UUID generated server-side, stored in invite_tokens.token
 *   - Expires 24 h after creation (expires_at = NOW() + INTERVAL '24 hours')
 *   - Single-use: used = true after a successful registration
 *   - Never modifiable by the caller
 */

import { Router, type Request, type Response } from 'express';

import type {
  InviteRequest,
  InviteResponse,
  InviteValidationResponse,
  RegisterRequest,
  User,
} from '../../../client/src/types';
import { hashPassword } from '../auth/passwords';
import type { AppConfig } from '../config';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';

interface InviteTokenRow {
  id: string;
  token: string;
  email: string;
  used: boolean;
  expires_at: Date;
  created_by: string;
  created_at: Date;
}

interface UserRow {
  id: string;
  email: string;
  created_at: Date;
}

function parseInviteBody(body: unknown): InviteRequest | null {
  if (typeof body !== 'object' || body === null) { return null; }
  const { email } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.trim().length === 0) { return null; }
  return { email: email.trim().toLowerCase() };
}

function parseRegisterBody(body: unknown): RegisterRequest | null {
  if (typeof body !== 'object' || body === null) { return null; }
  const { password } = body as Record<string, unknown>;
  if (typeof password !== 'string' || password.length === 0) { return null; }
  return { password };
}

export function createInviteRouter(
  config: AppConfig,
  db: Db,
  logger: Logger,
): Router {
  const router = Router();

  router.post(
    '/invite',
    requireAuth(config, db, logger),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = parseInviteBody(req.body);
      if (parsed === null) {
        res.status(400).json({ error: 'email is required' });
        return;
      }

      const existing = await db.query<UserRow>(
        'SELECT id FROM users WHERE email = $1',
        [parsed.email],
      );
      if (existing.rows.length > 0) {
        res.status(409).json({ error: 'email already registered' });
        return;
      }

      const result = await db.query<InviteTokenRow>(
        `INSERT INTO invite_tokens (email, expires_at, created_by)
         VALUES ($1, NOW() + INTERVAL '24 hours', $2)
         RETURNING id, token, email, expires_at`,
        [parsed.email, req.user!.id],
      );
      const row = result.rows[0];

      logger.info('invite.created', {
        token: row.token,
        email: row.email,
        created_by: req.user!.id,
      });

      const body: InviteResponse = {
        token: row.token,
        email: row.email,
        expires_at: row.expires_at.toISOString(),
      };
      res.status(201).json(body);
    },
  );

  router.get(
    '/invite/:token',
    async (req: Request, res: Response): Promise<void> => {
      const { token } = req.params as { token: string };

      const result = await db.query<InviteTokenRow>(
        `SELECT id, token, email, used, expires_at
           FROM invite_tokens
           WHERE token = $1
             AND used = false
             AND expires_at > NOW()`,
        [token],
      );
      const row = result.rows[0];
      if (row === undefined) {
        res.status(404).json({ error: 'invite link not found or expired' });
        return;
      }

      const body: InviteValidationResponse = { email: row.email, valid: true };
      res.status(200).json(body);
    },
  );

  router.post(
    '/register/:token',
    async (req: Request, res: Response): Promise<void> => {
      const { token } = req.params as { token: string };
      const parsed = parseRegisterBody(req.body);
      if (parsed === null) {
        res.status(400).json({ error: 'password is required' });
        return;
      }
      if (parsed.password.length < 12) {
        res.status(400).json({ error: 'password must be at least 12 characters' });
        return;
      }

      const inviteResult = await db.query<InviteTokenRow>(
        `SELECT id, token, email, used, expires_at
           FROM invite_tokens
           WHERE token = $1
             AND used = false
             AND expires_at > NOW()`,
        [token],
      );
      const invite = inviteResult.rows[0];
      if (invite === undefined) {
        res.status(404).json({ error: 'invite link not found or expired' });
        return;
      }

      const existingUser = await db.query<UserRow>(
        'SELECT id FROM users WHERE email = $1',
        [invite.email],
      );
      if (existingUser.rows.length > 0) {
        res.status(409).json({ error: 'email already registered' });
        return;
      }

      const passwordHash = await hashPassword(parsed.password, config);

      let newUser: User;
      await db.withTransaction(async (client) => {
        const insertResult = await client.query<UserRow>(
          `INSERT INTO users (email, password_hash)
           VALUES ($1, $2)
           RETURNING id, email, created_at`,
          [invite.email, passwordHash],
        );
        const row = insertResult.rows[0];
        newUser = {
          id: row.id,
          email: row.email,
          created_at: row.created_at.toISOString(),
        };

        await client.query(
          'UPDATE invite_tokens SET used = true WHERE id = $1',
          [invite.id],
        );
      });

      logger.info('invite.registered', { email: invite.email });
      res.status(201).json({ user: newUser! });
    },
  );

  return router;
}
