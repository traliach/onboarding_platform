/**
 * Reusable status pill. The only place status → colour mapping lives.
 *
 * Colour choices come from tailwind.config.ts `colors.status.*` so any
 * future palette change is one file, not a hunt through every component.
 */

import type { Status } from '../types';

const LABELS: Record<Status, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

const STYLES: Record<Status, string> = {
  pending: 'bg-slate-100 text-slate-700 ring-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
};

interface Props {
  status: Status;
  className?: string;
}

export function StatusBadge({ status, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]} ${className}`}
    >
      {LABELS[status]}
    </span>
  );
}
