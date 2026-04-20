'use strict';

const request = require('supertest');
const { buildApp } = require('../../src/api');
const { fakeLogger } = require('../helpers/fakeLogger');

function fakePool(responses) {
  let call = 0;
  return {
    query: async () => {
      const response = responses[call] || { rows: [] };
      call += 1;
      return response;
    },
  };
}

describe('POST /clients', () => {
  test('rejects missing fields', async () => {
    const { app } = buildApp({
      pool: fakePool([]),
      enqueueProvisioning: async () => ({ id: 'q-1' }),
      logger: fakeLogger(),
    });
    const res = await request(app).post('/clients').send({});
    expect(res.status).toBe(400);
  });

  test('rejects invalid email', async () => {
    const { app } = buildApp({
      pool: fakePool([]),
      enqueueProvisioning: async () => ({ id: 'q-1' }),
      logger: fakeLogger(),
    });
    const res = await request(app)
      .post('/clients')
      .send({ name: 'Acme', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('creates client, enqueues job, and returns 201', async () => {
    const clientRow = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Acme',
      email: 'ops@acme.example',
      company: 'Acme',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const jobRow = {
      id: '22222222-2222-2222-2222-222222222222',
      client_id: clientRow.id,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    const pool = fakePool([
      { rows: [clientRow] }, // INSERT client
      { rows: [jobRow] },    // INSERT job
      { rows: [] },           // UPDATE queue_job_id
    ]);
    let enqueued = null;
    const { app } = buildApp({
      pool,
      enqueueProvisioning: async (payload) => {
        enqueued = payload;
        return { id: 'q-99' };
      },
      logger: fakeLogger(),
    });

    const res = await request(app)
      .post('/clients')
      .send({ name: 'Acme', email: 'ops@acme.example', company: 'Acme' });

    expect(res.status).toBe(201);
    expect(res.body.client.id).toBe(clientRow.id);
    expect(res.body.job.id).toBe(jobRow.id);
    expect(enqueued).toEqual({ jobId: jobRow.id, clientId: clientRow.id });
  });
});

describe('GET /clients/:id', () => {
  test('404 when not found', async () => {
    const { app } = buildApp({
      pool: fakePool([{ rows: [] }]),
      enqueueProvisioning: async () => ({ id: 'q' }),
      logger: fakeLogger(),
    });
    const res = await request(app).get('/clients/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
  });

  test('400 on non-uuid', async () => {
    const { app } = buildApp({
      pool: fakePool([]),
      enqueueProvisioning: async () => ({ id: 'q' }),
      logger: fakeLogger(),
    });
    const res = await request(app).get('/clients/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
