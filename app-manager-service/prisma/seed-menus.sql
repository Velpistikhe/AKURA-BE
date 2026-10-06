-- =============================================================================
-- Seed menus and sub-menu items (menu_items) for App Manager Service.
--
-- Idempotent: safe to run multiple times. Existing rows are matched by their
-- unique `key` and updated instead of duplicated.
--
-- Run with:
--   npx prisma db execute --file prisma/seed-menus.sql --schema prisma/schema.prisma
--
-- Notes:
--   * `id`, `created_at`, and `updated_at` have no database-level defaults for
--     `updated_at` (Prisma @updatedAt is client-managed), so raw SQL must set
--     them explicitly.
--   * Sub-menu items are invisible in GET /menus/my-menus until a matching
--     row exists in `menu_accesses`. See the optional block at the bottom.
--   * Keys must match ^[a-z0-9_-]+$ and are globally unique per table.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Menus (parent / top-level groups)
-- ---------------------------------------------------------------------------
INSERT INTO "menus" ("id", "key", "label", "has_item", "order", "is_active", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'app_manager',  'App Manager',  TRUE, 1, TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'referensi',     'Referensi',    TRUE, 2, TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'marketing',     'Marketing',    TRUE, 3, TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'finance',       'Finance',      TRUE, 4, TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'field-service', 'Field Service', TRUE, 5, TRUE, NOW(), NOW())
ON CONFLICT ("key") DO UPDATE
SET "label"     = EXCLUDED."label",
    "has_item"  = EXCLUDED."has_item",
    "order"     = EXCLUDED."order",
    "is_active" = EXCLUDED."is_active",
    "updated_at" = NOW();

-- ---------------------------------------------------------------------------
-- 2. Sub-menu items (children of a menu, linked by menu_id)
-- ---------------------------------------------------------------------------
INSERT INTO "menu_items" ("id", "menu_id", "key", "label", "order", "is_active", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  parent."id",
  seed."key",
  seed."label",
  seed."order",
  TRUE,
  NOW(),
  NOW()
FROM "menus" AS parent
CROSS JOIN (
  VALUES
    -- menu: app_manager (path /app_manager/<item_key>)
    ('users',          'Users',          1),
    ('menus',          'Menus',          2),
    ('menu-items',     'Menu Items',     3),
    ('office-branches', 'Office Branches', 4)
  ) AS seed ("key", "label", "order")
WHERE parent."key" = 'app_manager'
ON CONFLICT ("key") DO UPDATE
SET "menu_id"    = EXCLUDED."menu_id",
    "label"      = EXCLUDED."label",
    "order"      = EXCLUDED."order",
    "is_active"  = EXCLUDED."is_active",
    "updated_at" = NOW();

INSERT INTO "menu_items" ("id", "menu_id", "key", "label", "order", "is_active", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  parent."id",
  seed."key",
  seed."label",
  seed."order",
  TRUE,
  NOW(),
  NOW()
FROM "menus" AS parent
CROSS JOIN (
  VALUES
    -- menu: referensi (path /referensi/<item_key>)
    ('companies', 'Companies', 1),
    ('services',  'Services',  2),
    ('items',     'Items',     3),
    ('taxes',     'Taxes',     4)
  ) AS seed ("key", "label", "order")
WHERE parent."key" = 'referensi'
ON CONFLICT ("key") DO UPDATE
SET "menu_id"    = EXCLUDED."menu_id",
    "label"      = EXCLUDED."label",
    "order"      = EXCLUDED."order",
    "is_active"  = EXCLUDED."is_active",
    "updated_at" = NOW();

-- Add more parent menus by copying one block above and changing the
-- parent."key" filter plus the VALUES rows.

-- ---------------------------------------------------------------------------
-- 3. (Optional) Menu access rules so sub-menu items appear in my-menus.
--    The example below grants APP_MANAGER access for the HRD_MANAGEMENT
--    section. Replace the role/section or duplicate rows for other audiences.
-- ---------------------------------------------------------------------------
-- INSERT INTO "menu_accesses" ("id", "menu_item_id", "role", "section", "created_at", "updated_at")
-- SELECT gen_random_uuid(), item."id", access.seed_role, access.seed_section, NOW(), NOW()
-- FROM "menu_items" AS item
-- CROSS JOIN (
--   VALUES
--     ('APP_MANAGER'::"user_role", 'HRD_MANAGEMENT'::"user_section")
-- ) AS access (seed_role, seed_section)
-- WHERE item."key" IN ('users', 'menus', 'menu-items', 'office-branches')
-- ON CONFLICT ("menu_item_id", "role", "section") DO NOTHING;

COMMIT;
