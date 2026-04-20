/**
 * Tier pill — the one place tier → colour mapping lives.
 *
 * Palette per design spec:
 *   - Basic        → purple (entry-level, calm)
 *   - Professional → amber  (mid-tier, warm)
 *   - Enterprise   → teal   (premium, distinct from the blue "in_progress"
 *                            status pill so the two never visually collide)
 *
 * Kept as its own component — and its own file — so the dashboard list
 * and the client detail page render tiers identically without each
 * copy-pasting the Tailwind classes.
 */

import { TIER_LABELS } from '../lib/stepsForTier';
import type { Tier } from '../types';

const STYLES: Record<Tier, string> = {
  basic: 'bg-purple-50 text-purple-700 ring-purple-200',
  professional: 'bg-amber-50 text-amber-700 ring-amber-200',
  enterprise: 'bg-teal-50 text-teal-700 ring-teal-200',
};

interface Props {
  tier: Tier;
  className?: string;
}

export function TierBadge({ tier, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[tier]} ${className}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
