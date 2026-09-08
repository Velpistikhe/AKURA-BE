import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF to_regclass('office_branches') IS NULL AND to_regclass('offices') IS NOT NULL THEN
          ALTER TABLE "offices" RENAME TO "office_branches";
        END IF;
      END $$
    `);
    await tx.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "office_branches" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "name" TEXT NOT NULL,
        "address" TEXT NOT NULL,
        "telp" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "is_head" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "office_branches_pkey" PRIMARY KEY ("id")
      )
    `);
    await tx.$executeRawUnsafe(`ALTER TABLE "office_branches" ADD COLUMN IF NOT EXISTS "is_head" BOOLEAN NOT NULL DEFAULT false`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "office_branches_one_head_idx" ON "office_branches" ("is_head") WHERE "is_head" = true`);
  });
  process.stdout.write('Office branches table is ready\n');
} finally {
  await prisma.$disconnect();
}
