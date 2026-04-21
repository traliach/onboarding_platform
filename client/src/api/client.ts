/**
 * Typed fetch wrappers for every onboarding_platform API endpoint.
 *
 * Contract:
 *   - All requests include `credentials: 'include'` so the session cookie
 *     set by POST /auth/login is sent on subsequent calls. Without this
 *     the JWT is useless — the browser simply does not attach the cookie
 *     on cross-origin requests. CLAUDE.md section 10.
 *   - Every response status is mapped to a typed error (errors.ts). UI
 *     code never parses response.status on its own.
 *   - The base URL comes from VITE_API_BASE_URL at build time. Never read
 *     `window.location` or hardcode; that breaks the Vercel → ALB story.
 *
 * Adding a new endpoint means one function here with a well-typed signature.
 * Never let call sites hand-roll fetch — the CORS + cookie + error-mapping
 * contract belongs in one place.
 */

import type {
  Analytics,
  AuthResponse,
  Client,
  ClientDetail,
  ClientListEntry,
  CreateClientRequest,
  InviteRequest,
  InviteResponse,
  InviteValidationResponse,
  JobDetail,
  LoginRequest,
  PortalView,
  RegisterRequest,
  StepRetryResponse,
  UpdateClientRequest,
} from '../types';
import {
  ApiError,
  ConflictError,
  NetworkError,
  NotFoundError,
  UnauthorizedError,
} from './errors';

/**
 * Resolve the API base URL with a sensible dev fallback.
 *
 * Production (Vercel): VITE_API_BASE_URL is set to the ALB origin at build
 * time; the value is baked into the bundle.
 * Development: if the env var is unset, fall back to http://localhost:4000
 * so `npm run dev` works without a copied .env.development file. We never
 * fall back in a production build — an unset var there is a deploy bug
 * and should surface as broken network calls, not silently point at
 * localhost.
 */
const BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? 'http://localhost:4000' : '');

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers:
        body === undefined
          ? undefined
          : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // fetch throws only on network-layer failure (DNS, connection refused,
    // CORS pre-flight rejection, or an aborted signal). HTTP errors are
    // successful fetches with a non-2xx status — handled below.
    //
    // Re-throw AbortError unchanged so callers can detect it with the
    // idiomatic `err instanceof DOMException && err.name === 'AbortError'`
    // check. Wrapping it in NetworkError would make every unmount in
    // React StrictMode look like a real network failure.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new NetworkError(err);
  }

  // 204 has no body — common for logout.
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (response.ok) {
    return payload as T;
  }

  const message = extractErrorMessage(payload) ?? `HTTP ${response.status}`;
  if (response.status === 401) {
    throw new UnauthorizedError(payload);
  }
  if (response.status === 404) {
    throw new NotFoundError(payload);
  }
  if (response.status === 409) {
    throw new ConflictError(payload);
  }
  throw new ApiError(response.status, message, payload);
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const { error } = payload as { error: unknown };
    if (typeof error === 'string') {
      return error;
    }
  }
  return null;
}

// ── Auth ────────────────────────────────────────────────────────────────

export const auth = {
  login(body: LoginRequest): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/login', { method: 'POST', body });
  },
  logout(): Promise<void> {
    return request<void>('/auth/logout', { method: 'POST' });
  },
  me(signal?: AbortSignal): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/me', { signal });
  },
  invite(body: InviteRequest): Promise<InviteResponse> {
    return request<InviteResponse>('/auth/invite', { method: 'POST', body });
  },
  validateInvite(token: string, signal?: AbortSignal): Promise<InviteValidationResponse> {
    return request<InviteValidationResponse>(`/auth/invite/${token}`, { signal });
  },
  register(token: string, body: RegisterRequest): Promise<AuthResponse> {
    return request<AuthResponse>(`/auth/register/${token}`, { method: 'POST', body });
  },
};

// ── Clients ─────────────────────────────────────────────────────────────

export const clients = {
  list(signal?: AbortSignal): Promise<ClientListEntry[]> {
    return request<ClientListEntry[]>('/clients', { signal });
  },
  get(id: string, signal?: AbortSignal): Promise<ClientDetail> {
    return request<ClientDetail>(`/clients/${id}`, { signal });
  },
  create(body: CreateClientRequest): Promise<Client> {
    return request<Client>('/clients', { method: 'POST', body });
  },
  update(id: string, body: UpdateClientRequest): Promise<Client> {
    return request<Client>(`/clients/${id}`, { method: 'PATCH', body });
  },
};

// ── Jobs ────────────────────────────────────────────────────────────────

export const jobs = {
  get(id: string, signal?: AbortSignal): Promise<JobDetail> {
    return request<JobDetail>(`/jobs/${id}`, { signal });
  },
  retryStep(jobId: string, stepId: string): Promise<StepRetryResponse> {
    return request<StepRetryResponse>(
      `/jobs/${jobId}/steps/${stepId}/retry`,
      { method: 'PATCH' },
    );
  },
};

// ── Portal (public, no auth) ────────────────────────────────────────────

export const portal = {
  get(token: string, signal?: AbortSignal): Promise<PortalView> {
    return request<PortalView>(`/portal/${token}`, { signal });
  },
};

// ── Analytics ───────────────────────────────────────────────────────────

export const analytics = {
  summary(signal?: AbortSignal): Promise<Analytics> {
    return request<Analytics>('/analytics/summary', { signal });
  },
};

export const api = { auth, clients, jobs, portal, analytics };
