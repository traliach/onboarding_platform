/**
 * DB-row → shared-domain-type mappers.
 *
 * Postgres returns TIMESTAMPTZ as JS Date objects; the shared types in
 * client/src/types declare timestamps as ISO strings (the on-the-wire shape).
 * These mappers do exactly one thing: Date → string conversion on timestamp
 * columns. Every router uses them so the client never sees raw Date instances.
 *
 * Row interfaces here mirror the SELECT lists used by the routers. Columns
 * not selected are not declared. Adding a new column to a query means adding
 * it here too — the compiler will flag the mismatch via the generic Db.query
 * type parameter.
 */

import type {
  AuditLogEntry,
  Client,
  HumanTask,
  Job,
  JobStep,
  Status,
  StepName,
  Tier,
} from '../../../client/src/types';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClientRow {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  tier: Tier;
  status: Status;
  portal_token: string;
  created_at: Date;
  updated_at: Date;
}

export interface JobRow {
  id: string;
  client_id: string;
  status: Status;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface JobStepRow {
  id: string;
  job_id: string;
  step_name: StepName;
  plain_label: string;
  status: Status;
  log_message: string | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface HumanTaskRow {
  id: string;
  client_id: string;
  label: string;
  done: boolean;
  completed_at: Date | null;
  completed_by: string | null;
}

export interface AuditLogRow {
  id: string;
  client_id: string;
  message: string;
  actor: string;
  created_at: Date;
}

export function iso(d: Date): string {
  return d.toISOString();
}

export function isoOrNull(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

export function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    tier: row.tier,
    status: row.status,
    portal_token: row.portal_token,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    client_id: row.client_id,
    status: row.status,
    started_at: isoOrNull(row.started_at),
    completed_at: isoOrNull(row.completed_at),
    created_at: iso(row.created_at),
  };
}

export function toJobStep(row: JobStepRow): JobStep {
  return {
    id: row.id,
    job_id: row.job_id,
    step_name: row.step_name,
    plain_label: row.plain_label,
    status: row.status,
    log_message: row.log_message,
    error_message: row.error_message,
    started_at: isoOrNull(row.started_at),
    completed_at: isoOrNull(row.completed_at),
  };
}

export function toHumanTask(row: HumanTaskRow): HumanTask {
  return {
    id: row.id,
    client_id: row.client_id,
    label: row.label,
    done: row.done,
    completed_at: isoOrNull(row.completed_at),
    completed_by: row.completed_by,
  };
}

export function toAuditLog(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    client_id: row.client_id,
    message: row.message,
    actor: row.actor,
    created_at: iso(row.created_at),
  };
}
