-- 0003_create_jobs.sql
-- One provisioning job per client. status reflects the overall pipeline;
-- individual step state lives in job_steps.
--
-- client_id is NOT NULL + ON DELETE CASCADE: a job cannot exist without a
-- client, and deleting a client (rare but permitted in dev) cleans up its
-- jobs atomically rather than leaving orphans.
CREATE TABLE jobs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    status       VARCHAR     NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
