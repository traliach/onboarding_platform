/**
 * Development seed script (CLAUDE.md section 12).
 *
 * Creates:
 *   - one admin user for the internal dashboard (bcrypt-hashed password)
 *   - three sample clients, one per tier (basic / professional / enterprise),
 *     each with a server-generated portal_token
 *
 * Idempotency:
 *   - The users insert uses ON CONFLICT (email) DO NOTHING, so rerunning the
 *     script never creates a second admin row or rotates the password silently.
 *   - The clients insert is guarded by a row-count check — if any clients
 *     already exist, the script leaves them alone rather than piling on more
 *     sample rows. The alternative (TRUNCATE clients) would silently wipe real
 *     dev data on every rerun, which is a surprising side effect for a "seed"
 *     command.
 *
 * Output:
 *   On success, prints the admin credentials and each sample client's portal
 *   URL to stdout so the developer can log in and open each portal without
 *   running a SELECT against the database.
 *
 * Rules honored:
 *   - Section 6: password_hash is bcrypt via the shared auth/passwords helper;
 *     the cost factor comes from validated config, never hardcoded here.
 *   - Section 10: portal_token values come from PostgreSQL's gen_random_uuid()
 *     default — never generated in application code, never sequential.
 *   - Section 12: dev-only. In production the admin user is created by the
 *     Ansible `db` role using credentials from Vault, not by this script.
 *
 * Exit codes:
 *   0 — seed completed or was already applied (idempotent no-op)
 *   1 — configuration, IO, or SQL error; stderr carries the detail
 */

import process from 'node:process';

import { hashPassword } from '../auth/passwords';
import { loadConfig } from '../config';
import { createRootLogger, type Logger } from '../logger';
import { createDb, type Db } from './pool';

/**
 * Dev-only admin credentials. Safe to commit because this script only ever
 * runs against a local docker-compose Postgres. The production admin is
 * provisioned by Ansible with a Vault-sourced password; this constant is
 * never read in that path.
 */
const ADMIN_EMAIL = 'admin@onboarding.local';
const ADMIN_PASSWORD = 'changeme-dev-only';

interface SampleClient {
  readonly name: string;
  readonly company: string;
  readonly email: string;
  readonly phone: string | null;
  readonly tier: 'basic' | 'professional' | 'enterprise';
}

const SAMPLE_CLIENTS: readonly SampleClient[] = [
  {
    name: 'Alice Chen',
    company: 'Chen Consulting LLC',
    email: 'alice@chen-consulting.example',
    phone: '+1-555-0101',
    tier: 'basic',
  },
  {
    name: 'Marcus Rivera',
    company: 'Rivera Logistics Group',
    email: 'marcus@rivera-logistics.example',
    phone: '+1-555-0202',
    tier: 'professional',
  },
  {
    name: 'Priya Shah',
    company: 'Shah Industrial Systems',
    email: 'priya@shah-industrial.example',
    phone: '+1-555-0303',
    tier: 'enterprise',
  },
];

interface SeededClient {
  readonly id: string;
  readonly company: string;
  readonly tier: string;
  readonly portal_token: string;
}

async function seedAdmin(
  db: Db,
  passwordHash: string,
  logger: Logger,
): Promise<void> {
  const result = await db.query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [ADMIN_EMAIL, passwordHash],
  );

  if (result.rowCount === 0) {
    logger.info('admin user already exists, leaving it alone', {
      email: ADMIN_EMAIL,
    });
    return;
  }
  logger.info('admin user created', { email: ADMIN_EMAIL });
}

async function seedClients(
  db: Db,
  logger: Logger,
): Promise<readonly SeededClient[]> {
  // Guard: never stack duplicate sample rows. If any clients exist — real
  // dev data or a previous seed run — skip the insert and return what is
  // already there so the summary printer still has portal URLs to show.
  const countResult = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM clients',
  );
  const existing = Number.parseInt(countResult.rows[0].count, 10);
  if (existing > 0) {
    logger.info('clients table non-empty, skipping client seed', { existing });
    const rows = await db.query<SeededClient>(
      `SELECT id, company, tier, portal_token
         FROM clients
         ORDER BY created_at ASC
         LIMIT 10`,
    );
    return rows.rows;
  }

  const seeded: SeededClient[] = [];
  for (const sample of SAMPLE_CLIENTS) {
    const result = await db.query<SeededClient>(
      `INSERT INTO clients (name, company, email, phone, tier)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, company, tier, portal_token`,
      [sample.name, sample.company, sample.email, sample.phone, sample.tier],
    );
    const row = result.rows[0];
    seeded.push(row);
    logger.info('sample client created', {
      id: row.id,
      company: row.company,
      tier: row.tier,
    });
  }
  return seeded;
}

function printSummary(
  clients: readonly SeededClient[],
  portalBaseUrl: string,
): void {
  // PORTAL_BASE_URL is documented in .env.example as `{PORTAL_BASE_URL}/{token}`,
  // so strip any trailing slash and append /{token} directly — do not insert
  // an extra /portal segment.
  const base = portalBaseUrl.replace(/\/$/, '');
  const out = process.stdout;

  out.write('\n=== seed complete ===\n\n');
  out.write('admin credentials (dev only — rotate before any shared use):\n');
  out.write(`  email:    ${ADMIN_EMAIL}\n`);
  out.write(`  password: ${ADMIN_PASSWORD}\n\n`);
  out.write('sample client portals:\n');
  for (const client of clients) {
    const url = `${base}/${client.portal_token}`;
    out.write(`  ${client.tier.padEnd(12)} ${client.company}\n`);
    out.write(`    ${url}\n`);
  }
  out.write('\n');
}

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createRootLogger(config);
  const db = createDb(config, logger);

  try {
    const passwordHash = await hashPassword(ADMIN_PASSWORD, config);
    await seedAdmin(db, passwordHash, logger);
    const clients = await seedClients(db, logger);
    printSummary(clients, config.portalBaseUrl);
  } finally {
    await db.close();
  }
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`seed failed: ${message}\n`);
  if (err instanceof Error && err.stack !== undefined) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
