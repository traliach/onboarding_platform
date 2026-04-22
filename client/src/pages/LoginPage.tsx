/**
 * LoginPage — email + password form. On success the server sets an httpOnly
 * session cookie; the AuthContext flips to 'authenticated' and the user is
 * redirected to wherever they originally intended to go (or to the
 * dashboard).
 *
 * No password reset flow yet — the single admin user is seeded via
 * `server/npm run seed`. If we add a reset flow later, it lands as a
 * separate page + route.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ApiError, UnauthorizedError } from '../api/errors';
import { useAuth } from '../context/AuthContext';

interface LocationState {
  from?: { pathname?: string };
}

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If we land on /login already authenticated (e.g. user navigated here
  // manually), send them straight to the dashboard.
  useEffect(() => {
    if (state.status === 'authenticated') {
      const dest = (location.state as LocationState | null)?.from?.pathname ?? '/';
      navigate(dest, { replace: true });
    }
  }, [state.status, navigate, location.state]);

  if (state.status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      // Redirect handled by the useEffect above once state flips.
    } catch (err: unknown) {
      if (err instanceof UnauthorizedError) {
        setError('Invalid email or password.');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Login failed. Please try again.');
      } else {
        setError('Could not reach the server. Check your connection.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 w-full max-w-md p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Onboarding Platform — internal dashboard
          </p>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className="block w-full rounded-md border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 text-sm mt-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label
            className="mt-4 block text-sm font-medium text-slate-700"
            htmlFor="password"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="block w-full rounded-md border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 text-sm mt-1"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error !== null && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || email.length === 0 || password.length === 0}
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed mt-6 w-full"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
