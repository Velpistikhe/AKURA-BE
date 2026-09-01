import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe(`ALTER TABLE services DROP COLUMN IF EXISTS code`);
  process.stdout.write('Service code column removed\n');
} finally {
  await prisma.$disconnect();
}
