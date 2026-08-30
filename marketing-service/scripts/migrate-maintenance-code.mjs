import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'maintenances'
          AND column_name = 'code'
      ) THEN
        ALTER TABLE maintenances ALTER COLUMN code DROP NOT NULL;
      END IF;
    END $$
  `);
  process.stdout.write('Maintenance code migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
