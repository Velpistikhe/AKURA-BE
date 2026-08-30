import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE items DROP COLUMN IF EXISTS code');
  process.stdout.write('Item code migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
