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

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';

import { createAnalyticsRouter } from './api/analytics';
import { createAuthRouter } from './api/auth';
import { createClientsRouter } from './api/clients';
import { createInviteRouter } from './api/invite';
import { createJobsRouter } from './api/jobs';
import { createPortalRouter } from './api/portal';
import { loadConfig, ConfigValidationError, type AppConfig } from './config';
import { register } from './metrics';
import { createDb, type Db } from './db/pool';
import { createRootLogger, type Logger } from './logger';
import {
  createQueue,
  createWorker,
  type JobQueue,
  type WorkerHandle,
} from './queue';
import { createJobProcessor } from './worker/processor';

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

/**
 * Stringify an unknown thrown value for structured logs. Some pg errors
 * arrive with an empty `.message` (connect-time failures mid-shutdown), so
 * fall back to the error name before giving up. Never returns an empty
 * string — log entries always carry a signal of what went wrong.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || 'unknown error';
  }
  if (typeof err === 'string') {
    return err;
  }
  return formatDetail(err);
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
      error: err.message,
      stack: err.stack,
    });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    panicShutdown('unhandled rejection', {
      reason: describeError(reason),
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

function startApi(
  config: AppConfig,
  db: Db,
  logger: Logger,
  queue: JobQueue,
): void {
  const app = express();
  app.disable('x-powered-by');

  // Request logger runs first so it sees every request, including CORS
  // preflight OPTIONS that cors() answers directly.
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

  // CORS: explicit origin list from config (no wildcard — validated at load
  // time). credentials:true lets the browser send the session cookie on
  // cross-origin requests from the Vite dev server / deployed Vercel host.
  app.use(
    cors({
      origin: config.corsAllowedOrigins as string[],
      credentials: true,
    }),
  );
  app.use(cookieParser());
  // 100kb is comfortably larger than any login/create-client body and small
  // enough to reject absurd payloads before they hit the router.
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', target: config.appTarget });
  });

  app.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      await db.ping();
      res.status(200).json({ status: 'ready', target: config.appTarget });
    } catch (err: unknown) {
      logger.warn('readiness check failed', { error: describeError(err) });
      res.status(503).json({ status: 'not_ready', target: config.appTarget });
    }
  });

  // Public — scraped by Prometheus on the same port as the API.
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use('/auth', createAuthRouter(config, db, logger));
  app.use('/auth', createInviteRouter(config, db, logger));
  app.use('/clients', createClientsRouter(config, db, logger, queue));
  app.use('/jobs', createJobsRouter(config, db, logger, queue));
  app.use('/portal', createPortalRouter(config, db, logger));
  app.use('/analytics', createAnalyticsRouter(config, db, logger));

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
      logger.error('error during server close', { error: describeError(err) });
    }
    try {
      await queue.close();
    } catch (err: unknown) {
      logger.error('error closing queue', { error: describeError(err) });
    }
    try {
      await db.close();
      logger.info('api stopped cleanly');
      process.exit(0);
    } catch (err: unknown) {
      logger.error('error closing db pool', { error: describeError(err) });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function startWorker(
  config: AppConfig,
  db: Db,
  logger: Logger,
  worker: WorkerHandle,
): void {
  logger.info('worker starting', {
    queue: config.queueName,
    node_env: config.nodeEnv,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutdown signal received', { signal });
    try {
      await worker.close();
    } catch (err: unknown) {
      logger.error('error closing worker', { error: describeError(err) });
    }
    try {
      await db.close();
      logger.info('worker stopped cleanly');
      process.exit(0);
    } catch (err: unknown) {
      logger.error('error closing db pool', { error: describeError(err) });
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
    logger.error('db unreachable at startup', { error: describeError(err) });
    await db.close();
    process.exit(1);
  }

  if (config.appTarget === 'api') {
    const queue = createQueue(config, logger);
    startApi(config, db, logger, queue);
  } else {
    const worker = createWorker(config, logger, createJobProcessor(db, logger));
    startWorker(config, db, logger, worker);
  }
}

void main();
