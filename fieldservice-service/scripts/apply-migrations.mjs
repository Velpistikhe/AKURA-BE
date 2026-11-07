/**
 * Applies the hand-written SQL migrations in `prisma/sql/`.
 *
 * These migrations carry the schema changes that must run against an existing
 * database, such as dropping the inspector user ID column. The Prisma schema
 * is the source of truth for the model definitions; `prisma db push` applies
 * it, and this script applies the SQL files that go with it.
 *
 * Safety rules:
 *   - the target database must be on 127.0.0.1; a remote host is refused
 *   - every migration file must be idempotent
 *
 * Usage: npm run db:migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDirectory = resolve(here, '..', 'prisma', 'sql');

/** The database URL may come from the environment or from the service .env file. */
const loadDatabaseUrl = async () => {
  const fromEnvironment = process.env.DATABASE_URL;
  if (fromEnvironment) return fromEnvironment;
  const envFile = resolve(here, '..', '.env');
  const content = await readFile(envFile, 'utf8');
  const match = content.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (!match) throw new Error('DATABASE_URL is not set and could not be read from .env');
  return match[1].trim().replace(/^["']|["']$/g, '');
};

const databaseUrl = await loadDatabaseUrl();

/**
 * Splits a SQL file into single statements.
 *
 * Prisma sends a prepared statement, and PostgreSQL accepts only one command
 * per prepared statement. The split must not cut inside a dollar-quoted
 * string, so the dollar-quoted blocks are copied over as a whole.
 */
const splitStatements = (sql) => {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];

    if (inDollarQuote) {
      current += character;
      if (character === '$' && sql.startsWith(dollarTag, index)) {
        current += sql.slice(index + 1, index + dollarTag.length);
        index += dollarTag.length - 1;
        inDollarQuote = false;
        dollarTag = '';
      }
      continue;
    }

    // A dollar-quoted block starts with a tag such as `$$` or `$body$`.
    const dollarMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
    if (dollarMatch) {
      dollarTag = dollarMatch[0];
      inDollarQuote = true;
      current += dollarTag;
      index += dollarTag.length - 1;
      continue;
    }

    if (character === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }

    current += character;
  }

  const last = current.trim();
  if (last) statements.push(last);

  return statements;
};

/**
 * Refuses any database that is not on the local machine. The migrations are
 * safe to run locally, but a production change must go through an explicit
 * review.
 */
const assertLocalDatabase = (url) => {
  const parsed = new URL(url);
  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `Refusing to run the migrations against the remote database "${host}". `
      + 'Run them against the local database, or apply the SQL manually after a review.',
    );
  }
};

assertLocalDatabase(databaseUrl);

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  const entries = await readdir(sqlDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  if (!files.length) {
    console.log('No migrations to apply.');
  }

  for (const file of files) {
    const sql = await readFile(resolve(sqlDirectory, file), 'utf8');
    console.log(`Applying ${file}`);
    // The migration files are written to be idempotent, so they can be
    // replayed safely. Prisma sends a prepared statement, which accepts one
    // command at a time, so the file is split on the statement terminator.
    for (const statement of splitStatements(sql)) {
      await prisma.$executeRawUnsafe(statement);
    }
    console.log(`Applied  ${file}`);
  }

  // Report the columns of the migrated table, so the operator can see the
  // result without querying the database by hand.
  const columns = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'work_order_inspectors' ORDER BY column_name`,
  );
  console.log('work_order_inspectors columns:', columns.map((column) => column.column_name).join(', '));
} finally {
  await prisma.$disconnect();
}
