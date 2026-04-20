/**
 * Client-side mirror of the server's step registry.
 *
 * The authoritative source is `server/src/workflow/registry.ts`. Keeping a
 * mirror here (rather than fetching a `GET /workflow` endpoint) lets the
 * "new client" modal render an instant step preview on tier change, with
 * no network round-trip between selecting "Basic" and seeing the three
 * steps it will run.
 *
 * If this drifts from the server the worst case is a cosmetic mismatch in
 * the preview — the POST /clients call still creates the real steps via
 * the server registry, so functionality is unaffected. Treat this file as
 * a product-spec document, not a runtime dependency. Update it in the
 * same PR that updates the server registry.
 */

import type { StepName, Tier } from '../types';

export interface StepPreview {
  readonly step_name: StepName;
  readonly plain_label: string;
}

const PLAIN_LABELS: Record<StepName, string> = {
  createIamUser: 'Create account credentials',
  scaffoldS3Folder: 'Set up storage',
  addToMonitoring: 'Enable monitoring',
  generateCredentialsPDF: 'Generate credentials document',
  sendWelcomeEmail: 'Send welcome email',
  createSlackChannel: 'Create Slack channel',
  postSlackNotification: 'Notify team',
};

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

export function stepsForTier(tier: Tier): readonly StepPreview[] {
  return STEPS_BY_TIER[tier].map((name) => ({
    step_name: name,
    plain_label: PLAIN_LABELS[name],
  }));
}

export const TIER_LABELS: Record<Tier, string> = {
  basic: 'Basic',
  professional: 'Professional',
  enterprise: 'Enterprise',
};
