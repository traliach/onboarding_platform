'use strict';

const { createIamUser, STEP_NAME, STEP_ORDER } = require('../../src/worker/steps/createIamUser');
const { fakeLogger } = require('../helpers/fakeLogger');

describe('createIamUser step', () => {
  test('exports correct metadata', () => {
    expect(STEP_NAME).toBe('createIamUser');
    expect(STEP_ORDER).toBe(1);
  });

  test('returns a mocked IAM user ARN containing the client email', async () => {
    const logger = fakeLogger();
    const client = { id: 'c-1', name: 'Acme', email: 'ops@acme.example' };
    const result = await createIamUser({ client, logger });
    expect(result.stepName).toBe(STEP_NAME);
    expect(result.mockedUserArn).toContain(client.email);
    expect(logger.calls.info).toHaveLength(1);
  });
});
