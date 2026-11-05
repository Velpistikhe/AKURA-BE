-- Enforces the single head office branch invariant at the database level.
--
-- The Prisma schema documents this rule on `OfficeBranch.isHead`, but Prisma
-- cannot express a partial unique index, so `prisma db push` never creates
-- it. The application also guards the rule with a transaction advisory lock,
-- but that lock only protects writers that go through the service. This index
-- protects the data itself, whatever writes it.
--
-- The index is built on `is_head`, which is constant (`true`) for every row
-- that passes the WHERE clause. PostgreSQL therefore allows at most one such
-- row: that is the invariant.
--
-- The file is idempotent, so it is safe to run more than once, and safe to
-- run after `prisma db push` (which leaves existing indexes untouched).

-- Fail early and loudly if the table does not exist yet.
DO $$
BEGIN
  IF to_regclass('public.office_branches') IS NULL THEN
    RAISE EXCEPTION 'public.office_branches does not exist; run the schema push first';
  END IF;
END
$$;

-- Remove any head branch that violates the invariant, keeping the oldest.
-- A deployment must not fail on pre-existing duplicate heads, and the oldest
-- row is the one the application has always treated as the head.
DELETE FROM office_branches
WHERE is_head = true
  AND id NOT IN (
    SELECT id FROM office_branches WHERE is_head = true ORDER BY created_at ASC, id ASC LIMIT 1
  );

-- The unique index is the enforcement mechanism.
CREATE UNIQUE INDEX IF NOT EXISTS office_branches_single_head_idx
  ON office_branches (is_head)
  WHERE is_head = true;

-- The comment documents the invariant next to the index in the database.
COMMENT ON INDEX office_branches_single_head_idx IS
  'Enforces the single head office branch invariant: at most one row may have is_head = true.';
