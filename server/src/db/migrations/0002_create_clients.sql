-- 0002_create_clients.sql
-- Clients are the top-level tenant. Each client owns exactly one job, any
-- number of human_tasks, and any number of audit_log entries.
--
-- portal_token is the sole credential for the public portal page — it is
-- generated server-side, never guessable (UUIDv4 from gen_random_uuid()),
-- and marked UNIQUE so a collision (astronomically unlikely) fails loudly.
CREATE TABLE clients (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR     NOT NULL,
    company      VARCHAR     NOT NULL,
    email        VARCHAR     NOT NULL,
    phone        VARCHAR,
    tier         VARCHAR     NOT NULL
        CHECK (tier IN ('basic', 'professional', 'enterprise')),
    status       VARCHAR     NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
    portal_token UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shared trigger function for tables that track updated_at. Defined once
-- here so later migrations can reuse it via CREATE TRIGGER ... EXECUTE
-- FUNCTION set_updated_at() without redefining the body.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_set_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
