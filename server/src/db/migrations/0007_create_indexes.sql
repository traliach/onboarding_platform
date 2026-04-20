-- 0007_create_indexes.sql
-- Covering indexes for the read paths the dashboard, portal, and analytics
-- tab hit on every page load. Foreign key columns require explicit indexes
-- in PostgreSQL — the REFERENCES clause does not create one for the child
-- side. Without these, cascade deletes and JOIN queries fall back to
-- sequential scans once the tables grow past a few hundred rows.
--
-- UNIQUE constraints on users.email, clients.portal_token, and the
-- migration primary keys create their own indexes automatically and are
-- therefore not duplicated here.

-- Foreign-key indexes (one per child side).
CREATE INDEX jobs_client_id_idx        ON jobs        (client_id);
CREATE INDEX job_steps_job_id_idx      ON job_steps   (job_id);
CREATE INDEX human_tasks_client_id_idx ON human_tasks (client_id);
CREATE INDEX audit_log_client_id_idx   ON audit_log   (client_id);

-- Status filters drive the dashboard "all pending" / "all failed" tabs
-- and the worker's "find next pending job" query.
CREATE INDEX clients_status_idx   ON clients   (status);
CREATE INDEX jobs_status_idx      ON jobs      (status);
CREATE INDEX job_steps_status_idx ON job_steps (status);

-- Audit log timeline: client page reads `WHERE client_id = $1 ORDER BY
-- created_at DESC LIMIT 50`. Composite index serves both predicates in
-- one lookup.
CREATE INDEX audit_log_client_id_created_at_idx
    ON audit_log (client_id, created_at DESC);
