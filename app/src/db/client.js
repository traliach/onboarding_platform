'use strict';

const { Pool } = require('pg');

let pool = null;

function createPool(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('createPool requires a databaseUrl');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

function getPool(databaseUrl) {
  if (pool === null) {
    pool = createPool(databaseUrl);
  }
  return pool;
}

async function closePool() {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
}

async function query(databaseUrl, text, params) {
  return getPool(databaseUrl).query(text, params);
}

module.exports = {
  createPool,
  getPool,
  closePool,
  query,
};
