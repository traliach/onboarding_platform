'use strict';

const {
  postSlackNotification,
  STEP_NAME,
  STEP_ORDER,
} = require('../../src/worker/steps/postSlackNotification');
const { fakeLogger } = require('../helpers/fakeLogger');

describe('postSlackNotification step', () => {
  test('exports correct metadata', () => {
    expect(STEP_NAME).toBe('postSlackNotification');
    expect(STEP_ORDER).toBe(4);
  });

  test('posts a message containing name and email', async () => {
    const logger = fakeLogger();
    const client = { id: 'c-1', name: 'Acme Corp', email: 'ops@acme.example' };
    const result = await postSlackNotification({ client, logger });
    expect(result.mockedChannel).toBe('#onboarding');
    expect(result.mockedText).toContain(client.name);
    expect(result.mockedText).toContain(client.email);
  });
});
