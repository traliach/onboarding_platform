'use strict';

const request = require('supertest');
const { buildApp } = require('../../src/api');
const { fakeLogger } = require('../helpers/fakeLogger');

function pool(responses) {
  let i = 0;
  return {
    query: async () => {
      const r = responses[i] || { rows: [] };
      i += 1;
      return r;
    },
  };
}

describe('GET /jobs/:id', () => {
  test('400 on non-uuid', async () => {
    const { app } = buildApp({
      pool: pool([]),
      enqueueProvisioning: async () => ({ id: 'q' }),
      logger: fakeLogger(),
    });
    const res = await request(app).get('/jobs/nope');
    expect(res.status).toBe(400);
  });

  test('404 when missing', async () => {
    const { app } = buildApp({
      pool: pool([{ rows: [] }]),
      enqueueProvisioning: async () => ({ id: 'q' }),
      logger: fakeLogger(),
    });
    const res = await request(app).get('/jobs/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
  });

  test('returns job plus ordered steps', async () => {
    const jobRow = {
      id: '11111111-1111-1111-1111-111111111111',
      client_id: '22222222-2222-2222-2222-222222222222',
      queue_job_id: 'q-1',
      status: 'done',
      error: null,
      started_at: null,
      completed_at: null,
      created_at: null,
      updated_at: null,
    };
    const stepRows = [
      { id: 's1', step_name: 'createIamUser', step_order: 1, status: 'done' },
      { id: 's2', step_name: 'scaffoldS3Folder', step_order: 2, status: 'done' },
    ];
    const { app } = buildApp({
      pool: pool([{ rows: [jobRow] }, { rows: stepRows }]),
      enqueueProvisioning: async () => ({ id: 'q' }),
      logger: fakeLogger(),
    });
    const res = await request(app).get(`/jobs/${jobRow.id}`);
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe(jobRow.id);
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[0].step_order).toBe(1);
  });
});
