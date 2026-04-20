/**
 * Tier-based provisioning step registry (build story Chapter 4).
 *
 * Maps each tier to its ordered list of step names and holds the plain-English
 * label shown to the client on the portal. Consumed by:
 *   - POST /clients  — creates job_steps rows with status='pending' and the
 *                      correct plain_label the moment a client is onboarded,
 *                      so the portal progress bar is meaningful from zero.
 *   - the BullMQ worker (commit #16) — picks the next pending step, runs its
 *                      handler, and updates the row as it progresses.
 *
 * Adding a new step means: append to StepName in client/src/types, add an
 * entry to PLAIN_LABELS, and add the step_name to every tier that needs it.
 * The compiler enforces that PLAIN_LABELS covers every StepName via the
 * Record<StepName, string> type.
 */

import type { StepName, Tier } from '../../../client/src/types';

export interface StepDefinition {
  readonly step_name: StepName;
  readonly plain_label: string;
}

/**
 * Client-facing English labels. Never returned alongside step_name — §10
 * forbids leaking internal names to the portal. Labels are short phrases
 * that sit above a progress bar, not full sentences.
 */
const PLAIN_LABELS: Record<StepName, string> = {
  createIamUser: 'Create account credentials',
  scaffoldS3Folder: 'Set up storage',
  addToMonitoring: 'Enable monitoring',
  generateCredentialsPDF: 'Generate credentials document',
  sendWelcomeEmail: 'Send welcome email',
  createSlackChannel: 'Create Slack channel',
  postSlackNotification: 'Notify team',
};

/**
 * Tier → ordered step sequence. The order is the execution order; the worker
 * runs steps sequentially per job, not in parallel, so dependencies between
 * steps (e.g. createIamUser must precede generateCredentialsPDF) are encoded
 * here rather than in the worker.
 */
const STEPS_BY_TIER: Record<Tier, readonly StepName[]> = {
  basic: ['createIamUser', 'scaffoldS3Folder', 'sendWelcomeEmail'],
  professional: [
    'createIamUser',
    'scaffoldS3Folder',
    'addToMonitoring',
    'sendWelcomeEmail',
    'createSlackChannel',
    'postSlackNotification',
  ],
  enterprise: [
    'createIamUser',
    'scaffoldS3Folder',
    'addToMonitoring',
    'generateCredentialsPDF',
    'sendWelcomeEmail',
    'createSlackChannel',
    'postSlackNotification',
  ],
};

export function stepsForTier(tier: Tier): readonly StepDefinition[] {
  return STEPS_BY_TIER[tier].map((name) => ({
    step_name: name,
    plain_label: PLAIN_LABELS[name],
  }));
}
