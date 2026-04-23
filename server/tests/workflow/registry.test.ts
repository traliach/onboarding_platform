/**
 * Tier → step-sequence contract.
 *
 * These assertions encode the product rules from project rules §4 and prevent a
 * future edit to the registry from silently changing what a "basic" or
 * "enterprise" client gets provisioned for. Order matters — the worker runs
 * the steps sequentially in the order the registry returns them.
 */

import { stepsForTier } from '../../src/workflow/registry';

describe('stepsForTier', () => {
  it('basic tier has exactly 3 steps in the documented order', () => {
    const steps = stepsForTier('basic').map((s) => s.step_name);
    expect(steps).toEqual([
      'createIamUser',
      'scaffoldS3Folder',
      'sendWelcomeEmail',
    ]);
  });

  it('professional tier has 6 steps and no credentials PDF', () => {
    const names = stepsForTier('professional').map((s) => s.step_name);
    expect(names).toHaveLength(6);
    expect(names).not.toContain('generateCredentialsPDF');
    expect(names).toContain('createSlackChannel');
    expect(names).toContain('postSlackNotification');
  });

  it('enterprise tier has 7 steps and runs generateCredentialsPDF after createIamUser', () => {
    const names = stepsForTier('enterprise').map((s) => s.step_name);
    expect(names).toHaveLength(7);
    expect(names.indexOf('createIamUser')).toBeLessThan(
      names.indexOf('generateCredentialsPDF'),
    );
  });

  it('every step carries a non-empty client-facing label', () => {
    for (const tier of ['basic', 'professional', 'enterprise'] as const) {
      for (const step of stepsForTier(tier)) {
        expect(step.plain_label.length).toBeGreaterThan(0);
        // Never leak the internal camelCase name as the label.
        expect(step.plain_label).not.toBe(step.step_name);
      }
    }
  });
});
