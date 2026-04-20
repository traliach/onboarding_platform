'use strict';

const { loadConfig } = require('../config');
const { getPool, closePool } = require('./client');

const SEED_CLIENTS = [
  { name: 'Acme Corp', email: 'ops@acme.example', company: 'Acme Corp' },
  { name: 'Globex Industries', email: 'it@globex.example', company: 'Globex Industries' },
  { name: 'Initech', email: 'admin@initech.example', company: 'Initech' },
];

async function seed(databaseUrl) {
  const pool = getPool(databaseUrl);
  for (const client of SEED_CLIENTS) {
    await pool.query(
      `INSERT INTO clients (name, email, company)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [client.name, client.email, client.company],
    );
  }
}

async function main() {
  const config = loadConfig();
  try {
    await seed(config.databaseUrl);
    // eslint-disable-next-line no-console
    console.log(`seeded ${SEED_CLIENTS.length} clients`);
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed failed:', err);
    process.exit(1);
  });
}

module.exports = { seed, SEED_CLIENTS };
