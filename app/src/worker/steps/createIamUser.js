'use strict';

const STEP_NAME = 'createIamUser';
const STEP_ORDER = 1;

async function createIamUser({ client, logger }) {
  logger.info({ msg: 'step.mock.iam_user.create', email: client.email });
  await new Promise((resolve) => setTimeout(resolve, 25));
  return {
    stepName: STEP_NAME,
    mockedUserArn: `arn:aws:iam::000000000000:user/${client.email}`,
  };
}

module.exports = { createIamUser, STEP_NAME, STEP_ORDER };
