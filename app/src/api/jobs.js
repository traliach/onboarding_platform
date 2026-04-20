'use strict';

const express = require('express');
const { isUuid } = require('./clients');

function jobsRouter({ pool }) {
  const router = express.Router();

  router.get('/jobs/:id', async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) {
        return res.status(400).json({ error: 'id must be a uuid' });
      }
      const jobResult = await pool.query(
        `SELECT id, client_id, queue_job_id, status, error,
                started_at, completed_at, created_at, updated_at
         FROM jobs WHERE id = $1`,
        [req.params.id],
      );
      if (jobResult.rows.length === 0) {
        return res.status(404).json({ error: 'job not found' });
      }
      const stepsResult = await pool.query(
        `SELECT id, step_name, step_order, status, result, error,
                started_at, completed_at, created_at, updated_at
         FROM job_steps WHERE job_id = $1 ORDER BY step_order ASC`,
        [req.params.id],
      );
      return res.json({ job: jobResult.rows[0], steps: stepsResult.rows });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { jobsRouter };
