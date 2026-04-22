/**
 * Analytics tab — fleet-wide numbers pulled from GET /analytics/summary.
 *
 * Intentional non-choices:
 *   - No charting library. Four KPI cards, a CSS-bar histogram, and a
 *     failure-rate table are enough for the PM-readable dashboard this
 *     project targets. Recharts would add ~50kB gz for zero functional
 *     gain at this scale.
 *   - No auto-refresh. Analytics aren't real-time; the user can hit
 *     "Refresh" if they want the latest numbers. Polling here would
 *     hammer the /analytics/summary SQL (five aggregate queries) for
 *     no operational value.
 *   - No client-side date filtering. The server computes
 *     "onboarded_this_month" as the canonical window. If product adds
 *     arbitrary ranges later, it's a server query param, not UI logic.
 */

import { useEffect, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import { formatPercent, formatSeconds } from '../lib/format';
import type { Analytics } from '../types';

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Analytics };

export function AnalyticsView() {
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    api.analytics
      .summary(controller.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const message =
          err instanceof ApiError ? err.message : 'Could not load analytics.';
        setState({ status: 'error', message });
      });
    return () => controller.abort();
  }, [refreshKey]);

  if (state.status === 'loading') {
    return (
      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-8 text-center text-sm text-slate-500">
        Loading analytics…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6 text-center">
        <p className="text-sm text-red-600">{state.message}</p>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed mt-3"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  const { data } = state;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Success rate" value={formatPercent(data.success_rate)} />
        <KpiCard
          label="Avg completion time"
          value={formatSeconds(data.avg_completion_seconds)}
        />
        <KpiCard
          label="Onboarded this month"
          value={String(data.onboarded_this_month)}
        />
        <KpiCard
          label="Avg steps / client"
          value={data.avg_steps_per_client.toFixed(1)}
        />
      </div>

      <StepDurations rows={data.step_durations} />
      <StepFailures rows={data.step_failures} />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function StepDurations({
  rows,
}: {
  rows: Analytics['step_durations'];
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6">
        <h3 className="text-base font-semibold text-slate-900">
          Average duration per step
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          No completed steps yet. Run a client through onboarding to populate
          this chart.
        </p>
      </section>
    );
  }

  // Bars are scaled to the slowest step in the dataset, so even if the
  // absolute numbers are tiny the chart stays legible.
  const max = Math.max(...rows.map((r) => r.avg_seconds), 1);

  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6">
      <h3 className="mb-4 text-base font-semibold text-slate-900">
        Average duration per step
      </h3>
      <div className="space-y-3">
        {rows.map((row) => {
          const pct = Math.max(2, Math.round((row.avg_seconds / max) * 100));
          return (
            <div key={row.step_name}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-slate-700">{row.plain_label}</span>
                <span className="font-mono text-xs text-slate-500">
                  {formatSeconds(row.avg_seconds)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${pct}%` }}
                  aria-label={`${formatSeconds(row.avg_seconds)} average`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StepFailures({
  rows,
}: {
  rows: Analytics['step_failures'];
}) {
  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6">
      <h3 className="mb-4 text-base font-semibold text-slate-900">
        Failure rate by step
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No step failures yet. This table lights up as soon as a step fails.
        </p>
      ) : (
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead>
            <tr>
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step
              </th>
              <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                Failure rate
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.step_name}>
                <td className="py-2 text-slate-700">{row.plain_label}</td>
                <td className="py-2 text-right font-mono text-slate-900">
                  {formatPercent(row.failure_rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
