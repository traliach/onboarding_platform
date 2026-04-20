/**
 * In-memory fake of the `Db` interface — for integration tests that exercise
 * Express routes without standing up PostgreSQL.
 *
 * Scope: routes under test today (auth) talk to one table: `users`. Rather
 * than half-port the whole schema into a fake, we match SQL fragments by
 * pattern — each route makes two very specific queries (login lookup by
 * email, middleware re-fetch by id), and a fake-db hit that does not match
 * any registered pattern throws loudly so the test author is forced to
 * acknowledge any new query a route adds.
 *
 * NOT a general-purpose ORM. When clients/jobs integration tests are added,
 * extend the dispatcher with new `when()` branches rather than introducing
 * query builders or joins here. The moment this file grows past ~200 lines
 * the right answer is a real test DB with transactions-per-test.
 */

import type { QueryResult, QueryResultRow } from 'pg';

import type { Db } from '../../src/db/pool.js';

export interface FakeUserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

function emptyResult<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

/**
 * Build a minimal Db whose only backing store is an array of users.
 *
 * The returned Db supports exactly the queries the auth router and
 * requireAuth middleware issue. Any other query throws a descriptive
 * error naming the SQL text — this is intentional, so silent test drift
 * becomes loud test failure.
 */
export function createFakeDb(users: FakeUserRow[]): Db {
  return {
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      const normalised = text.replace(/\s+/g, ' ').trim();

      if (/FROM users\s+WHERE email = \$1/i.test(normalised)) {
        const email = params?.[0] as string | undefined;
        const hit = users.find((u) => u.email === email);
        return Promise.resolve(emptyResult((hit ? [hit] : []) as unknown as R[]));
      }

      if (/FROM users\s+WHERE id = \$1/i.test(normalised)) {
        const id = params?.[0] as string | undefined;
        const hit = users.find((u) => u.id === id);
        return Promise.resolve(emptyResult((hit ? [hit] : []) as unknown as R[]));
      }

      return Promise.reject(new Error(`fakeDb: unhandled query: ${normalised}`));
    },

    withTransaction() {
      return Promise.reject(
        new Error('fakeDb: withTransaction is not supported in unit tests'),
      );
    },

    ping() {
      return Promise.resolve();
    },

    close() {
      return Promise.resolve();
    },
  };
}
