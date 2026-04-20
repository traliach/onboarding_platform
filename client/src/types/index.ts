/**
 * Shared domain types — the single source of truth for both client/ and server/.
 *
 * The server imports from this file via relative path (../../client/src/types).
 * Never duplicate these shapes inside server/ — update them here once.
 *
 * Field names match the PostgreSQL schema (snake_case) so the wire format is the
 * DB row shape with no transformation layer. Timestamp fields are ISO 8601
 * strings as emitted by pg, not Date instances.
 */

export type Tier = 'basic' | 'professional' | 'enterprise';

export type Status = 'pending' | 'in_progress' | 'done' | 'failed';

export type StepName =
  | 'createIamUser'
  | 'scaffoldS3Folder'
  | 'addToMonitoring'
  | 'generateCredentialsPDF'
  | 'sendWelcomeEmail'
  | 'createSlackChannel'
  | 'postSlackNotification';

export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  tier: Tier;
  status: Status;
  portal_token: string;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  client_id: string;
  status: Status;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface JobStep {
  id: string;
  job_id: string;
  step_name: StepName;
  plain_label: string;
  status: Status;
  log_message: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface HumanTask {
  id: string;
  client_id: string;
  label: string;
  done: boolean;
  completed_at: string | null;
  completed_by: string | null;
}

export interface AuditLogEntry {
  id: string;
  client_id: string;
  message: string;
  actor: string;
  created_at: string;
}

/**
 * Admin user profile returned by GET /auth/me and embedded in dashboard
 * responses. The password_hash column from the users table is never
 * serialised over the wire.
 */
export interface User {
  id: string;
  email: string;
  created_at: string;
}

/**
 * Request body for POST /auth/login.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Response body for POST /auth/login and GET /auth/me. The JWT is set via
 * Set-Cookie on login — it is never included in the response body (§10).
 */
export interface AuthResponse {
  user: User;
}

/**
 * GET /clients — list entries include progress counts computed server-side
 * so the dashboard can render "X / N steps" without a second round-trip.
 */
export interface ClientListEntry extends Client {
  steps_total: number;
  steps_done: number;
}

/**
 * GET /clients/:id — full detail view used by ClientPage.tsx.
 */
export interface ClientDetail {
  client: Client;
  job: Job | null;
  steps: JobStep[];
  human_tasks: HumanTask[];
  audit_log: AuditLogEntry[];
}

/**
 * GET /jobs/:id — polled live by JobDetail.tsx for step progress updates.
 * The client row is already in context from the parent ClientPage.
 */
export interface JobDetail {
  job: Job;
  steps: JobStep[];
}

/**
 * GET /analytics/summary — powers the Analytics tab.
 * success_rate and failure_rate are fractions in [0, 1].
 */
export interface AnalyticsStepDuration {
  step_name: StepName;
  plain_label: string;
  avg_seconds: number;
}

export interface AnalyticsStepFailure {
  step_name: StepName;
  plain_label: string;
  failure_rate: number;
}

export interface Analytics {
  success_rate: number;
  avg_completion_seconds: number;
  onboarded_this_month: number;
  avg_steps_per_client: number;
  step_durations: AnalyticsStepDuration[];
  step_failures: AnalyticsStepFailure[];
}

/**
 * GET /portal/:token — public response scoped to a single client.
 *
 * Deliberately narrow: no internal IDs, no step_name, no log_message,
 * no error_message, no audit log. Section 10 security rule.
 */
export interface PortalStep {
  plain_label: string;
  status: Status;
}

export interface PortalHumanTask {
  label: string;
  done: boolean;
}

export interface PortalView {
  client: {
    name: string;
    company: string;
    tier: Tier;
    status: Status;
  };
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  steps: PortalStep[];
  human_tasks: PortalHumanTask[];
}
