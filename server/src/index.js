'use strict';

/**
 * Entry-point dispatcher.
 * Selects API or worker process based on APP_TARGET.
 * The Docker image is single — section 5 mandates APP_TARGET selection.
 */

const target = (process.env.APP_TARGET || '').toLowerCase();

async function main() {
  if (target === 'api') {
    const { startServer } = require('./server');
    await startServer();
    return;
  }
  if (target === 'worker') {
    const { startWorker } = require('./worker');
    await startWorker();
    return;
  }
  // eslint-disable-next-line no-console
  console.error(
    `APP_TARGET must be 'api' or 'worker', received: ${JSON.stringify(process.env.APP_TARGET)}`,
  );
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error:', err);
  process.exit(1);
});
