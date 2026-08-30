import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF to_regclass('company_staff') IS NOT NULL
        AND to_regclass('company_staffs') IS NULL THEN
        ALTER TABLE company_staff RENAME TO company_staffs;
      END IF;
    END $$;
  `);

  process.stdout.write('PostgreSQL naming migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
