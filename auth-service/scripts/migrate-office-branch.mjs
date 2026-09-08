import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "office_branch_id" UUID
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "users_office_branch_id_idx"
    ON "users" ("office_branch_id")
  `);
  process.stdout.write('User office_branch_id is ready\n');
} finally {
  await prisma.$disconnect();
}
