/**
 * Forward-only SQL migration runner.
 *
 * Scans server/src/db/migrations/*.sql, applies every file that is not yet
 * recorded in the schema_migrations table, in lexicographic filename order.
 * Each migration runs inside a single transaction alongside the insert into
 * schema_migrations, so a crash mid-migration leaves no partial schema.
 *
 * Naming convention (enforced by convention, not code):
 *   NNNN_short_description.sql     e.g. 0001_create_clients.sql
 *
 * Rules (project rules section 5 + section 6):
 *   - Migrations are pure SQL. No JavaScript/TypeScript migrations.
 *   - Migrations are forward-only. There is no `down` path; schema changes
 *     roll forward with corrective migrations in production.
 *   - Operators invoke the runner via `npm run migrate` in dev or the
 *     Ansible `db` role during deploy.
 *
 * Exit codes:
 *   0 — migrations table is up to date (including the zero-pending case)
 *   1 — validation, IO, or SQL error; stderr carries the detail
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadConfig } from '../config';
import { createRootLogger, type Logger } from '../logger';
import { createDb, type Db } from './pool';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface MigrationRow {
  filename: string;
}

async function ensureMigrationsTable(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listApplied(db: Db): Promise<ReadonlySet<string>> {
  const result = await db.query<MigrationRow>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((row) => row.filename));
}

async function listOnDisk(): Promise<readonly string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function applyOne(db: Db, filename: string, logger: Logger): Promise<void> {
  const absolute = join(MIGRATIONS_DIR, filename);
  const sql = await readFile(absolute, 'utf8');

  await db.withTransaction(async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  });

  logger.info('migration applied', { filename });
}

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createRootLogger(config);
  const db = createDb(config, logger);

  try {
    await ensureMigrationsTable(db);

    const applied = await listApplied(db);
    const onDisk = await listOnDisk();
    const pending = onDisk.filter((name) => !applied.has(name));

    const orphaned = [...applied].filter((name) => !onDisk.includes(name));
    if (orphaned.length > 0) {
      logger.warn('applied migrations missing on disk', { orphaned });
    }

    if (pending.length === 0) {
      logger.info('no pending migrations', {
        applied: applied.size,
        on_disk: onDisk.length,
      });
      return;
    }

    logger.info('applying pending migrations', {
      pending_count: pending.length,
      pending,
    });

    for (const filename of pending) {
      await applyOne(db, filename, logger);
    }

    logger.info('migrations complete', { applied_count: pending.length });
  } finally {
    await db.close();
  }
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`migration runner failed: ${message}\n`);
  if (err instanceof Error && err.stack !== undefined) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
