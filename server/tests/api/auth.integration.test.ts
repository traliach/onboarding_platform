/**
 * HTTP-level integration tests for the /auth router.
 *
 * Scope:
 *   - Real Express app (router, express.json, cookie-parser middleware).
 *   - Real JWT + bcrypt: tokens are actually signed and verified, passwords
 *     are actually hashed and compared. Nothing about auth is stubbed.
 *   - Fake Db (tests/helpers/fakeDb) — the users table is the only thing
 *     /auth and requireAuth touch, so spinning up Postgres would be overkill.
 *
 * Supertest drives the HTTP round trip so we exercise the full middleware
 * chain (cookieParser → JSON body parser → router → requireAuth) the same
 * way a browser would, including cookie jar semantics.
 */

import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';

import { createAuthRouter } from '../../src/api/auth';
import { hashPassword } from '../../src/auth/passwords';
import type { AppConfig } from '../../src/config/index.js';
import { makeTestConfig } from '../helpers/config';
import { createFakeDb, type FakeUserRow } from '../helpers/fakeDb';
import { silentLogger } from '../helpers/logger';

const SEED_PASSWORD = 'changeme-dev-only';
const SEED_EMAIL = 'admin@onboarding.local';

async function buildApp(config: AppConfig) {
  const seedHash = await hashPassword(SEED_PASSWORD, config);
  const users: FakeUserRow[] = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      email: SEED_EMAIL,
      password_hash: seedHash,
      created_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const db = createFakeDb(users);
  const logger = silentLogger();

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/auth', createAuthRouter(config, db, logger));

  return { app, users };
}

describe('POST /auth/login', () => {
  const config = makeTestConfig();

  it('returns 200 with the user body and sets a session cookie', async () => {
    const { app } = await buildApp(config);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: '00000000-0000-0000-0000-000000000001',
      email: SEED_EMAIL,
    });

    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(Array.isArray(setCookie)).toBe(true);
    const session = setCookie!.find((c) => c.startsWith('session='));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Strict/i);
    // secure is only set in production; our test config uses nodeEnv=test.
    expect(session).not.toMatch(/Secure/i);
  });

  it('accepts email in mixed case (normalises to lowercase on lookup)', async () => {
    const { app } = await buildApp(config);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: SEED_EMAIL.toUpperCase(), password: SEED_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('returns 401 for a wrong password (no cookie set)', async () => {
    const { app } = await buildApp(config);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: SEED_EMAIL, password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid credentials' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 401 for an unknown email (no enumeration signal)', async () => {
    const { app } = await buildApp(config);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@onboarding.local', password: 'anything' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid credentials' });
  });

  it('returns 400 when the body is missing the password', async () => {
    const { app } = await buildApp(config);
    const res = await request(app).post('/auth/login').send({ email: SEED_EMAIL });
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  const config = makeTestConfig();

  it('returns 401 without a session cookie', async () => {
    const { app } = await buildApp(config);
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 for a garbage session cookie', async () => {
    const { app } = await buildApp(config);
    const res = await request(app).get('/auth/me').set('Cookie', 'session=not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('returns 200 and the user when the session cookie is valid', async () => {
    const { app } = await buildApp(config);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    const setCookie = login.headers['set-cookie'] as unknown as string[];
    const sessionCookie = setCookie
      .find((c) => c.startsWith('session='))!
      .split(';')[0];

    const me = await request(app).get('/auth/me').set('Cookie', sessionCookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(SEED_EMAIL);
  });
});

describe('POST /auth/logout', () => {
  const config = makeTestConfig();

  it('clears the session cookie and returns 204', async () => {
    const { app } = await buildApp(config);
    const res = await request(app).post('/auth/logout');

    expect(res.status).toBe(204);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const session = setCookie.find((c) => c.startsWith('session='));
    expect(session).toBeDefined();
    // clearCookie sets an expired date — the browser drops it.
    expect(session).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});
