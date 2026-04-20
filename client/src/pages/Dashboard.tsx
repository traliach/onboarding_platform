/**
 * Dashboard — clients tab + analytics tab.
 *
 * This commit ships the shell: tab switcher, active-tab styling, and
 * placeholder content for both tabs. Real ClientList / AnalyticsView
 * components land in the next commit.
 */

import { useState } from 'react';

type Tab = 'clients' | 'analytics';

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('clients');

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
      </div>

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          <TabButton active={tab === 'clients'} onClick={() => setTab('clients')}>
            Clients
          </TabButton>
          <TabButton
            active={tab === 'analytics'}
            onClick={() => setTab('analytics')}
          >
            Analytics
          </TabButton>
        </nav>
      </div>

      {tab === 'clients' && <ClientsPlaceholder />}
      {tab === 'analytics' && <AnalyticsPlaceholder />}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  const base =
    'whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition';
  const activeCls = 'border-blue-600 text-blue-600';
  const inactiveCls =
    'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactiveCls}`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </button>
  );
}

function ClientsPlaceholder() {
  return (
    <div className="card p-8 text-center text-sm text-slate-500">
      Client list lands in the next commit.
    </div>
  );
}

function AnalyticsPlaceholder() {
  return (
    <div className="card p-8 text-center text-sm text-slate-500">
      Analytics view lands in the next commit.
    </div>
  );
}
