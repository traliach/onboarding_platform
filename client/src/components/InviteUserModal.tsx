/**
 * InviteUserModal — admin-only modal that generates a single-use registration link.
 *
 * Flow:
 *   1. Admin enters email, clicks "Send invite".
 *   2. Frontend calls POST /auth/invite.
 *   3. On success: show the generated registration link to copy and send manually.
 *      The link is: window.location.origin + /register/:token
 *   4. Admin copies the link and pastes it into their email client.
 *
 * The link is displayed — not auto-emailed — because email delivery requires
 * SMTP config outside scope. The admin copy-pastes it into whatever channel they use.
 */

import { useRef, useState } from 'react';

import { api } from '../api/client';
import { ConflictError } from '../api/errors';

interface Props {
  onClose: () => void;
}

type ModalState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'done'; link: string; email: string };

export function InviteUserModal({ onClose }: Props) {
  const [email, setEmail] = useState('');
  const [state, setModalState] = useState<ModalState>({ status: 'idle' });
  const linkRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setModalState({ status: 'submitting' });
    try {
      const data = await api.auth.invite({ email: trimmed });
      const link = `${window.location.origin}/register/${data.token}`;
      setModalState({ status: 'done', link, email: data.email });
    } catch (err: unknown) {
      if (err instanceof ConflictError) {
        setModalState({ status: 'error', message: 'That email address is already registered.' });
      } else {
        const message = err instanceof Error ? err.message : 'Failed to generate invite link.';
        setModalState({ status: 'error', message });
      }
    }
  }

  function copyLink() {
    linkRef.current?.select();
    navigator.clipboard.writeText(linkRef.current?.value ?? '').catch(() => {
      linkRef.current?.select();
      document.execCommand('copy');
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Invite a user</h2>
            <p className="mt-1 text-sm text-slate-500">
              Generate a single-use registration link — expires in 24 hours.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {state.status !== 'done' ? (
          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              autoFocus
              required
              className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />

            {state.status === 'error' && (
              <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.message}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={state.status === 'submitting'}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state.status === 'submitting' ? 'Generating…' : 'Generate link'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="mb-2 text-sm text-slate-600">
              Invite link for <span className="font-medium text-slate-900">{state.email}</span>.
              Copy it and send via email or Slack — link expires in 24 hours and is single-use.
            </p>
            <div className="mb-4 flex items-center gap-2">
              <input
                ref={linkRef}
                type="text"
                readOnly
                value={state.link}
                className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none"
                onClick={() => linkRef.current?.select()}
              />
              <button
                type="button"
                onClick={copyLink}
                className="rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
