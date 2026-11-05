/**
 * Read-only inspection of the column names of a test database.
 *
 * Prisma maps model fields to snake_case table columns, but not always: some
 * models keep the camelCase name. The assertions in the suite are written
 * against real column names, so this script reports what exists.
 *
 * Usage: node inspect-columns.mjs <database> [table ...]
 */
import { PrismaClient } from '@prisma/client';

const LOCAL = /^postgresql:\/\/[^@]+@127\.0\.0\.1:5432\/[A-Za-z0-9_]+\?schema=public$/;
const [database, ...tables] = process.argv.slice(2);

if (!database) {
  console.error('Usage: node inspect-columns.mjs <database> [table ...]');
  process.exit(1);
}

const url = `postgresql://postgres:admin@127.0.0.1:5432/${database}?schema=public`;
if (!LOCAL.test(url)) {
  console.error(`Refusing to inspect a non-local database: ${database}`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: url });
try {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  for (const row of rows) {
    if (tables.length && !tables.includes(row.table_name)) continue;
    console.log(`${row.table_name}.${row.column_name} ${row.data_type}`);
  }
} finally {
  await prisma.$disconnect();
}
