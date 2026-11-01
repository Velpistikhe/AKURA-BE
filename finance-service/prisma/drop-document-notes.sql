-- Drop the Document notes column. The field is no longer part of the Prisma
-- model, the request schemas or the public API, so the stored value is
-- discarded. History snapshots keep their own JSON payload untouched.
--
-- Run with:
--   npx prisma db execute --file prisma/drop-document-notes.sql --schema prisma/schema.prisma

ALTER TABLE billing_documents DROP COLUMN IF EXISTS notes;
