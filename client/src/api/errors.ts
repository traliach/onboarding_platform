/**
 * Error taxonomy for the client-side API wrapper.
 *
 * Every response path either resolves with the typed response body or
 * throws one of these errors. UI code uses `instanceof` checks to branch
 * on the failure mode (unauthorised → redirect to login, not-found → 404
 * page, server error → toast + retry). Generic `Error` is only thrown on
 * a truly unknown condition.
 */

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** 401 — the session cookie is missing, expired, or invalid. */
export class UnauthorizedError extends ApiError {
  constructor(body: unknown) {
    super(401, 'unauthorized', body);
    this.name = 'UnauthorizedError';
  }
}

/** 404 — the resource (client, job, portal token) does not exist. */
export class NotFoundError extends ApiError {
  constructor(body: unknown) {
    super(404, 'not found', body);
    this.name = 'NotFoundError';
  }
}

/** 409 — wrong state (e.g. retrying a step that is not 'failed'). */
export class ConflictError extends ApiError {
  constructor(body: unknown) {
    super(409, 'wrong state', body);
    this.name = 'ConflictError';
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'network error');
    this.name = 'NetworkError';
  }
}
