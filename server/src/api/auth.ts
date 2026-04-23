/**
 * Authentication endpoints for the internal dashboard (project rules §10).
 *
 * Surface:
 *   POST /auth/login   { email, password }
 *       200 — Set-Cookie: session=<JWT>; HttpOnly; SameSite=Strict; Secure(prod)
 *             body: { user: User }
 *       400 — malformed body (missing email or password)
 *       401 — { error: 'invalid credentials' } on any auth failure
 *   POST /auth/logout
 *       204 — Set-Cookie clearing the session cookie
 *   GET  /auth/me       (JWT cookie required)
 *       200 — { user: User }
 *       401 — { error: 'unauthorized' } via the middleware
 *
 * Design notes:
 *   - The JWT is never written into any response body. It lives exclusively in
 *     the cookie, so a client that forgets credentials:'include' simply cannot
 *     extract it via XHR — which is the whole point of httpOnly.
 *   - Login failure reasons are distinct in server logs (`no_user` vs.
 *     `bad_password`) but collapsed to one response message. Standard
 *     user-enumeration defence.
 *   - Email is normalised to lowercase on the login query. The seed writes
 *     lowercase; any future user-creation path must do the same or this
 *     lookup will silently miss.
 *   - bcrypt.compare is still executed on the `no_user` path via verifyPassword
 *     of a dummy hash? No — we short-circuit, accepting the small timing
 *     signal. A timing-constant path is added when rate limiting lands, since
 *     rate limiting is the real primary defence.
 */

import { Router, type Request, type Response } from 'express';

import type {
  AuthResponse,
  LoginRequest,
  User,
} from '../../../client/src/types';
import { verifyPassword } from '../auth/passwords';
import { signToken } from '../auth/tokens';
import type { AppConfig } from '../config';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import { SESSION_COOKIE_NAME, requireAuth } from '../middleware/auth';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface UserWithHashRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

function toUser(row: UserWithHashRow): User {
  return {
    id: row.id,
    email: row.email,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Cookie options shared by login (set) and logout (clear). Must match across
 * both calls or the browser will treat them as different cookies and the
 * clearCookie() call silently no-ops.
 */
function sessionCookieOptions(config: Pick<AppConfig, 'nodeEnv'>) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: SEVEN_DAYS_MS,
  };
}

function parseLoginBody(body: unknown): LoginRequest | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length === 0) {
    return null;
  }
  if (typeof password !== 'string' || password.length === 0) {
    return null;
  }
  return { email, password };
}

export function createAuthRouter(
  config: AppConfig,
  db: Db,
  logger: Logger,
): Router {
  const router = Router();
  const cookieOpts = sessionCookieOptions(config);

  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const parsed = parseLoginBody(req.body);
    if (parsed === null) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }

    const email = parsed.email.trim().toLowerCase();

    const result = await db.query<UserWithHashRow>(
      `SELECT id, email, password_hash, created_at
         FROM users
         WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    if (row === undefined) {
      logger.warn('auth.login_failed', { reason: 'no_user', email });
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const passwordOk = await verifyPassword(parsed.password, row.password_hash);
    if (!passwordOk) {
      logger.warn('auth.login_failed', { reason: 'bad_password', email });
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const user = toUser(row);
    const token = signToken({ sub: user.id, email: user.email }, config);
    res.cookie(SESSION_COOKIE_NAME, token, cookieOpts);

    logger.info('auth.login', { user_id: user.id, email: user.email });
    const body: AuthResponse = { user };
    res.status(200).json(body);
  });

  router.post('/logout', (_req: Request, res: Response): void => {
    res.clearCookie(SESSION_COOKIE_NAME, cookieOpts);
    logger.info('auth.logout');
    res.status(204).end();
  });

  router.get(
    '/me',
    requireAuth(config, db, logger),
    (req: Request, res: Response): void => {
      if (req.user === undefined) {
        // Defensive: requireAuth guarantees this on the success path, but an
        // explicit check prevents a future refactor from silently leaking a
        // 200 without a user body.
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const body: AuthResponse = { user: req.user };
      res.status(200).json(body);
    },
  );

  return router;
}
