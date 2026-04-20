/**
 * Display-only formatting helpers — never used on data sent to the server.
 *
 * Keep this file tiny; anything larger belongs in a feature-specific
 * module. These helpers are exercised indirectly by component tests when
 * those land; for now, the logic is simple enough that the type system is
 * the contract.
 */

/**
 * Percentage for a ratio in [0, 1], rounded to the nearest integer.
 * Returns "—" for non-finite inputs so an unexpected NaN never reaches
 * the DOM as the literal string "NaN%".
 */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return '—';
  }
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Human-friendly duration: "2m 15s" for 135, "45s" for 45, "—" for NaN/<0.
 * Seconds arrive from the analytics endpoint as a float; anything sub-second
 * renders as "<1s" rather than "0s" so the bar chart is never visually empty
 * for a fast step.
 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  if (seconds < 1) {
    return '<1s';
  }
  const rounded = Math.round(seconds);
  if (rounded < 60) {
    return `${rounded}s`;
  }
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Long, locale-aware date for detail views.
 * Kept consistent across the app via one entry point.
 */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
