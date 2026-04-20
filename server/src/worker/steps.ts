/**
 * Provisioning step handlers — the 7 functions the worker dispatches on.
 *
 * Each handler is a pure async function of (ctx) → { log_message }. The
 * processor is responsible for DB state transitions (pending → in_progress
 * → done/failed); handlers only do the step's side effect and return the
 * client-facing log line.
 *
 * Side effects here are intentionally simulated: a short delay plus a
 * structured log line parameterised by the client's real data (name,
 * email, tier, id). The project's scope is the orchestration layer and
 * observability (build story Chapter 4), not AWS/Slack/SMTP integrations
 * themselves. Swapping in real SDK calls later is a per-handler edit; no
 * change to the processor or registry is required.
 *
 * Handlers MUST be idempotent when their side effect is real. The current
 * simulated steps are trivially idempotent because they mutate nothing.
 * When commit #n wires real integrations, each handler becomes
 * "create-if-not-exists" against its target system.
 *
 * Delays are tuned so the full pipeline for an enterprise client (7 steps)
 * takes ~3 seconds — long enough for the UI's 1-second poll to catch
 * intermediate states, short enough that dev testing is not painful.
 */

import type { ClientRow } from '../db/mappers';
import type { Logger } from '../logger';
import type { StepName } from '../../../client/src/types';

export interface StepContext {
  readonly client: ClientRow;
  readonly logger: Logger;
}

export interface StepResult {
  readonly log_message: string;
}

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Slug portion of the client id used to synthesise target-system
 * identifiers (IAM username, S3 prefix, Slack channel). First 8 hex chars
 * of the UUID gives collision-safe uniqueness for dev and a stable value
 * across re-runs of the same job.
 */
function clientSlug(client: ClientRow): string {
  return client.id.slice(0, 8);
}

async function createIamUser(ctx: StepContext): Promise<StepResult> {
  await sleep(400);
  const username = `onboarding-${clientSlug(ctx.client)}`;
  ctx.logger.info('step.createIamUser', {
    client_id: ctx.client.id,
    username,
  });
  return { log_message: `Created IAM user ${username}` };
}

async function scaffoldS3Folder(ctx: StepContext): Promise<StepResult> {
  await sleep(300);
  const prefix = `s3://onboarding/clients/${clientSlug(ctx.client)}/`;
  ctx.logger.info('step.scaffoldS3Folder', {
    client_id: ctx.client.id,
    prefix,
  });
  return { log_message: `Created storage folder at ${prefix}` };
}

async function addToMonitoring(ctx: StepContext): Promise<StepResult> {
  await sleep(200);
  ctx.logger.info('step.addToMonitoring', {
    client_id: ctx.client.id,
    tier: ctx.client.tier,
  });
  return { log_message: 'Added to Prometheus scrape targets' };
}

async function generateCredentialsPDF(ctx: StepContext): Promise<StepResult> {
  await sleep(600);
  const filename = `credentials-${clientSlug(ctx.client)}.pdf`;
  ctx.logger.info('step.generateCredentialsPDF', {
    client_id: ctx.client.id,
    filename,
  });
  return { log_message: `Generated ${filename}` };
}

async function sendWelcomeEmail(ctx: StepContext): Promise<StepResult> {
  await sleep(500);
  ctx.logger.info('step.sendWelcomeEmail', {
    client_id: ctx.client.id,
    to: ctx.client.email,
  });
  return { log_message: `Sent welcome email to ${ctx.client.email}` };
}

async function createSlackChannel(ctx: StepContext): Promise<StepResult> {
  await sleep(300);
  // Slack channel names are lowercase, alphanumeric + dashes, up to 80 chars.
  // Derive from company name so the channel is human-meaningful, not UUID-based.
  const channel = ctx.client.company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 21) || `client-${clientSlug(ctx.client)}`;
  ctx.logger.info('step.createSlackChannel', {
    client_id: ctx.client.id,
    channel,
  });
  return { log_message: `Created Slack channel #${channel}` };
}

async function postSlackNotification(ctx: StepContext): Promise<StepResult> {
  await sleep(200);
  ctx.logger.info('step.postSlackNotification', {
    client_id: ctx.client.id,
    company: ctx.client.company,
  });
  return {
    log_message: `Posted new-client announcement for ${ctx.client.company}`,
  };
}

/**
 * Registry: step_name → handler. Record<StepName, StepHandler> forces
 * compiler coverage — adding a new StepName to client/src/types breaks
 * compilation here until a handler is wired in.
 */
export const STEP_HANDLERS: Record<StepName, StepHandler> = {
  createIamUser,
  scaffoldS3Folder,
  addToMonitoring,
  generateCredentialsPDF,
  sendWelcomeEmail,
  createSlackChannel,
  postSlackNotification,
};
