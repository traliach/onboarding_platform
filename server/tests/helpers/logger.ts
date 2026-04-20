/**
 * Silent Winston logger for tests.
 *
 * The production root logger is already silenced when NODE_ENV=test, but
 * unit tests that exercise helpers directly construct their own logger so
 * they can run in isolation without pulling AppConfig. We return a fully
 * wired Winston instance (not a mock) so the real `logger.info(..., meta)`
 * signatures compile and any accidental `logger.thisMethodDoesNotExist()`
 * would fail to type-check.
 */

import { createLogger, format, transports, type Logger } from 'winston';

export function silentLogger(): Logger {
  return createLogger({
    level: 'error',
    format: format.json(),
    transports: [new transports.Console()],
    silent: true,
  });
}
