'use strict';

const express = require('express');

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function clientsRouter({ pool, enqueueProvisioning, logger }) {
  const router = express.Router();

  router.post('/clients', async (req, res, next) => {
    try {
      const { name, email, company } = req.body || {};
      if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!isEmail(email)) {
        return res.status(400).json({ error: 'email is required and must be valid' });
      }

      const clientResult = await pool.query(
        `INSERT INTO clients (name, email, company)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, company, status, created_at, updated_at`,
        [name.trim(), email.trim().toLowerCase(), company || null],
      );
      const client = clientResult.rows[0];

      const jobResult = await pool.query(
        `INSERT INTO jobs (client_id) VALUES ($1)
         RETURNING id, client_id, status, created_at`,
        [client.id],
      );
      const job = jobResult.rows[0];

      const queueJob = await enqueueProvisioning({ jobId: job.id, clientId: client.id });
      if (queueJob && queueJob.id) {
        await pool.query(`UPDATE jobs SET queue_job_id = $1 WHERE id = $2`, [queueJob.id, job.id]);
      }

      logger.info({ msg: 'client.created', clientId: client.id, jobId: job.id });
      return res.status(201).json({ client, job });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'client with that email already exists' });
      }
      return next(err);
    }
  });

  router.get('/clients', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, email, company, status, created_at, updated_at
         FROM clients
         ORDER BY created_at DESC
         LIMIT 200`,
      );
      return res.json({ clients: rows });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/clients/:id', async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) {
        return res.status(400).json({ error: 'id must be a uuid' });
      }
      const { rows: clientRows } = await pool.query(
        `SELECT id, name, email, company, status, created_at, updated_at
         FROM clients WHERE id = $1`,
        [req.params.id],
      );
      if (clientRows.length === 0) {
        return res.status(404).json({ error: 'client not found' });
      }

      const { rows: jobRows } = await pool.query(
        `SELECT id, status, error, started_at, completed_at, created_at, updated_at
         FROM jobs WHERE client_id = $1 ORDER BY created_at DESC`,
        [req.params.id],
      );

      const jobIds = jobRows.map((job) => job.id);
      let stepRows = [];
      if (jobIds.length > 0) {
        const stepResult = await pool.query(
          `SELECT id, job_id, step_name, step_order, status, result, error,
                  started_at, completed_at, created_at, updated_at
           FROM job_steps WHERE job_id = ANY($1) ORDER BY step_order ASC`,
          [jobIds],
        );
        stepRows = stepResult.rows;
      }

      const jobs = jobRows.map((job) => ({
        ...job,
        steps: stepRows.filter((step) => step.job_id === job.id),
      }));

      return res.json({ client: clientRows[0], jobs });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/clients/:id', async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) {
        return res.status(400).json({ error: 'id must be a uuid' });
      }
      const allowed = ['name', 'email', 'company', 'status'];
      const fields = Object.keys(req.body || {}).filter((key) => allowed.includes(key));
      if (fields.length === 0) {
        return res.status(400).json({ error: `no updatable fields provided (${allowed.join(', ')})` });
      }

      const setClauses = fields.map((field, index) => `${field} = $${index + 1}`);
      const values = fields.map((field) => req.body[field]);
      values.push(req.params.id);

      const sql = `
        UPDATE clients
        SET ${setClauses.join(', ')}, updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING id, name, email, company, status, created_at, updated_at
      `;

      const { rows } = await pool.query(sql, values);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'client not found' });
      }
      return res.json({ client: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'email already in use' });
      }
      return next(err);
    }
  });

  return router;
}

module.exports = { clientsRouter, isEmail, isUuid };
