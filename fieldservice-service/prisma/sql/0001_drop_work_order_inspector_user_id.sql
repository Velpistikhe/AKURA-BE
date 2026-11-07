-- Removes the Auth user ID from the Work Order inspectors.
--
-- The inspectors are identified by their display name only. The user ID
-- existed solely so the server could re-validate every inspector against the
-- live Auth directory before the Work Order started; that directory lookup no
-- longer exists, so the column has no remaining purpose.
--
-- The file is idempotent, so it is safe to run more than once, and safe to
-- run before or after `prisma db push` (which drops the column on its own
-- when it detects the removal from the Prisma schema).

-- Fail early and loudly if the table does not exist yet.
DO $$
BEGIN
  IF to_regclass('public.work_order_inspectors') IS NULL THEN
    RAISE EXCEPTION 'public.work_order_inspectors does not exist; run the schema push first';
  END IF;
END
$$;

-- The column is dropped only when it exists, so replaying the file is safe.
ALTER TABLE work_order_inspectors
  DROP COLUMN IF EXISTS user_id;
