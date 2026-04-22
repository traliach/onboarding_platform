/**
 * Client detail — admin view of a single client's onboarding run.
 *
 * Two concerns under one page:
 *   1. One-shot fetch for the pieces that don't change often: client
 *      row, human tasks, audit log. If a human task completion or audit
 *      entry is added, the user can hit the page refresh control.
 *   2. Live polling for the job + steps via usePolling. Polling stops
 *      automatically when the job reaches 'done' or 'failed'.
 *
 * Why two sources:
 *   - /clients/:id already returns the whole detail (including steps),
 *     but re-fetching it on every 2s poll pulls the audit log too,
 *     which grows unboundedly. /jobs/:id is narrower (job + steps) and
 *     is the cheap poll target. One GET /clients/:id on mount is enough
 *     for the static chrome.
 *
 * Retry flow:
 *   - Failed step shows a Retry button. Clicking calls PATCH .../retry,
 *     which flips the step back to 'pending' and the job back to
 *     'in_progress' server-side. We then call refetch() so the UI
 *     reflects the new state before the next 2s tick, and because the
 *     job is now in_progress, polling resumes automatically.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import { StatusBadge } from '../components/StatusBadge';
import { usePolling } from '../hooks/usePolling';
import { formatDateTime, formatSeconds } from '../lib/format';
import { TIER_LABELS } from '../lib/stepsForTier';
import type { ClientDetail, JobDetail, JobStep } from '../types';

export function ClientPage() {
  const { id } = useParams<{ id: string }>();
  if (id === undefined) {
    return <NotFound />;
  }
  return <ClientPageInner id={id} />;
}

interface StaticState {
  kind: 'loading' | 'error' | 'ready';
  message?: string;
  detail?: ClientDetail;
}

function ClientPageInner({ id }: { id: string }) {
  const [staticState, setStaticState] = useState<StaticState>({
    kind: 'loading',
  });

  useEffect(() => {
    const controller = new AbortController();
    setStaticState({ kind: 'loading' });
    api.clients
      .get(id, controller.signal)
      .then((detail) => setStaticState({ kind: 'ready', detail }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const message =
          err instanceof ApiError ? err.message : 'Could not load client.';
        setStaticState({ kind: 'error', message });
      });
    return () => controller.abort();
  }, [id]);

  if (staticState.kind === 'loading') {
    return (
      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-8 text-center text-sm text-slate-500">
        Loading client…
      </div>
    );
  }

  if (staticState.kind === 'error' || staticState.detail === undefined) {
    return (
      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6 text-center">
        <p className="text-sm text-red-600">
          {staticState.message ?? 'Client not found.'}
        </p>
        <Link to="/" className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed mt-3 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <ClientPageLoaded detail={staticState.detail} />;
}

function ClientPageLoaded({ detail }: { detail: ClientDetail }) {
  const { client, job, human_tasks, audit_log } = detail;

  return (
    <div className="space-y-6">
      <Header client={client} />

      {job === null ? (
        <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6 text-sm text-slate-500">
          No provisioning job attached to this client.
        </div>
      ) : (
        <JobPanel jobId={job.id} initialSteps={detail.steps} />
      )}

      <HumanTasksPanel tasks={human_tasks} />
      <AuditLogPanel entries={audit_log} />
    </div>
  );
}

function Header({ client }: { client: ClientDetail['client'] }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← All clients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {client.name}
        </h1>
        <p className="text-sm text-slate-500">
          {client.company} · {client.email}
          {client.phone && ` · ${client.phone}`}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <StatusBadge status={client.status} />
        <span className="text-xs text-slate-500">
          {TIER_LABELS[client.tier]} tier
        </span>
      </div>
    </div>
  );
}

function JobPanel({
  jobId,
  initialSteps,
}: {
  jobId: string;
  initialSteps: JobStep[];
}) {
  const { data, error, refetch } = usePolling<JobDetail>({
    fetcher: (signal) => api.jobs.get(jobId, signal),
    intervalMs: 2000,
    // Stop polling once the job is terminal. 'pending' and 'in_progress'
    // both keep the loop alive; 'done' and 'failed' are final.
    keepPolling: (d) =>
      d.job.status === 'pending' || d.job.status === 'in_progress',
    deps: [jobId],
  });

  // Seed the view with the steps we already have from GET /clients/:id
  // so there's no flash of "empty" before the first poll returns.
  const steps = data?.steps ?? initialSteps;
  const jobStatus = data?.job.status ?? 'pending';
  const isLive = jobStatus === 'pending' || jobStatus === 'in_progress';

  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Provisioning
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {isLive
              ? 'Auto-refreshing every 2 seconds'
              : 'Final — not refreshing'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={jobStatus} />
          {error && (
            <span
              className="text-xs text-amber-600"
              title={error.message}
            >
              Stale ({error.message})
            </span>
          )}
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((step, idx) => (
          <StepRow
            key={step.id}
            step={step}
            index={idx}
            jobId={jobId}
            onRetried={refetch}
          />
        ))}
      </ol>
    </section>
  );
}

function StepRow({
  step,
  index,
  jobId,
  onRetried,
}: {
  step: JobStep;
  index: number;
  jobId: string;
  onRetried: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetry(): Promise<void> {
    setRetrying(true);
    setRetryError(null);
    try {
      await api.jobs.retryStep(jobId, step.id);
      onRetried();
    } catch (err: unknown) {
      setRetryError(
        err instanceof ApiError ? err.message : 'Retry failed.',
      );
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
      <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-900">{step.plain_label}</p>
          <StatusBadge status={step.status} />
        </div>
        {step.log_message && (
          <p className="mt-1 text-xs text-slate-500">{step.log_message}</p>
        )}
        {step.error_message && (
          <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
            {step.error_message}
          </p>
        )}
        {step.started_at && step.completed_at && (
          <p className="mt-1 text-xs text-slate-400">
            took{' '}
            {formatSeconds(
              (new Date(step.completed_at).getTime() -
                new Date(step.started_at).getTime()) /
                1000,
            )}
          </p>
        )}
        {retryError && (
          <p className="mt-1 text-xs text-red-600">{retryError}</p>
        )}
      </div>
      {step.status === 'failed' && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center justify-center rounded-md bg-white text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed !px-2 !py-1 text-xs"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </li>
  );
}

function HumanTasksPanel({
  tasks,
}: {
  tasks: ClientDetail['human_tasks'];
}) {
  if (tasks.length === 0) {
    return null;
  }
  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6">
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        Manual follow-ups
      </h2>
      <ul className="space-y-2 text-sm">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={task.done}
              readOnly
              className="h-4 w-4"
              aria-label={task.label}
            />
            <span
              className={
                task.done ? 'text-slate-400 line-through' : 'text-slate-700'
              }
            >
              {task.label}
            </span>
            {task.done && task.completed_at && (
              <span className="ml-auto text-xs text-slate-400">
                done {formatDateTime(task.completed_at)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditLogPanel({
  entries,
}: {
  entries: ClientDetail['audit_log'];
}) {
  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6">
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        Audit log
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">No activity yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3">
              <span className="w-36 flex-shrink-0 text-xs text-slate-400">
                {formatDateTime(entry.created_at)}
              </span>
              <span className="text-slate-700">{entry.message}</span>
              <span className="ml-auto text-xs text-slate-500">
                {entry.actor}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NotFound() {
  return (
    <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6 text-center">
      <p className="text-sm text-slate-600">Invalid client URL.</p>
      <Link to="/" className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed mt-3 inline-block">
        Back to dashboard
      </Link>
    </div>
  );
}
