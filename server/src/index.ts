/**
 * Process entrypoint — selects API or worker based on APP_TARGET (section 6).
 *
 * Both entry points share this single file so systemd units and the Dockerfile
 * can reuse one build artefact and one image; the difference is a single env
 * variable. The Dockerfile's ENTRYPOINT resolves to `node dist/server/src/index.js`
 * with APP_TARGET wired by the host.
 *
 * At this stage the API exposes only GET /health (required for the ALB target
 * group) and the worker emits a periodic heartbeat as a placeholder until the
 * BullMQ consumer and the 7 provisioning steps land in later commits. Routes,
 * JWT middleware, database, and queue wiring are intentionally absent here.
 *
 * The process treats every unrecoverable condition as fatal: invalid config,
 * uncaught exception, and unhandled rejection all terminate with exit 1. The
 * operating system is responsible for restarting the process, not the process
 * itself.
 */

import express, { type Request, type Response, type NextFunction } from 'express';

import { loadConfig, ConfigValidationError, type AppConfig } from './config';
import { createRootLogger, type Logger } from './logger';

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.message;
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (typeof detail === 'number' || typeof detail === 'boolean') {
    return String(detail);
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return '[unserialisable detail]';
  }
}

function failBeforeLogger(message: string, detail?: unknown): never {
  process.stderr.write(`FATAL: ${message}\n`);
  if (detail !== undefined) {
    process.stderr.write(`${formatDetail(detail)}\n`);
  }
  process.exit(1);
}

function installCrashHandlers(logger: Logger): void {
  process.on('uncaughtException', (err: Error) => {
    logger.error('uncaught exception', {
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    process.exit(1);
  });
}

function startApi(config: AppConfig, logger: Logger): void {
  const app = express();
  app.disable('x-powered-by');

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.http('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Date.now() - start,
      });
    });
    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', target: config.appTarget });
  });

  const server = app.listen(config.port, () => {
    logger.info('api listening', {
      port: config.port,
      node_env: config.nodeEnv,
      cors_origins: config.corsAllowedOrigins,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutdown signal received', { signal });
    server.close((err) => {
      if (err) {
        logger.error('error during server close', { error: err.message });
        process.exit(1);
      }
      logger.info('api stopped cleanly');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function startWorker(config: AppConfig, logger: Logger): void {
  logger.info('worker starting', {
    queue: config.queueName,
    node_env: config.nodeEnv,
  });

  // Placeholder heartbeat until the BullMQ consumer + 7 provisioning steps
  // land. Kept here so operators can verify the worker process is alive via
  // log aggregation before the queue is wired up.
  const heartbeatMs = 10_000;
  const handle = setInterval(() => {
    logger.info('worker heartbeat', { queue: config.queueName });
  }, heartbeatMs);

  const shutdown = (signal: string): void => {
    logger.info('shutdown signal received', { signal });
    clearInterval(handle);
    logger.info('worker stopped cleanly');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function main(): void {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      failBeforeLogger('invalid configuration', err.message);
    }
    failBeforeLogger('unexpected error loading configuration', err);
  }

  const logger = createRootLogger(config);
  installCrashHandlers(logger);

  logger.info('process starting', {
    target: config.appTarget,
    node_env: config.nodeEnv,
    log_level: config.logLevel,
  });

  if (config.appTarget === 'api') {
    startApi(config, logger);
  } else {
    startWorker(config, logger);
  }
}

main();
