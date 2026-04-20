-- 0004_create_job_steps.sql
-- Fine-grained provisioning steps. The seven valid step_name values are
-- enumerated in client/src/types/index.ts (StepName type). plain_label is
-- the client-facing text rendered on the public portal; internal names
-- like 'createIamUser' must never leak (CLAUDE.md section 10).
--
-- log_message carries the short human-readable outcome on success,
-- error_message carries the failure detail for the admin retry UI. Both
-- are TEXT (not VARCHAR) to hold stack traces or multi-line output.
CREATE TABLE job_steps (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id        UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    step_name     VARCHAR     NOT NULL,
    plain_label   VARCHAR     NOT NULL,
    status        VARCHAR     NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
    log_message   TEXT,
    error_message TEXT,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ
);
