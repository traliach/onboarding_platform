/**
 * Clients table + "New client" action + filters + search.
 *
 * Data flow:
 *   - Mounts → GET /clients, renders. AbortController cancels in-flight
 *     requests if the component unmounts before the response arrives.
 *   - After a successful create via ClientForm, the `refreshKey` bumps
 *     and the list refetches. This is the simplest correct refresh path
 *     — no optimistic insert, no cache invalidation strategy — at the
 *     cost of one extra round trip.
 *   - Clicking a row navigates to the client detail page.
 *
 * Filter + search semantics (client-side only — we already have every
 * row in memory, a round-trip for each keystroke would be wasteful):
 *   - Filter tabs narrow by status: all / in_progress / done / failed.
 *     "Pending" rows are shown under "All" only — operators almost
 *     never care to pivot on "queued but not yet picked up".
 *   - Search matches against name, company, and email, case-insensitive,
 *     substring. No fuzzy matching, no debounce — the list is small
 *     enough that filtering on every keystroke is instant.
 *   - Stat cards always reflect the full fleet, not the filtered view,
 *     so switching tabs never changes the numbers above them.
 */

import { useMemo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import { formatDateTime } from '../lib/format';
import type { ClientListEntry, Status } from '../types';
import { ClientForm } from './ClientForm';
import { StatusBadge } from './StatusBadge';
import { TierBadge } from './TierBadge';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: ClientListEntry[] };

type Filter = 'all' | 'in_progress' | 'done' | 'failed';

export function ClientList() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

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

  // Filtering is pure derivation — memoised against the state plus
  // the two inputs so typing in the search box doesn't re-walk the
  // array on every unrelated render.
  const filteredRows = useMemo(
    () => applyFilters(state.status === 'ready' ? state.rows : [], filter, search),
    [state, filter, search],
  );

  return (
    <>
      {state.status === 'ready' && <StatCards rows={state.rows} />}

      {state.status === 'ready' && state.rows.length > 0 && (
        <FilterBar
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
        />
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {state.status === 'ready'
            ? renderCountLabel(filteredRows.length, state.rows.length)
            : ''}
        </p>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setFormOpen(true)}
        >
          New client
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-8 text-center text-sm text-slate-500">
          Loading clients…
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-6 text-center">
          <p className="text-sm text-red-600">{state.message}</p>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed mt-3"
          >
            Retry
          </button>
        </div>
      )}

      {state.status === 'ready' && state.rows.length === 0 && (
        <EmptyState onCreate={() => setFormOpen(true)} />
      )}

      {state.status === 'ready' &&
        state.rows.length > 0 &&
        filteredRows.length === 0 && (
          <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-8 text-center text-sm text-slate-500">
            No clients match this filter.
          </div>
        )}

      {state.status === 'ready' && filteredRows.length > 0 && (
        <ClientsTable rows={filteredRows} />
      )}

      {formOpen && (
        <ClientForm onClose={() => setFormOpen(false)} onCreated={handleCreated} />
      )}
    </>
  );
}

function applyFilters(
  rows: ClientListEntry[],
  filter: Filter,
  search: string,
): ClientListEntry[] {
  const q = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== 'all' && row.status !== filter) {
      return false;
    }
    if (q === '') {
      return true;
    }
    return (
      row.name.toLowerCase().includes(q) ||
      row.company.toLowerCase().includes(q) ||
      row.email.toLowerCase().includes(q)
    );
  });
}

function renderCountLabel(filtered: number, total: number): string {
  if (filtered === total) {
    return `${total} client${total === 1 ? '' : 's'}`;
  }
  return `Showing ${filtered} of ${total}`;
}

/**
 * Four-up count cards above the table: total, in progress, done, failed.
 *
 * Counts are derived from the rows already in memory — no extra round
 * trip. A single pass tallies all four buckets so there's no hidden O(4n)
 * surprise from four separate filters.
 *
 * Colour contract (matches the rest of the dashboard):
 *   - total       → neutral slate
 *   - in_progress → blue (also the StatusBadge in_progress colour)
 *   - done        → emerald (also the "done" progress bar)
 *   - failed      → red
 *
 * Pending is folded into the "total" card rather than shown separately:
 *   pending is a transient state (queued but not yet picked up) and
 *   operators care about in-flight / done / failed far more.
 */
function StatCards({ rows }: { rows: ClientListEntry[] }) {
  let inProgress = 0;
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'in_progress') {
      inProgress += 1;
    } else if (row.status === 'done') {
      done += 1;
    } else if (row.status === 'failed') {
      failed += 1;
    }
  }

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        label="Total clients"
        value={rows.length}
        accent="border-l-4 border-slate-300"
        valueClass="text-slate-900"
      />
      <StatCard
        label="In progress"
        value={inProgress}
        accent="border-l-4 border-blue-400"
        valueClass="text-blue-700"
      />
      <StatCard
        label="Done"
        value={done}
        accent="border-l-4 border-emerald-400"
        valueClass="text-emerald-700"
      />
      <StatCard
        label="Failed"
        value={failed}
        accent="border-l-4 border-red-400"
        valueClass="text-red-700"
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  valueClass,
}: {
  label: string;
  value: number;
  accent: string;
  valueClass: string;
}) {
  return (
    <div className={`card flex items-center justify-between p-4 ${accent}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * Search input on the left, filter tabs on the right.
 * Active tab styling: bold text + a bottom border tinted to match the
 * status colour of the tab (All = slate, In Progress = blue, Done =
 * emerald, Failed = red). Inactive tabs are plain muted text.
 */
interface FilterBarProps {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  search: string;
  onSearchChange: (s: string) => void;
}

function FilterBar({
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: FilterBarProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clipRule="evenodd"
          />
        </svg>
        <input
          type="search"
          placeholder="Search name, company, or email"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <nav className="-mb-px flex gap-4 overflow-x-auto" aria-label="Filter by status">
        <FilterTab
          active={filter === 'all'}
          onClick={() => onFilterChange('all')}
          activeClasses="border-slate-700 text-slate-900"
        >
          All
        </FilterTab>
        <FilterTab
          active={filter === 'in_progress'}
          onClick={() => onFilterChange('in_progress')}
          activeClasses="border-blue-500 text-blue-700"
        >
          In progress
        </FilterTab>
        <FilterTab
          active={filter === 'done'}
          onClick={() => onFilterChange('done')}
          activeClasses="border-emerald-500 text-emerald-700"
        >
          Done
        </FilterTab>
        <FilterTab
          active={filter === 'failed'}
          onClick={() => onFilterChange('failed')}
          activeClasses="border-red-500 text-red-700"
        >
          Failed
        </FilterTab>
      </nav>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  activeClasses,
  children,
}: {
  active: boolean;
  onClick: () => void;
  activeClasses: string;
  children: React.ReactNode;
}) {
  const base =
    'whitespace-nowrap border-b-2 px-1 pb-2 text-sm transition';
  const inactive =
    'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 font-medium';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? `${activeClasses} font-semibold` : inactive}`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 p-10 text-center">
      <h3 className="text-base font-semibold text-slate-900">No clients yet</h3>
      <p className="mt-1 text-sm text-slate-500">
        Create your first client to kick off a provisioning run.
      </p>
      <button type="button" className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed mt-4" onClick={onCreate}>
        New client
      </button>
    </div>
  );
}

function ClientsTable({ rows }: { rows: ClientListEntry[] }) {
  return (
    <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 overflow-hidden">
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
            <tr key={row.id} className="transition-colors hover:bg-gray-50">
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
                <TierBadge tier={row.tier} />
              </Td>
              <Td>
                <StatusBadge status={row.status} />
              </Td>
              <Td>
                <ProgressCell
                  done={row.steps_done}
                  total={row.steps_total}
                  status={row.status}
                />
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

/**
 * Progress bar tinted to match the row's status so the colour semantics
 * stay consistent across the whole dashboard:
 *   - done        → emerald
 *   - failed      → red
 *   - in_progress → blue
 *   - pending     → slate (neutral; the job hasn't started)
 */
const PROGRESS_COLORS: Record<Status, string> = {
  pending: 'bg-slate-300',
  in_progress: 'bg-blue-500',
  done: 'bg-emerald-500',
  failed: 'bg-red-500',
};

function ProgressCell({
  done,
  total,
  status,
}: {
  done: number;
  total: number;
  status: Status;
}) {
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
          className={`h-full transition-all ${PROGRESS_COLORS[status]}`}
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
 *
 * Visual: small outlined pill so it reads clearly as a clickable action
 * rather than incidental muted text. A subtle link icon anchors the
 * "this opens / copies a URL" meaning before the user even reads the
 * label.
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

  const base =
    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition';
  const idleClass =
    'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700';
  const copiedClass = 'border-emerald-300 bg-emerald-50 text-emerald-700';

  return (
    <button
      type="button"
      onClick={copy}
      className={`${base} ${copied ? copiedClass : idleClass}`}
      title="Copy portal link to clipboard"
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
        className="h-3.5 w-3.5"
      >
        <path
          fillRule="evenodd"
          d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z"
          clipRule="evenodd"
        />
        <path
          fillRule="evenodd"
          d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z"
          clipRule="evenodd"
        />
      </svg>
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}
