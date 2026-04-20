/**
 * Authenticated app shell — top nav, current user, sign out.
 *
 * Every protected page renders inside this layout. The portal page does
 * NOT use this layout — the portal is deliberately chrome-free (no nav,
 * no dashboard link, no user identity) because its audience is the end
 * client, not staff.
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

export function Layout() {
  const { state, logout } = useAuth();
  const navigate = useNavigate();

  async function onSignOut(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  const email =
    state.status === 'authenticated' ? state.user.email : '';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <NavLink
              to="/"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Onboarding Platform
            </NavLink>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-500 sm:inline">{email}</span>
            <button type="button" className="btn-secondary" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
