import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

await prisma.$executeRawUnsafe(`ALTER TYPE user_section ADD VALUE IF NOT EXISTS 'FINANCE'`)
  .finally(() => prisma.$disconnect());

process.stdout.write('UserSection.FINANCE is available in the App Manager database\n');
