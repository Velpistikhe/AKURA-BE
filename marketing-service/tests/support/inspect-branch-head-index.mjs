/**
 * Read-only inspection of the index definitions that back the single-head
 * office branch invariant.
 *
 * The Prisma schema documents a partial unique index for `is_head`, but a
 * plain `db push` does not create it, because Prisma cannot express a partial
 * index in the schema language. This script reports what actually exists in a
 * database so the audit can compare the schema with the deployment.
 *
 * Usage: node inspect-branch-head-index.mjs [database ...]
 */
import { PrismaClient } from '@prisma/client';

const LOCAL = /^postgresql:\/\/[^@]+@127\.0\.0\.1:5432\/[A-Za-z0-9_]+\?schema=public$/;
const databases = process.argv.slice(2);

if (!databases.length) {
  console.error('Usage: node inspect-branch-head-index.mjs <database> [...]');
  process.exit(1);
}

for (const database of databases) {
  const url = `postgresql://postgres:admin@127.0.0.1:5432/${database}?schema=public`;
  if (!LOCAL.test(url)) {
    console.error(`Refusing to inspect a non-local database: ${database}`);
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const indexes = await prisma.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'office_branches'`,
    );
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS heads FROM office_branches WHERE is_head = true`,
    );
    console.log(`=== ${database} ===`);
    console.log(`indexes: ${JSON.stringify(indexes)}`);
    console.log(`head rows: ${rows[0]?.heads ?? 0}`);
  } catch (error) {
    console.error(`${database}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  } finally {
    await prisma.$disconnect();
  }
}
