-- Prisma 5 cannot represent partial unique indexes in schema.prisma.
-- Apply after schema synchronization; preserve all existing size/price rows.
BEGIN;
LOCK TABLE item_sizes IN ACCESS EXCLUSIVE MODE;
CREATE UNIQUE INDEX IF NOT EXISTS item_sizes_active_item_id_size_key
  ON item_sizes (item_id, size) WHERE is_active = true;
ALTER TABLE item_sizes DROP CONSTRAINT IF EXISTS item_sizes_item_id_size_key;
DROP INDEX IF EXISTS item_sizes_item_id_size_key;
COMMIT;
