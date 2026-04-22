/**
 * Portal — public, unauthenticated view of one client's progress.
 *
 * Security posture (CLAUDE.md §10): this page is the only place the
 * unauthenticated internet reaches the backend. The server's /portal
 * handler deliberately scopes the response to a single client and omits
 * step_name, internal IDs, error_message, audit log, and anything else
 * that could leak infrastructure detail. This file must render only
 * what the PortalView type exposes — never "enrich" with the detail
 * view. If you catch yourself reaching for api.clients.get here, stop.
 *
 * Design:
 *   - No app Layout (no top nav, no sign-out). The portal is not a
 *     dashboard page — it's a self-contained status URL the client
 *     company lands on from a welcome email.
 *   - Big progress bar, plain-English step labels, gentle status pills.
 *     Clients should understand this page without onboarding to the
 *     onboarding product, hence no jargon like "IAM" or "S3".
 *   - Same 2s live polling as the admin view, stops when terminal.
 *
 * Errors:
 *   - Bad / expired / tampered token → server returns 404. Show a
 *     friendly "link is invalid or has expired" message rather than
 *     leaking whether the token ever existed.
 */

import { useParams } from 'react-router-dom';

import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { usePolling } from '../hooks/usePolling';
import { TIER_LABELS } from '../lib/stepsForTier';
import type { PortalView } from '../types';

export function PortalPage() {
  const { token } = useParams<{ token: string }>();
  if (token === undefined || token.length === 0) {
    return <InvalidLink />;
  }
  return <PortalPageInner token={token} />;
}

function PortalPageInner({ token }: { token: string }) {
  const { data, error, loading } = usePolling<PortalView>({
    fetcher: (signal) => api.portal.get(token, signal),
    intervalMs: 2000,
    keepPolling: (d) =>
      d.client.status === 'pending' || d.client.status === 'in_progress',
    deps: [token],
  });

  if (loading && data === null) {
    return <Shell>Loading your onboarding status…</Shell>;
  }

  if (error && data === null) {
    return <InvalidLink />;
  }

  if (data === null) {
    return <InvalidLink />;
  }

  return <PortalContent view={data} />;
}

function PortalContent({ view }: { view: PortalView }) {
  const { client, progress, steps, human_tasks } = view;

  return (
    <Shell>
      <header className="mb-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          Onboarding portal
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          Welcome, {client.name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {client.company} · {TIER_LABELS[client.tier]} plan
        </p>
      </header>

      <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 mb-6 p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">Overall progress</h2>
          <StatusBadge status={client.status} />
        </div>
        <div className="flex items-center gap-4">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${progress.percentage}%` }}
              aria-label={`${progress.percentage} percent complete`}
            />
          </div>
          <span className="text-sm font-semibold text-slate-700">
            {progress.completed} / {progress.total}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {client.status === 'done'
            ? 'All set — your account is fully provisioned.'
            : client.status === 'failed'
              ? 'Something needs attention. Our team has been notified and will reach out shortly.'
              : `${progress.percentage}% complete — this page updates automatically.`}
        </p>
      </section>

      <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 mb-6 p-6">
        <h2 className="mb-4 text-sm font-medium text-slate-700">
          Setup steps
        </h2>
        <ol className="space-y-3">
          {steps.map((step, idx) => (
            <li
              key={`${idx}-${step.plain_label}`}
              className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2"
            >
              <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {idx + 1}
              </span>
              <span className="flex-1 text-sm text-slate-800">
                {step.plain_label}
              </span>
              <StatusBadge status={step.status} />
            </li>
          ))}
        </ol>
      </section>

      {human_tasks.length > 0 && (
        <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6">
          <h2 className="mb-4 text-sm font-medium text-slate-700">
            What you need to do
          </h2>
          <ul className="space-y-2 text-sm">
            {human_tasks.map((task, idx) => (
              <li
                key={`${idx}-${task.label}`}
                className="flex items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                    task.done
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {task.done && (
                    <svg
                      viewBox="0 0 12 12"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M2 6l3 3 5-6" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                <span
                  className={
                    task.done ? 'text-slate-400 line-through' : 'text-slate-800'
                  }
                >
                  {task.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 py-12">
      <div className="mx-auto w-full max-w-2xl px-4">{children}</div>
    </div>
  );
}

function InvalidLink() {
  return (
    <Shell>
      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">
          This link is invalid or has expired
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Please contact your account manager for a new onboarding link.
        </p>
      </div>
    </Shell>
  );
}
