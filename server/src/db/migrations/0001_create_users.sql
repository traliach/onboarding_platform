-- 0001_create_users.sql
-- Enable pgcrypto for gen_random_uuid(). PostgreSQL 13+ ships it in core,
-- so this is a no-op on the t2.micro target (PG 16) but keeps the schema
-- portable to older development installations.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Admin dashboard users (project rules section 6). Seeded manually via
-- `npm run seed`; there is no self-registration endpoint. password_hash
-- is bcrypt with cost factor >= 12 enforced by the config layer.
CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR     NOT NULL UNIQUE,
    password_hash VARCHAR     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
