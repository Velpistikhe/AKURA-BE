/**
 * Read-only inspection of a row from a test database.
 *
 * Usage: node inspect-row.mjs <database> <sql>
 */
import { PrismaClient } from '@prisma/client';

const LOCAL = /^postgresql:\/\/[^@]+@127\.0\.0\.1:5432\/[A-Za-z0-9_]+\?schema=public$/;
const [database, sql] = process.argv.slice(2);

if (!database || !sql) {
  console.error('Usage: node inspect-row.mjs <database> <sql>');
  process.exit(1);
}

const url = `postgresql://postgres:admin@127.0.0.1:5432/${database}?schema=public`;
if (!LOCAL.test(url)) {
  console.error(`Refusing to inspect a non-local database: ${database}`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: url });
try {
  const rows = await prisma.$queryRawUnsafe(sql);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await prisma.$disconnect();
}
