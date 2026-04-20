-- 0005_create_human_tasks.sql
-- Manual follow-up items (e.g. "send signed contract", "schedule kickoff
-- call") surfaced to the client on the portal and to admins on the client
-- detail page. Admins tick these off from the dashboard.
--
-- completed_by is free-form VARCHAR rather than FK to users so that tasks
-- completed before the admin user model existed (or by non-user actors
-- such as system imports) remain representable.
CREATE TABLE human_tasks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    label        VARCHAR     NOT NULL,
    done         BOOLEAN     NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    completed_by VARCHAR
);
