/**
 * PostgreSQL connection pool — the only path to the database.
 *
 * Rules (CLAUDE.md section 5 + section 6):
 *   - Direct pg driver, no ORM. Queries are raw SQL with $1-style parameters.
 *   - One pool per process. Do not create ad-hoc pools in route handlers.
 *   - Never concatenate user input into SQL. Always pass as params.
 *   - `withTransaction` is the only sanctioned transaction helper so BEGIN /
 *     COMMIT / ROLLBACK are impossible to misuse (e.g. forgetting ROLLBACK
 *     on the error path, or returning a client to the pool while still in a
 *     transaction).
 *
 * Pool sizing is tuned for the t2.micro database host (section 5). The pool
 * max (10) matches the PostgreSQL `max_connections` budget for the api and
 * worker combined with headroom for psql sessions and pg_dump.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import type { AppConfig } from '../config';
import type { Logger } from '../logger';

const POOL_MAX_CONNECTIONS = 10;
const POOL_IDLE_TIMEOUT_MS = 30_000;
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDb(config: AppConfig, logger: Logger): Db {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    application_name: `onboarding-${config.appTarget}`,
  });

  pool.on('error', (err: Error) => {
    logger.error('pg pool error', { message: err.message });
  });

  return {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      const values = params === undefined ? undefined : [...params];
      return pool.query<R>(text, values);
    },

    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          logger.error('rollback failed', {
            message: rollbackErr instanceof Error ? rollbackErr.message : 'unknown',
          });
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async ping(): Promise<void> {
      await pool.query('SELECT 1');
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
