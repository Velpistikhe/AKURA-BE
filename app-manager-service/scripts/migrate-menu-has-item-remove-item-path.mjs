import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE menus ADD COLUMN IF NOT EXISTS has_item boolean NOT NULL DEFAULT false`);
    await tx.$executeRawUnsafe(`
      UPDATE menus menu
      SET has_item = true
      WHERE EXISTS (SELECT 1 FROM menu_items item WHERE item.menu_id = menu.id)
    `);
    await tx.$executeRawUnsafe(`ALTER TABLE menu_items DROP COLUMN IF EXISTS path`);
  });
  process.stdout.write('Menu has_item added and menu_items.path removed\n');
} finally {
  await prisma.$disconnect();
}
