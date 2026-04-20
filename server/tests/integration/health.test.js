'use strict';

const request = require('supertest');
const { buildApp } = require('../../src/api');
const { fakeLogger } = require('../helpers/fakeLogger');

describe('GET /health', () => {
  test('returns 200 and reports uptime', async () => {
    const { app } = buildApp({
      pool: { query: async () => ({ rows: [] }) },
      enqueueProvisioning: async () => ({ id: 'fake' }),
      logger: fakeLogger(),
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });
});

describe('GET /metrics', () => {
  test('returns prometheus text with default metrics', async () => {
    const { app } = buildApp({
      pool: { query: async () => ({ rows: [] }) },
      enqueueProvisioning: async () => ({ id: 'fake' }),
      logger: fakeLogger(),
    });
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('http_requests_total');
  });
});
