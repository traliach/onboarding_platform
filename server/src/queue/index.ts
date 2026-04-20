/**
 * BullMQ queue wiring — shared by the API (producer) and the worker (consumer).
 *
 * Two factories so each process owns only what it needs:
 *
 *   createQueue(config, logger) — API-side producer. Exposes enqueueJob(jobId).
 *                                 Never constructs a Worker, so the API never
 *                                 accidentally processes jobs.
 *
 *   createWorker(config, logger, processor) — worker-side consumer. Constructs
 *                                 a BullMQ Worker with concurrency:1 so step
 *                                 ordering inside a job is preserved and the
 *                                 single-process t2.micro target is not pushed
 *                                 into swap by parallel jobs.
 *
 * Both factories own their own ioredis connection and shut it down in close().
 * maxRetriesPerRequest:null is mandatory — BullMQ's blocking BRPOPLPUSH will
 * never return if ioredis is still retrying internally, and the worker will
 * silently stall. The check here is a belt-and-braces; BullMQ would throw at
 * construction time, but the error is cryptic ("Error: options.connection.%...").
 *
 * attempts:1 on enqueue matches §10 — retry is an explicit admin action via
 * PATCH /jobs/:id/steps/:stepId/retry, never automatic. removeOnComplete and
 * removeOnFail bound Redis memory: BullMQ otherwise keeps every terminal job
 * forever, which is fine on dev but unacceptable on the t2.micro worker.
 */

import { Queue, Worker, type Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';

import type { AppConfig } from '../config';
import type { Logger } from '../logger';

export interface JobPayload {
  readonly jobId: string;
}

export type JobProcessor = (job: BullJob<JobPayload>) => Promise<void>;

export interface JobQueue {
  enqueueJob(jobId: string): Promise<void>;
  close(): Promise<void>;
}

export interface WorkerHandle {
  close(): Promise<void>;
}

const RETAIN_LAST_N = 100;

export function createQueue(
  config: Pick<AppConfig, 'redisUrl' | 'queueName'>,
  logger: Logger,
): JobQueue {
  const connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
  connection.on('error', (err: Error) => {
    logger.error('queue redis error', { error: err.message, code: (err as NodeJS.ErrnoException).code });
  });

  const queue = new Queue<JobPayload>(config.queueName, { connection });
  queue.on('error', (err: Error) => {
    logger.error('queue error', { error: err.message });
  });

  return {
    async enqueueJob(jobId: string): Promise<void> {
      await queue.add(
        'provision',
        { jobId },
        {
          attempts: 1,
          removeOnComplete: { count: RETAIN_LAST_N },
          removeOnFail: { count: RETAIN_LAST_N },
        },
      );
      logger.info('job enqueued', { job_id: jobId, queue: config.queueName });
    },
    async close(): Promise<void> {
      await queue.close();
      await connection.quit();
    },
  };
}

export function createWorker(
  config: Pick<AppConfig, 'redisUrl' | 'queueName'>,
  logger: Logger,
  processor: JobProcessor,
): WorkerHandle {
  const connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
  connection.on('error', (err: Error) => {
    logger.error('worker redis error', { error: err.message, code: (err as NodeJS.ErrnoException).code });
  });

  const worker = new Worker<JobPayload>(config.queueName, processor, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', (bullJob: BullJob<JobPayload>) => {
    logger.info('queue job completed', {
      bull_id: bullJob.id,
      job_id: bullJob.data.jobId,
    });
  });
  worker.on('failed', (bullJob: BullJob<JobPayload> | undefined, err: Error) => {
    logger.error('queue job failed', {
      bull_id: bullJob?.id,
      job_id: bullJob?.data.jobId,
      error: err.message,
    });
  });
  worker.on('error', (err: Error) => {
    logger.error('worker error', { error: err.message });
  });

  logger.info('worker listening', {
    queue: config.queueName,
    concurrency: 1,
  });

  return {
    async close(): Promise<void> {
      await worker.close();
      await connection.quit();
    },
  };
}
