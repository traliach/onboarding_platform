-- Invite token store for the invite-only registration flow (project rules §6).
--
-- token is separate from id so it can be rotated independently if needed.
-- created_by references users so audit trails show who sent each invite.
-- expires_at is set to NOW() + 24h at insert time; the check lives in
-- application code (SELECT ... WHERE used = false AND expires_at > NOW()).

CREATE TABLE invite_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  email       VARCHAR     NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
