import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const columns = await prisma.$queryRaw`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'services'
      AND column_name IN ('has_service', 'has_maintenance')
  `;
  const columnNames = new Set(columns.map(({ columnName }) => columnName));

  if (columnNames.has('has_service') && columnNames.has('has_maintenance')) {
    throw new Error('Both services.has_service and services.has_maintenance exist; resolve the duplicate columns before migrating');
  }
  if (columnNames.has('has_service')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE services RENAME COLUMN has_service TO has_maintenance`);
  } else if (!columnNames.has('has_maintenance')) {
    throw new Error('Neither services.has_service nor services.has_maintenance was found');
  }

  process.stdout.write('Service has_service renamed to has_maintenance\n');
} finally {
  await prisma.$disconnect();
}
