/**
 * RegisterPage — public page at /register/:token.
 *
 * Flow:
 *   1. On mount, call GET /auth/invite/:token.
 *   2. Token invalid / expired → show clean error, no form.
 *   3. Token valid → show email (read-only) + password + confirm password.
 *   4. Submit → POST /auth/register/:token.
 *   5. Success → redirect to /login.
 *
 * No nav, no sidebar — same minimal shell as PortalPage. Intentional.
 * This page must work without an active session.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';

type LoadState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'ready'; email: string }
  | { status: 'submitting'; email: string }
  | { status: 'error'; email: string; message: string }
  | { status: 'done' };

export function RegisterPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!token) {
      setState({ status: 'invalid' });
      return;
    }
    const controller = new AbortController();
    api.auth
      .validateInvite(token, controller.signal)
      .then((data) => {
        setState({ status: 'ready', email: data.email });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ status: 'invalid' });
      });
    return () => controller.abort();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.status !== 'ready' && state.status !== 'error') return;
    const email = state.email;

    if (password.length < 12) {
      setState({ status: 'error', email, message: 'Password must be at least 12 characters.' });
      return;
    }
    if (password !== confirm) {
      setState({ status: 'error', email, message: 'Passwords do not match.' });
      return;
    }

    setState({ status: 'submitting', email });
    try {
      await api.auth.register(token, { password });
      setState({ status: 'done' });
      navigate('/login');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Registration failed. The link may have already been used.';
      setState({ status: 'error', email, message });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Create your account</h1>
        <p className="mb-6 text-sm text-slate-500">You have been invited to join the onboarding platform.</p>

        {state.status === 'loading' && (
          <p className="text-sm text-slate-500">Validating your invite link…</p>
        )}

        {state.status === 'invalid' && (
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">Invite link not found or expired</p>
            <p className="mt-1 text-sm text-red-700">
              This link may have already been used or has expired. Ask an admin to send a new invite.
            </p>
          </div>
        )}

        {(state.status === 'ready' ||
          state.status === 'submitting' ||
          state.status === 'error') && (
          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                value={state.email}
                readOnly
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 focus:outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Password <span className="text-slate-400">(min 12 characters)</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
                minLength={12}
              />
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {state.status === 'error' && (
              <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.message}
              </p>
            )}

            <button
              type="submit"
              disabled={state.status === 'submitting'}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state.status === 'submitting' ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
