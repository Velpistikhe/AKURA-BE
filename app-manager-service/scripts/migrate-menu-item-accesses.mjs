import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'menu_accesses'
  `);
  const columnNames = new Set(columns.map(({ columnName }) => columnName));

  await prisma.$transaction(async (tx) => {
    if (columnNames.has('menu_id')) {
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS menu_accesses_item_new`);
      await tx.$executeRawUnsafe(`
        CREATE TABLE menu_accesses_item_new (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
          role user_role NULL,
          section user_section NULL,
          created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT menu_accesses_item_new_menu_item_role_section_key
            UNIQUE (menu_item_id, role, section)
        )
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO menu_accesses_item_new (menu_item_id, role, section, created_at, updated_at)
        SELECT item.id, access.role, access.section, access.created_at, access.updated_at
        FROM menu_accesses access
        INNER JOIN menu_items item ON item.menu_id = access.menu_id
        ON CONFLICT (menu_item_id, role, section) DO NOTHING
      `);
      await tx.$executeRawUnsafe(`DROP TABLE menu_accesses`);
      await tx.$executeRawUnsafe(`ALTER TABLE menu_accesses_item_new RENAME TO menu_accesses`);
      await tx.$executeRawUnsafe(`
        ALTER TABLE menu_accesses
        RENAME CONSTRAINT menu_accesses_item_new_menu_item_role_section_key
        TO menu_accesses_menu_item_id_role_section_key
      `);
    } else if (!columnNames.has('menu_item_id')) {
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS menu_accesses (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
          role user_role NULL,
          section user_section NULL,
          created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT menu_accesses_menu_item_id_role_section_key
            UNIQUE (menu_item_id, role, section)
        )
      `);
    }

    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_accesses_global_unique
      ON menu_accesses(menu_item_id, role)
      WHERE section IS NULL AND role IS NOT NULL
    `);
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_accesses_all_roles_section_unique
      ON menu_accesses(menu_item_id, section)
      WHERE role IS NULL AND section IS NOT NULL
    `);
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_accesses_all_roles_all_sections_unique
      ON menu_accesses(menu_item_id)
      WHERE role IS NULL AND section IS NULL
    `);
    await tx.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS menu_accesses_role_section_idx
      ON menu_accesses(role, section)
    `);
  });

  process.stdout.write('Menu item access migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
