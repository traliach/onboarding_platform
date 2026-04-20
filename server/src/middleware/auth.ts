/**
 * JWT cookie → req.user authentication middleware (CLAUDE.md §10).
 *
 * Contract honored here:
 *   - Read the token from the httpOnly cookie set by POST /auth/login. Never
 *     accept it from Authorization headers or query strings.
 *   - Verify through the auth/tokens helper — never inline jsonwebtoken calls
 *     in a route or handler (§10 forbids it).
 *   - Re-fetch the user row on every request so a deleted or disabled user
 *     stops working immediately, rather than waiting for JWT expiry. The cost
 *     is one cached-hot primary-key lookup per protected request.
 *   - Attach the freshly loaded DB row to req.user. Nothing else should trust
 *     the JWT claims past the verify step — the source of truth is the row.
 *   - Reject every failure path with an identical 401 body. The reason is
 *     logged server-side at debug level for triage; the client never learns
 *     whether the cookie was missing, expired, tampered, or the user was
 *     deleted. Distinct responses would leak enumeration signal.
 */

import type { NextFunction, Request, Response } from 'express';

import { InvalidTokenError, verifyToken } from '../auth/tokens';
import type { AppConfig } from '../config';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';

export const SESSION_COOKIE_NAME = 'session';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly created_at: string;
}

// Module augmentation so req.user is typed wherever Express's Request is
// used. Keep this interface free of optional fields other than `user` itself
// — ownership of Request's shape belongs to Express and its other consumers.
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

interface UserRow {
  id: string;
  email: string;
  created_at: Date;
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ error: 'unauthorized' });
}

/**
 * Factory returning the per-request middleware. Dep-injected so the auth
 * layer can be exercised in tests against a stub `Db` without standing up
 * the full Express app.
 */
export function requireAuth(
  config: Pick<AppConfig, 'jwtSecret'>,
  db: Db,
  logger: Logger,
) {
  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    const raw = cookies[SESSION_COOKIE_NAME];

    if (typeof raw !== 'string' || raw.length === 0) {
      logger.debug('auth reject: no session cookie');
      sendUnauthorized(res);
      return;
    }

    let sub: string;
    try {
      const payload = verifyToken(raw, config);
      sub = payload.sub;
    } catch (err: unknown) {
      const reason =
        err instanceof InvalidTokenError ? err.message : 'verify_failed';
      logger.debug('auth reject: token verify failed', { reason });
      sendUnauthorized(res);
      return;
    }

    const result = await db.query<UserRow>(
      'SELECT id, email, created_at FROM users WHERE id = $1',
      [sub],
    );
    const row = result.rows[0];
    if (row === undefined) {
      // Token was valid but the user no longer exists. Could be a deleted
      // admin or a leftover cookie from a wiped dev DB. Same 401 as every
      // other rejection path.
      logger.debug('auth reject: user row missing', { sub });
      sendUnauthorized(res);
      return;
    }

    req.user = {
      id: row.id,
      email: row.email,
      created_at: row.created_at.toISOString(),
    };
    next();
  };
}
