/**
 * Winston root logger — the only logging path in the server.
 *
 * Rules (section 6 + section 14):
 *   - Never call console.log / console.info / console.debug in finished code.
 *     The ESLint rule enforces this at CI time.
 *   - All logs are structured JSON on stdout so Prometheus / Grafana / any
 *     log aggregator can index them without a parser.
 *   - Silenced when NODE_ENV=test so Jest output stays readable.
 *   - Log level comes from config — never a hardcoded default.
 */

import { createLogger, format, transports, type Logger } from 'winston';

import type { AppConfig } from './config';

export { type Logger } from 'winston';

export function createRootLogger(config: AppConfig): Logger {
  return createLogger({
    level: config.logLevel,
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.splat(),
      format.json(),
    ),
    defaultMeta: {
      service: 'onboarding-platform',
      target: config.appTarget,
      env: config.nodeEnv,
    },
    transports: [new transports.Console()],
    silent: config.nodeEnv === 'test',
  });
}
