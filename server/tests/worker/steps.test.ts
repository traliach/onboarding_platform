/**
 * Per-handler unit tests for the 7 provisioning steps.
 *
 * Two guarantees each test pins:
 *   1. The handler returns a `log_message` that matches the client-facing
 *      shape the portal shows. Future refactors that change the wording
 *      should be intentional — these regexes will flag them.
 *   2. The handler resolves. Jest's fake-timers flush the built-in sleeps
 *      so the whole file runs in milliseconds instead of the ~2.5s of
 *      real time the handlers simulate in production.
 */

import { STEP_HANDLERS } from '../../src/worker/steps';
import type { ClientRow } from '../../src/db/mappers';
import type { StepName } from '../../../client/src/types';
import { silentLogger } from '../helpers/logger';

function fixtureClient(overrides: Partial<ClientRow> = {}): ClientRow {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: '4f85e201-1111-2222-3333-444444444444',
    name: 'Jane Test',
    company: 'Acme Widgets Inc',
    email: 'jane@acme.test',
    phone: null,
    tier: 'enterprise',
    status: 'pending',
    portal_token: '00000000-0000-0000-0000-000000000001',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/**
 * Helper: run a handler under fake timers so the built-in sleep() resolves
 * immediately. `advanceTimersByTimeAsync` both advances pending timers and
 * drains the microtask queue — the combination the real `await sleep()`
 * is waiting on.
 */
async function runHandler(
  stepName: StepName,
  client: ClientRow = fixtureClient(),
): Promise<string> {
  jest.useFakeTimers();
  try {
    const handler = STEP_HANDLERS[stepName];
    const promise = handler({ client, logger: silentLogger() });
    await jest.advanceTimersByTimeAsync(10_000);
    const { log_message } = await promise;
    return log_message;
  } finally {
    jest.useRealTimers();
  }
}

describe('provisioning step handlers', () => {
  it('createIamUser: log names the synthesised IAM username', async () => {
    const msg = await runHandler('createIamUser');
    expect(msg).toMatch(/^Created IAM user onboarding-4f85e201$/);
  });

  it('scaffoldS3Folder: log includes the derived S3 prefix', async () => {
    const msg = await runHandler('scaffoldS3Folder');
    expect(msg).toBe('Created storage folder at s3://onboarding/clients/4f85e201/');
  });

  it('addToMonitoring: log mentions Prometheus scrape targets', async () => {
    const msg = await runHandler('addToMonitoring');
    expect(msg).toMatch(/Prometheus/);
  });

  it('generateCredentialsPDF: log names the client-slugged PDF filename', async () => {
    const msg = await runHandler('generateCredentialsPDF');
    expect(msg).toBe('Generated credentials-4f85e201.pdf');
  });

  it('sendWelcomeEmail: log echoes the client email address', async () => {
    const msg = await runHandler('sendWelcomeEmail');
    expect(msg).toBe('Sent welcome email to jane@acme.test');
  });

  it('createSlackChannel: slugifies the company name to a valid channel', async () => {
    const msg = await runHandler('createSlackChannel');
    // Channel must be lowercase, hyphen-separated, prefixed with #.
    expect(msg).toMatch(/^Created Slack channel #[a-z0-9-]+$/);
    expect(msg).toContain('acme-widgets-inc');
  });

  it('createSlackChannel: falls back to client-<slug> when the company has no slug-safe chars', async () => {
    const client = fixtureClient({ company: '!!!' });
    const msg = await runHandler('createSlackChannel', client);
    expect(msg).toBe('Created Slack channel #client-4f85e201');
  });

  it('postSlackNotification: log includes the company name verbatim', async () => {
    const msg = await runHandler('postSlackNotification');
    expect(msg).toBe('Posted new-client announcement for Acme Widgets Inc');
  });
});
