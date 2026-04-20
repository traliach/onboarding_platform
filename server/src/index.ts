/**
 * Process entrypoint — selects API or worker based on APP_TARGET (section 6).
 *
 * Both entry points share this single file so systemd units and the Dockerfile
 * can reuse one build artefact and one image; the difference is a single env
 * variable. The Dockerfile's ENTRYPOINT resolves to `node dist/server/src/index.js`
 * with APP_TARGET wired by the host.
 *
 * At this stage the API exposes GET /health (ALB liveness, no dependencies)
 * and GET /health/ready (readiness, pings Postgres). The worker emits a
 * periodic heartbeat as a placeholder until the BullMQ consumer and the 7
 * provisioning steps land in later commits.
 *
 * Both processes eagerly ping the database at startup and exit non-zero on
 * failure. This matches the config-validation philosophy from section 6:
 * refuse to start if an upstream is misconfigured, rather than boot into a
 * broken state and fail on first request.
 *
 * The process treats every unrecoverable condition as fatal: invalid config,
 * uncaught exception, unhandled rejection, and failed DB pool close all
 * terminate with exit 1. The operating system is responsible for restarting
 * the process, not the process itself.
 */

import type { Server } from 'node:http';

import express, { type Request, type Response, type NextFunction } from 'express';

import { loadConfig, ConfigValidationError, type AppConfig } from './config';
import { createDb, type Db } from './db/pool';
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

function installCrashHandlers(logger: Logger, db: Db): void {
  const panicShutdown = (reason: string, detail: Record<string, unknown>): void => {
    logger.error(reason, detail);
    // Best-effort pool drain so the pg server sees disconnects rather than
    // half-open TCP sessions timing out. We intentionally do not await this
    // in the sync event handler — pg handles the forced close in its own
    // timeout budget.
    void db.close().finally(() => {
      process.exit(1);
    });
  };

  process.on('uncaughtException', (err: Error) => {
    panicShutdown('uncaught exception', {
      message: err.message,
      stack: err.stack,
    });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    panicShutdown('unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function startApi(config: AppConfig, db: Db, logger: Logger): void {
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

  app.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      await db.ping();
      res.status(200).json({ status: 'ready', target: config.appTarget });
    } catch (err: unknown) {
      logger.warn('readiness check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({ status: 'not_ready', target: config.appTarget });
    }
  });

  const server = app.listen(config.port, () => {
    logger.info('api listening', {
      port: config.port,
      node_env: config.nodeEnv,
      cors_origins: config.corsAllowedOrigins,
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutdown signal received', { signal });
    try {
      await closeServer(server);
    } catch (err: unknown) {
      logger.error('error during server close', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await db.close();
      logger.info('api stopped cleanly');
      process.exit(0);
    } catch (err: unknown) {
      logger.error('error closing db pool', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function startWorker(config: AppConfig, db: Db, logger: Logger): void {
  logger.info('worker starting', {
    queue: config.queueName,
    node_env: config.nodeEnv,
  });

  // Placeholder heartbeat until the BullMQ consumer + 7 provisioning steps
  // land. Kept here so operators can verify the worker process is alive via
  // log aggregation before the queue is wired up. The db pool is created at
  // boot even though no step handler uses it yet, so both targets exercise
  // the same bootstrap path.
  const heartbeatMs = 10_000;
  const handle = setInterval(() => {
    logger.info('worker heartbeat', { queue: config.queueName });
  }, heartbeatMs);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutdown signal received', { signal });
    clearInterval(handle);
    try {
      await db.close();
      logger.info('worker stopped cleanly');
      process.exit(0);
    } catch (err: unknown) {
      logger.error('error closing db pool', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function main(): Promise<void> {
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
  const db = createDb(config, logger);
  installCrashHandlers(logger, db);

  logger.info('process starting', {
    target: config.appTarget,
    node_env: config.nodeEnv,
    log_level: config.logLevel,
  });

  try {
    await db.ping();
    logger.info('db reachable');
  } catch (err: unknown) {
    logger.error('db unreachable at startup', {
      error: err instanceof Error ? err.message : String(err),
    });
    await db.close();
    process.exit(1);
  }

  if (config.appTarget === 'api') {
    startApi(config, db, logger);
  } else {
    startWorker(config, db, logger);
  }
}

void main();
