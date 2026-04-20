'use strict';

const STEP_NAME = 'scaffoldS3Folder';
const STEP_ORDER = 2;

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function scaffoldS3Folder({ client, logger }) {
  const prefix = `clients/${slugify(client.company || client.name || client.id)}/`;
  logger.info({ msg: 'step.mock.s3.scaffold', prefix });
  await new Promise((resolve) => setTimeout(resolve, 25));
  return {
    stepName: STEP_NAME,
    mockedBucket: 'onboarding-platform-clients',
    mockedPrefix: prefix,
  };
}

module.exports = { scaffoldS3Folder, STEP_NAME, STEP_ORDER, slugify };
