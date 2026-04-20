/**
 * App — route definitions.
 *
 * Route map (CLAUDE.md section 3):
 *   /login                public — LoginPage
 *   /portal/:token        public — PortalPage (lands in commit 29)
 *   /                     protected — Layout > Dashboard
 *   /clients/:id          protected — Layout > ClientPage (lands in commit 29)
 *   *                     fallback — 404
 *
 * AuthProvider wraps the whole tree so both branches of the router can
 * read auth state (LoginPage redirects to / when already authenticated;
 * ProtectedRoute kicks anonymous users to /login).
 */

import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';

import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { ClientPage } from './pages/ClientPage';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';
import { PortalPage } from './pages/PortalPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portal/:token" element={<PortalPage />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients/:id" element={<ClientPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          The page you are looking for does not exist.
        </p>
        <Navigate to="/" replace />
      </div>
    </div>
  );
}
