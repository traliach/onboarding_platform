-- 0006_create_audit_log.sql
-- Append-only audit trail scoped to a client. Written by every admin action
-- (client created, step retried, task completed) and by every automated
-- step transition so the client detail page can render a complete timeline.
--
-- actor is VARCHAR rather than a FK so system actors ('worker', 'cron',
-- 'migration') are representable without needing synthetic user rows.
-- There is no ON UPDATE/DELETE CASCADE from users — audit entries survive
-- the deletion of their actor.
CREATE TABLE audit_log (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    message    TEXT        NOT NULL,
    actor      VARCHAR     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
