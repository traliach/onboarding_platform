/**
 * Clients table + "New client" action + progress bars + portal link copy.
 *
 * Data flow:
 *   - Mounts → GET /clients, renders. AbortController cancels in-flight
 *     requests if the component unmounts before the response arrives.
 *   - After a successful create via ClientForm, the `refreshKey` bumps
 *     and the list refetches. This is the simplest correct refresh path
 *     — no optimistic insert, no cache invalidation strategy — at the
 *     cost of one extra round trip.
 *   - Clicking a row navigates to the client detail page (lands in the
 *     next commit; link already wired).
 *
 * Kept as a single file because the table + the empty state + the
 * loading state are cohesive concerns — splitting them into sub-
 * components would add three files and shed no complexity.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import { formatDateTime } from '../lib/format';
import { TIER_LABELS } from '../lib/stepsForTier';
import type { ClientListEntry } from '../types';
import { ClientForm } from './ClientForm';
import { StatusBadge } from './StatusBadge';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: ClientListEntry[] };

export function ClientList() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    api.clients
      .list(controller.signal)
      .then((rows) => {
        setState({ status: 'ready', rows });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const message =
          err instanceof ApiError ? err.message : 'Could not load clients.';
        setState({ status: 'error', message });
      });
    return () => controller.abort();
  }, [refreshKey]);

  function handleCreated(): void {
    setFormOpen(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {state.status === 'ready'
            ? `${state.rows.length} client${state.rows.length === 1 ? '' : 's'}`
            : ''}
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setFormOpen(true)}
        >
          New client
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="card p-8 text-center text-sm text-slate-500">
          Loading clients…
        </div>
      )}

      {state.status === 'error' && (
        <div className="card p-6 text-center">
          <p className="text-sm text-red-600">{state.message}</p>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="btn-secondary mt-3"
          >
            Retry
          </button>
        </div>
      )}

      {state.status === 'ready' && state.rows.length === 0 && (
        <EmptyState onCreate={() => setFormOpen(true)} />
      )}

      {state.status === 'ready' && state.rows.length > 0 && (
        <ClientsTable rows={state.rows} />
      )}

      {formOpen && (
        <ClientForm onClose={() => setFormOpen(false)} onCreated={handleCreated} />
      )}
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="card p-10 text-center">
      <h3 className="text-base font-semibold text-slate-900">No clients yet</h3>
      <p className="mt-1 text-sm text-slate-500">
        Create your first client to kick off a provisioning run.
      </p>
      <button type="button" className="btn-primary mt-4" onClick={onCreate}>
        New client
      </button>
    </div>
  );
}

function ClientsTable({ rows }: { rows: ClientListEntry[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <Th>Name</Th>
            <Th>Company</Th>
            <Th>Tier</Th>
            <Th>Status</Th>
            <Th>Progress</Th>
            <Th>Created</Th>
            <Th>Portal</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <Td>
                <Link
                  to={`/clients/${row.id}`}
                  className="font-medium text-slate-900 hover:text-blue-600"
                >
                  {row.name}
                </Link>
                <div className="text-xs text-slate-500">{row.email}</div>
              </Td>
              <Td>{row.company}</Td>
              <Td>
                <span className="text-slate-700">{TIER_LABELS[row.tier]}</span>
              </Td>
              <Td>
                <StatusBadge status={row.status} />
              </Td>
              <Td>
                <ProgressCell done={row.steps_done} total={row.steps_total} />
              </Td>
              <Td className="whitespace-nowrap text-xs text-slate-500">
                {formatDateTime(row.created_at)}
              </Td>
              <Td>
                <PortalLinkButton token={row.portal_token} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}

function ProgressCell({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="min-w-[8rem]">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
        <span>
          {done} / {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-blue-600 transition-all"
          style={{ width: `${pct}%` }}
          aria-label={`${pct} percent complete`}
        />
      </div>
    </div>
  );
}

/**
 * Portal URL is always same-origin as the frontend (the portal route
 * lives on the same Vercel deployment). No env var needed — the
 * browser's current origin is the source of truth.
 */
function PortalLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    const url = `${window.location.origin}/portal/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for dev over http:// where clipboard may be blocked.
      window.prompt('Portal link:', url);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn-secondary !px-2 !py-1 text-xs"
      title="Copy portal link to clipboard"
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}
