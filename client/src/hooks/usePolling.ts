/**
 * Poll a fetcher on an interval while a predicate holds.
 *
 * Why a hook and not a library:
 *   - SWR / React Query would do this, but both add real weight (hooks
 *     cache, dep tracking, devtools) for a feature this project uses in
 *     exactly two places (ClientPage, PortalPage). The hook below is
 *     ~50 lines, no dependencies, and does only what we need.
 *   - Polling stops the moment `keepPolling(data)` returns false, so a
 *     completed job never hammers the API.
 *   - Every in-flight request is cancellable via AbortController; the
 *     ref survives re-renders so unmount actually cancels the network
 *     request, not just the state update.
 *
 * Usage:
 *   const { data, error, refetch } = usePolling({
 *     fetcher: (signal) => api.jobs.get(id, signal),
 *     intervalMs: 2000,
 *     keepPolling: (d) => d.job.status === 'in_progress',
 *     deps: [id],
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingConfig<T> {
  /** Fetcher that honours AbortSignal. Return a typed payload. */
  readonly fetcher: (signal: AbortSignal) => Promise<T>;
  /** Milliseconds between polls. Ignored on the initial immediate fetch. */
  readonly intervalMs: number;
  /** Return false once the data is terminal (e.g. status === 'done'). */
  readonly keepPolling: (data: T) => boolean;
  /** Change any entry to restart the polling loop (e.g. the route id). */
  readonly deps: readonly unknown[];
}

export interface PollingState<T> {
  readonly data: T | null;
  readonly error: Error | null;
  readonly loading: boolean;
  /** Force an immediate refetch — used after mutations like step retry. */
  readonly refetch: () => void;
}

export function usePolling<T>(config: PollingConfig<T>): PollingState<T> {
  const { fetcher, intervalMs, keepPolling, deps } = config;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Keep the live predicate in a ref so we never close over a stale
  // "should we continue" check. If we captured keepPolling in the
  // effect closure, a freshly-rendered terminal check would be ignored
  // until the next deps change.
  const keepPollingRef = useRef(keepPolling);
  keepPollingRef.current = keepPolling;

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  // Data ref so the error branch can re-check `keepPolling` against the
  // last-known payload without creating a render-loop dependency.
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function run(): Promise<void> {
      try {
        const result = await fetcher(controller.signal);
        if (cancelled) {
          return;
        }
        setData(result);
        setError(null);
        setLoading(false);
        if (keepPollingRef.current(result)) {
          timer = setTimeout(run, intervalMs);
        }
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
        // A transient error shouldn't kill the polling loop if we have
        // stale data to show — keep retrying so a blip in the API
        // recovers on its own. If there's no data yet, stop: the first
        // fetch failed and the UI is showing the error state.
        const last = dataRef.current;
        if (last !== null && keepPollingRef.current(last)) {
          timer = setTimeout(run, intervalMs);
        }
      }
    }

    setLoading(true);
    void run();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, refetch };
}
