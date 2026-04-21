/**
 * HTTP-level integration tests for the /auth invite + register routes.
 *
 * Scope:
 *   - Real Express app with the auth and invite routers.
 *   - Real bcrypt + JWT — no auth stubs.
 *   - In-memory fake Db — no Postgres process needed.
 *
 * The fake Db dispatches on SQL fragments. Any query the router issues that
 * is not handled throws loudly so test drift is visible immediately.
 */

import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';

import { createAuthRouter } from '../../src/api/auth';
import { createInviteRouter } from '../../src/api/invite';
import { hashPassword } from '../../src/auth/passwords';
import { signToken } from '../../src/auth/tokens';
import type { AppConfig } from '../../src/config';
import type { Db } from '../../src/db/pool';
import { makeTestConfig } from '../helpers/config';
import { silentLogger } from '../helpers/logger';

import type { QueryResult, QueryResultRow, PoolClient } from 'pg';

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_EMAIL = 'admin@onboarding.local';
const INVITE_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const INVITE_EMAIL = 'newuser@onboarding.local';

function emptyResult<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
}

interface UserRow { id: string; email: string; password_hash?: string; created_at: Date }
interface InviteRow {
  id: string; token: string; email: string; used: boolean;
  expires_at: Date; created_by: string; created_at: Date;
}

function buildFakeDb(opts: {
  users?: UserRow[];
  invites?: InviteRow[];
  insertedUsers?: UserRow[];
  insertedInvites?: InviteRow[];
}): Db {
  const users = opts.users ?? [];
  const invites = opts.invites ?? [];
  const insertedUsers: UserRow[] = opts.insertedUsers ?? [];
  const insertedInvites: InviteRow[] = opts.insertedInvites ?? [];

  const allUsers = () => [...users, ...insertedUsers];
  const allInvites = () => [...invites, ...insertedInvites];

  function dispatch<R extends QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    const q = text.replace(/\s+/g, ' ').trim();

    if (/FROM users\s+WHERE email = \$1/i.test(q)) {
      const email = params?.[0] as string;
      const hit = allUsers().find((u) => u.email === email);
      return Promise.resolve(emptyResult((hit ? [hit] : []) as unknown as R[]));
    }

    if (/FROM users\s+WHERE id = \$1/i.test(q)) {
      const id = params?.[0] as string;
      const hit = allUsers().find((u) => u.id === id);
      return Promise.resolve(emptyResult((hit ? [hit] : []) as unknown as R[]));
    }

    if (/INSERT INTO invite_tokens/i.test(q) && /RETURNING/i.test(q)) {
      const email = params?.[0] as string;
      const newRow: InviteRow = {
        id: 'new-invite-id',
        token: INVITE_TOKEN,
        email,
        used: false,
        expires_at: new Date(Date.now() + 86400_000),
        created_by: params?.[1] as string,
        created_at: new Date(),
      };
      insertedInvites.push(newRow);
      return Promise.resolve(emptyResult([newRow] as unknown as R[]));
    }

    if (/FROM invite_tokens/i.test(q) && /WHERE token = \$1/i.test(q)) {
      const token = params?.[0] as string;
      const hit = allInvites().find(
        (i) => i.token === token && !i.used && i.expires_at > new Date(),
      );
      return Promise.resolve(emptyResult((hit ? [hit] : []) as unknown as R[]));
    }

    if (/INSERT INTO users/i.test(q) && /RETURNING/i.test(q)) {
      const email = params?.[0] as string;
      const newUser: UserRow = {
        id: 'new-user-id',
        email,
        created_at: new Date(),
      };
      insertedUsers.push(newUser);
      return Promise.resolve(emptyResult([newUser] as unknown as R[]));
    }

    if (/UPDATE invite_tokens SET used = true/i.test(q)) {
      const id = params?.[0] as string;
      const invite = allInvites().find((i) => i.id === id);
      if (invite) invite.used = true;
      return Promise.resolve(emptyResult([] as unknown as R[]));
    }

    return Promise.reject(new Error(`fakeDb: unhandled query: ${q}`));
  }

  return {
    query: dispatch,

    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const fakeClient = {
        query: <R extends QueryResultRow>(text: string, params?: readonly unknown[]) =>
          dispatch<R>(text, params),
      } as unknown as PoolClient;
      return fn(fakeClient);
    },

    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

async function buildApp(config: AppConfig, db: Db) {
  const logger = silentLogger();
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/auth', createAuthRouter(config, db, logger));
  app.use('/auth', createInviteRouter(config, db, logger));
  return app;
}

function makeAdminCookie(config: AppConfig): string {
  const token = signToken({ sub: ADMIN_ID, email: ADMIN_EMAIL }, config);
  return `session=${token}`;
}

describe('POST /auth/invite', () => {
  const config = makeTestConfig();

  it('returns 201 with token + email on valid invite', async () => {
    const adminHash = await hashPassword('password123', config);
    const db = buildFakeDb({
      users: [{ id: ADMIN_ID, email: ADMIN_EMAIL, password_hash: adminHash, created_at: new Date() }],
    });
    const app = await buildApp(config, db);
    const cookie = makeAdminCookie(config);

    const res = await request(app)
      .post('/auth/invite')
      .set('Cookie', cookie)
      .send({ email: INVITE_EMAIL });

    expect(res.status).toBe(201);
    const body = res.body as { token: string; email: string; expires_at: string };
    expect(body.email).toBe(INVITE_EMAIL);
    expect(typeof body.token).toBe('string');
    expect(typeof body.expires_at).toBe('string');
  });

  it('returns 401 without JWT cookie', async () => {
    const db = buildFakeDb({});
    const app = await buildApp(config, db);

    const res = await request(app)
      .post('/auth/invite')
      .send({ email: INVITE_EMAIL });

    expect(res.status).toBe(401);
  });

  it('returns 400 when email is missing', async () => {
    const adminHash = await hashPassword('password123', config);
    const db = buildFakeDb({
      users: [{ id: ADMIN_ID, email: ADMIN_EMAIL, password_hash: adminHash, created_at: new Date() }],
    });
    const app = await buildApp(config, db);
    const cookie = makeAdminCookie(config);

    const res = await request(app)
      .post('/auth/invite')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 409 when email already registered', async () => {
    const adminHash = await hashPassword('password123', config);
    const db = buildFakeDb({
      users: [
        { id: ADMIN_ID, email: ADMIN_EMAIL, password_hash: adminHash, created_at: new Date() },
        { id: 'existing-id', email: INVITE_EMAIL, created_at: new Date() },
      ],
    });
    const app = await buildApp(config, db);
    const cookie = makeAdminCookie(config);

    const res = await request(app)
      .post('/auth/invite')
      .set('Cookie', cookie)
      .send({ email: INVITE_EMAIL });

    expect(res.status).toBe(409);
  });
});

describe('GET /auth/invite/:token', () => {
  const config = makeTestConfig();

  it('returns 200 with email and valid:true for a valid token', async () => {
    const db = buildFakeDb({
      invites: [{
        id: 'inv-1', token: INVITE_TOKEN, email: INVITE_EMAIL,
        used: false, expires_at: new Date(Date.now() + 86400_000),
        created_by: ADMIN_ID, created_at: new Date(),
      }],
    });
    const app = await buildApp(config, db);

    const res = await request(app).get(`/auth/invite/${INVITE_TOKEN}`);

    expect(res.status).toBe(200);
    const body = res.body as { email: string; valid: boolean };
    expect(body.email).toBe(INVITE_EMAIL);
    expect(body.valid).toBe(true);
  });

  it('returns 404 for an unknown token', async () => {
    const db = buildFakeDb({});
    const app = await buildApp(config, db);

    const res = await request(app).get('/auth/invite/nonexistent-token');

    expect(res.status).toBe(404);
  });

  it('returns 404 for an already-used token', async () => {
    const db = buildFakeDb({
      invites: [{
        id: 'inv-1', token: INVITE_TOKEN, email: INVITE_EMAIL,
        used: true, expires_at: new Date(Date.now() + 86400_000),
        created_by: ADMIN_ID, created_at: new Date(),
      }],
    });
    const app = await buildApp(config, db);

    const res = await request(app).get(`/auth/invite/${INVITE_TOKEN}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /auth/register/:token', () => {
  const config = makeTestConfig();

  it('returns 201 and creates the user on valid registration', async () => {
    const db = buildFakeDb({
      invites: [{
        id: 'inv-1', token: INVITE_TOKEN, email: INVITE_EMAIL,
        used: false, expires_at: new Date(Date.now() + 86400_000),
        created_by: ADMIN_ID, created_at: new Date(),
      }],
    });
    const app = await buildApp(config, db);

    const res = await request(app)
      .post(`/auth/register/${INVITE_TOKEN}`)
      .send({ password: 'supersecurepassword123' });

    expect(res.status).toBe(201);
    const body = res.body as { user: { email: string } };
    expect(body.user.email).toBe(INVITE_EMAIL);
  });

  it('returns 400 when password is too short', async () => {
    const db = buildFakeDb({
      invites: [{
        id: 'inv-1', token: INVITE_TOKEN, email: INVITE_EMAIL,
        used: false, expires_at: new Date(Date.now() + 86400_000),
        created_by: ADMIN_ID, created_at: new Date(),
      }],
    });
    const app = await buildApp(config, db);

    const res = await request(app)
      .post(`/auth/register/${INVITE_TOKEN}`)
      .send({ password: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const db = buildFakeDb({});
    const app = await buildApp(config, db);

    const res = await request(app)
      .post(`/auth/register/${INVITE_TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for an invalid token', async () => {
    const db = buildFakeDb({});
    const app = await buildApp(config, db);

    const res = await request(app)
      .post('/auth/register/bad-token')
      .send({ password: 'supersecurepassword123' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when email is already registered', async () => {
    const db = buildFakeDb({
      users: [{ id: 'existing-id', email: INVITE_EMAIL, created_at: new Date() }],
      invites: [{
        id: 'inv-1', token: INVITE_TOKEN, email: INVITE_EMAIL,
        used: false, expires_at: new Date(Date.now() + 86400_000),
        created_by: ADMIN_ID, created_at: new Date(),
      }],
    });
    const app = await buildApp(config, db);

    const res = await request(app)
      .post(`/auth/register/${INVITE_TOKEN}`)
      .send({ password: 'supersecurepassword123' });

    expect(res.status).toBe(409);
  });
});
