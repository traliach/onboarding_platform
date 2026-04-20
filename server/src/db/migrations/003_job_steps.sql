CREATE TABLE IF NOT EXISTS job_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  step_name     TEXT NOT NULL,
  step_order    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
  result        JSONB,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_job_steps_job_id ON job_steps (job_id);
CREATE INDEX IF NOT EXISTS idx_job_steps_status ON job_steps (status);
