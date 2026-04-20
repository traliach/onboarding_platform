/**
 * Route wrapper that gates content on authentication state.
 *
 * Three-state machine from AuthContext:
 *   - unknown        → render a skeleton; don't redirect. Prevents a
 *                       refresh-on-protected-page from bouncing through /login.
 *   - anonymous      → <Navigate to="/login"> with the current location
 *                       preserved so LoginPage can send the user back after
 *                       success.
 *   - authenticated  → render children.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading session…
      </div>
    );
  }

  if (state.status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
