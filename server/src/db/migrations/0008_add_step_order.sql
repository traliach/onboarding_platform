-- 0008_add_step_order.sql
-- job_steps.id is a random UUID, so ORDER BY id or a fallback chain
-- ending in id returns rows in arbitrary order whenever started_at is
-- NULL (which is every pending row). That broke the portal progress
-- display because steps appeared out of their tier-registry execution
-- order.
--
-- step_order is the canonical ordering: the index of the step in the
-- tier's registry sequence at the time the job was created. It never
-- changes once written, so the registry can evolve without renumbering
-- historical rows.
--
-- We add the column with DEFAULT 0 so any pre-existing dev rows keep a
-- valid value, then drop the default immediately so new inserts must
-- provide an explicit step_order — silent zero-ordering regressions
-- are prevented at the schema level.
ALTER TABLE job_steps ADD COLUMN step_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_steps ALTER COLUMN step_order DROP DEFAULT;
