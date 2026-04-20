'use strict';

const {
  sendWelcomeEmail,
  STEP_NAME,
  STEP_ORDER,
} = require('../../src/worker/steps/sendWelcomeEmail');
const { fakeLogger } = require('../helpers/fakeLogger');

describe('sendWelcomeEmail step', () => {
  test('exports correct metadata', () => {
    expect(STEP_NAME).toBe('sendWelcomeEmail');
    expect(STEP_ORDER).toBe(3);
  });

  test('returns a mocked message id and recipient matches client email', async () => {
    const logger = fakeLogger();
    const client = { id: 'c-1', name: 'Acme', email: 'ops@acme.example' };
    const result = await sendWelcomeEmail({ client, logger });
    expect(result.recipient).toBe(client.email);
    expect(result.mockedMessageId).toMatch(/^ses-\d+-c-1$/);
  });
});
