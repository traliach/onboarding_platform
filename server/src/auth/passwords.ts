/**
 * Password hashing and verification helpers. Wraps bcrypt so the rest of the
 * codebase never touches the raw library directly — this keeps the cost factor
 * sourced from validated config and isolates the algorithm choice to one file.
 *
 * Never log, return, or persist plain-text passwords. The only values that
 * leave this module are opaque hash strings safe to store in `users.password_hash`.
 */

import bcrypt from 'bcrypt';

import type { AppConfig } from '../config/index.js';

/**
 * Hash a plain-text password using bcrypt with the cost factor from config.
 *
 * The returned string includes the algorithm, cost factor, and salt, so
 * {@link verifyPassword} does not need them as separate arguments.
 */
export async function hashPassword(
  plainPassword: string,
  config: Pick<AppConfig, 'bcryptCostFactor'>,
): Promise<string> {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new Error('hashPassword: plainPassword must be a non-empty string');
  }
  return bcrypt.hash(plainPassword, config.bcryptCostFactor);
}

/**
 * Verify a plain-text password against a stored bcrypt hash. Returns true only
 * on an exact match. Returns false for any mismatch or malformed hash — never
 * throws on a bad comparison so callers can treat "wrong password" and
 * "hash format unreadable" as the same 401 outcome without leaking detail.
 */
export async function verifyPassword(
  plainPassword: string,
  storedHash: string,
): Promise<boolean> {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    return false;
  }
  if (typeof storedHash !== 'string' || storedHash.length === 0) {
    return false;
  }
  try {
    return await bcrypt.compare(plainPassword, storedHash);
  } catch {
    return false;
  }
}
