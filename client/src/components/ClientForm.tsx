/**
 * Modal for creating a new client.
 *
 * UX decisions worth the reader's time:
 *   - Uses native <dialog>.showModal() for accessible focus trapping +
 *     Escape-to-close for free, no headless-ui dependency.
 *   - Tier selector shows a live preview of the steps that will be
 *     enqueued — so the operator never wonders "wait, does Basic include
 *     Slack?" This preview comes from the client-side registry mirror in
 *     lib/stepsForTier.ts (see that file for the trade-off).
 *   - phone is optional; an empty string is submitted as null (matches
 *     the server's nullable column).
 *
 * Error handling: API errors (409 duplicate email, 400 validation) are
 * surfaced inline at the top of the form. The submit button stays enabled
 * so the user can fix-and-retry without fighting a disabled state.
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import { stepsForTier, TIER_LABELS } from '../lib/stepsForTier';
import type { CreateClientRequest, Tier } from '../types';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function ClientForm({ onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tier, setTier] = useState<Tier>('basic');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) {
      return;
    }
    if (!dlg.open) {
      dlg.showModal();
    }
    // Native <dialog> emits a "close" event when dismissed via Escape or
    // form method="dialog" — route that back through the parent's state
    // so formOpen returns to false.
    const handleClose = (): void => onClose();
    dlg.addEventListener('close', handleClose);
    return () => dlg.removeEventListener('close', handleClose);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const body: CreateClientRequest = {
      name: name.trim(),
      company: company.trim(),
      email: email.trim(),
      phone: phone.trim() === '' ? null : phone.trim(),
      tier,
    };
    try {
      await api.clients.create(body);
      onCreated();
    } catch (err: unknown) {
      const message =
        err instanceof ApiError ? err.message : 'Could not create client.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const preview = stepsForTier(tier);

  return (
    <dialog
      ref={dialogRef}
      className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">New client</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2">
          <Field label="Name" required>
            <input
              className="block w-full rounded-md border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Company" required>
            <input
              className="block w-full rounded-md border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 text-sm"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              className="block w-full rounded-md border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Phone" hint="Optional">
            <input
              type="tel"
              className="block w-full rounded-md border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>

          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Tier
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['basic', 'professional', 'enterprise'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                    tier === t
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Steps that will run ({preview.length})
            </p>
            <ol className="space-y-1 text-sm text-slate-700">
              {preview.map((step, idx) => (
                <li key={step.step_name} className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {idx + 1}
                  </span>
                  {step.plain_label}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => dialogRef.current?.close()}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create client'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col text-sm">
      <span className="mb-1 flex items-center gap-2 font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
