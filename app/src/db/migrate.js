'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadConfig } = require('../config');
const { getPool, closePool } = require('./client');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

async function appliedFilenames(pool) {
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((row) => row.filename));
}

async function applyMigration(pool, filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = await fs.readFile(filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function runMigrations(databaseUrl) {
  const pool = getPool(databaseUrl);
  await pool.query(CREATE_MIGRATIONS_TABLE);

  const [files, applied] = await Promise.all([listMigrationFiles(), appliedFilenames(pool)]);
  const pending = files.filter((file) => !applied.has(file));

  for (const filename of pending) {
    // eslint-disable-next-line no-console
    console.log(`applying migration: ${filename}`);
    await applyMigration(pool, filename);
  }

  return { applied: pending, skipped: files.length - pending.length };
}

async function main() {
  const config = loadConfig();
  try {
    const result = await runMigrations(config.databaseUrl);
    // eslint-disable-next-line no-console
    console.log(`migrations complete: applied=${result.applied.length}, skipped=${result.skipped}`);
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('migration failed:', err);
    process.exit(1);
  });
}

module.exports = { runMigrations };
