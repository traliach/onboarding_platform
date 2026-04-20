'use strict';

const STEP_NAME = 'sendWelcomeEmail';
const STEP_ORDER = 3;

async function sendWelcomeEmail({ client, logger }) {
  logger.info({ msg: 'step.mock.ses.send', to: client.email });
  await new Promise((resolve) => setTimeout(resolve, 25));
  return {
    stepName: STEP_NAME,
    mockedMessageId: `ses-${Date.now()}-${client.id}`,
    recipient: client.email,
  };
}

module.exports = { sendWelcomeEmail, STEP_NAME, STEP_ORDER };
