'use strict';

const STEP_NAME = 'postSlackNotification';
const STEP_ORDER = 4;

async function postSlackNotification({ client, logger }) {
  const text = `New client provisioned: ${client.name} <${client.email}>`;
  logger.info({ msg: 'step.mock.slack.post', text });
  await new Promise((resolve) => setTimeout(resolve, 25));
  return {
    stepName: STEP_NAME,
    mockedChannel: '#onboarding',
    mockedText: text,
  };
}

module.exports = { postSlackNotification, STEP_NAME, STEP_ORDER };
