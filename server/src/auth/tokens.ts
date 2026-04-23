/**
 * JWT sign and verify helpers for the internal dashboard session cookie.
 *
 * project rules §10 requires:
 *   - The JWT is stored in an httpOnly, SameSite=Strict cookie (handled by the
 *     routes that call {@link signToken}; this module only produces the string).
 *   - `JWT_SECRET` is sourced from validated config, never hardcoded.
 *   - Route handlers never verify tokens inline — they go through the auth
 *     middleware, which is the only consumer of {@link verifyToken} outside tests.
 *
 * The token carries the minimal claims needed to identify a session:
 *   - `sub`    the user id (UUID)
 *   - `email`  the user email (for audit/logging without a DB round trip)
 * Any richer user data must be fetched from the `users` table.
 *
 * Token lifetime is fixed at 7 days for now. project rules does not mandate a
 * specific value, so this lives as a constant rather than another env knob —
 * revisit if/when a refresh-token flow is introduced.
 */

import jwt from 'jsonwebtoken';

import type { AppConfig } from '../config/index.js';

const TOKEN_EXPIRES_IN = '7d';

/** Raised when a token cannot be trusted: expired, tampered, or malformed. */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/** Shape of the payload we put into — and expect to read out of — every token. */
export interface AuthTokenPayload {
  /** User id (UUID). */
  readonly sub: string;
  /** User email, lowercased. */
  readonly email: string;
}

/**
 * Sign a short payload as a JWT using HS256 and the configured secret.
 * Returns the compact token string suitable for an httpOnly cookie value.
 */
export function signToken(
  payload: AuthTokenPayload,
  config: Pick<AppConfig, 'jwtSecret'>,
): string {
  return jwt.sign({ email: payload.email }, config.jwtSecret, {
    subject: payload.sub,
    expiresIn: TOKEN_EXPIRES_IN,
  });
}

/**
 * Verify a token and return its payload, or throw {@link InvalidTokenError}.
 *
 * Collapses every jsonwebtoken failure (expired, bad signature, malformed,
 * claim-shape mismatch) into a single exception type so callers — in practice
 * the auth middleware — can respond with an uniform 401 without leaking
 * which specific failure occurred.
 */
export function verifyToken(
  rawToken: string,
  config: Pick<AppConfig, 'jwtSecret'>,
): AuthTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(rawToken, config.jwtSecret);
  } catch (err) {
    throw new InvalidTokenError(
      err instanceof Error ? err.message : 'token verification failed',
    );
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw new InvalidTokenError('token payload is not an object');
  }

  const { sub, email } = decoded as Record<string, unknown>;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new InvalidTokenError('token missing sub claim');
  }
  if (typeof email !== 'string' || email.length === 0) {
    throw new InvalidTokenError('token missing email claim');
  }

  return { sub, email };
}
