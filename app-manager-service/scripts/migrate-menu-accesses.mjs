import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'menu_items'
      AND column_name IN ('role', 'section')
  `);
  const legacyColumns = new Set(columns.map(({ columnName }) => columnName));

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS menu_accesses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        menu_id uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        role user_role NULL,
        section user_section NULL,
        created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT menu_accesses_menu_id_role_section_key UNIQUE (menu_id, role, section)
      )
    `);

    await tx.$executeRawUnsafe(`ALTER TABLE menu_accesses ALTER COLUMN role DROP NOT NULL`);
    await tx.$executeRawUnsafe(`
      DELETE FROM menu_accesses legacy
      USING menu_accesses wildcard
      WHERE legacy.role::text = 'ALL'
        AND wildcard.role IS NULL
        AND legacy.menu_id = wildcard.menu_id
        AND legacy.section IS NOT DISTINCT FROM wildcard.section
    `);
    await tx.$executeRawUnsafe(`UPDATE menu_accesses SET role = NULL WHERE role::text = 'ALL'`);

    if (legacyColumns.has('role') && legacyColumns.has('section')) {
      await tx.$executeRawUnsafe(`
        INSERT INTO menu_accesses (menu_id, role, section)
        SELECT DISTINCT source.menu_id,
          CASE WHEN source.role::text = 'ALL' THEN NULL ELSE source.role END,
          source.section
        FROM menu_items source
        WHERE NOT EXISTS (
          SELECT 1 FROM menu_accesses target
          WHERE target.menu_id = source.menu_id
            AND target.role IS NOT DISTINCT FROM
              CASE WHEN source.role::text = 'ALL' THEN NULL ELSE source.role END
            AND target.section IS NOT DISTINCT FROM source.section
        )
      `);
    }

    await tx.$executeRawUnsafe(`
      DELETE FROM menu_accesses duplicate
      USING menu_accesses keeper
      WHERE duplicate.id::text > keeper.id::text
        AND duplicate.menu_id = keeper.menu_id
        AND duplicate.role IS NOT DISTINCT FROM keeper.role
        AND duplicate.section IS NOT DISTINCT FROM keeper.section
    `);

    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_accesses_global_unique
      ON menu_accesses(menu_id, role)
      WHERE section IS NULL
    `);
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_accesses_all_roles_section_unique
      ON menu_accesses(menu_id, section)
      WHERE role IS NULL AND section IS NOT NULL
    `);
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_accesses_all_roles_all_sections_unique
      ON menu_accesses(menu_id)
      WHERE role IS NULL AND section IS NULL
    `);
    await tx.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS menu_accesses_role_section_idx
      ON menu_accesses(role, section)
    `);
    await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS menu_items_role_section_idx`);
    await tx.$executeRawUnsafe(`ALTER TABLE menu_items DROP COLUMN IF EXISTS role`);
    await tx.$executeRawUnsafe(`ALTER TABLE menu_items DROP COLUMN IF EXISTS section`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS menu_items_menu_id_idx ON menu_items(menu_id)`);
  });

  process.stdout.write('Menu access migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
