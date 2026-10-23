-- Apply before deploying the App Manager soft-delete code.
-- Existing rows remain visible. Re-running this script is safe.
BEGIN;
ALTER TABLE "menus" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "menu_accesses" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
