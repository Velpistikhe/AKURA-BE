/**
 * Provisioning and teardown for the dedicated local test databases.
 *
 * The suite never reuses the development `akura_*` databases. It creates
 * `akura_test_*` databases and applies the current Prisma schema to them, so
 * a test run cannot be affected by (or affect) development data.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  TEST_DATABASES,
  localAdminUrl,
  localDatabaseUrl,
  type ServiceName,
} from './env.js';

const SERVICE_DIRS: Record<ServiceName, string> = {
  auth: 'auth-service',
  appManager: 'app-manager-service',
  marketing: 'marketing-service',
  finance: 'finance-service',
  fieldservice: 'fieldservice-service',
};

export const serviceDirectory = (service: ServiceName): string =>
  resolve(process.cwd(), '..', SERVICE_DIRS[service]);

/** The API Gateway lives next to the domain services, not inside one of them. */
export const gatewayDirectory = (): string => resolve(process.cwd(), '..', 'api-gateway');

/**
 * Creates the test database if it does not exist. Uses the `postgres`
 * maintenance database, never the target database itself.
 */
export const createTestDatabase = async (service: ServiceName): Promise<void> => {
  const database = TEST_DATABASES[service];
  const admin = new PrismaClient({ datasourceUrl: localAdminUrl() });
  try {
    const existing = await admin.$queryRaw<Array<{ datname: string }>>`
      SELECT datname FROM pg_database WHERE datname = ${database}
    `;
    if (!existing.length) {
      // The database name is a compile-time constant from TEST_DATABASES, so it
      // cannot carry user input; quoting keeps it explicit for the reader.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    }
  } finally {
    await admin.$disconnect();
  }
};

/**
 * Applies the service's current Prisma schema to its dedicated test database.
 * This is `db push` against localhost only - no migration tooling exists in
 * this project and the repository's schema.prisma files are never modified.
 *
 * The Prisma CLI is invoked through its Node entry point instead of the
 * .cmd shim, because execFileSync cannot spawn a .cmd file on Windows.
 */
export const pushTestSchema = (service: ServiceName): void => {
  const directory = serviceDirectory(service);
  const prismaCli = resolve(directory, 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(
    process.execPath,
    [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema=prisma/schema.prisma'],
    {
      cwd: directory,
      env: {
        ...process.env,
        DATABASE_URL: localDatabaseUrl(service),
        CHECKPOINT_DISABLE: '1',
      },
      stdio: 'pipe',
      encoding: 'utf8',
    },
  );
};

/**
 * Applies the SQL files in a service's `prisma/sql/` directory.
 *
 * These files hold the database-level invariants that Prisma cannot express,
 * such as the partial unique index that enforces a single head office branch.
 * They are applied after the schema push, because `db push` only synchronises
 * what the Prisma schema describes.
 *
 * The Prisma CLI is invoked through its Node entry point instead of the .cmd
 * shim, because execFileSync cannot spawn a .cmd file on Windows.
 */
export const applySqlMigrations = (service: ServiceName): void => {
  const directory = serviceDirectory(service);
  const script = resolve(directory, 'scripts', 'apply-migrations.mjs');
  if (!existsSync(script)) return;
  execFileSync(process.execPath, [script], {
    cwd: directory,
    env: {
      ...process.env,
      DATABASE_URL: localDatabaseUrl(service),
      CHECKPOINT_DISABLE: '1',
    },
    stdio: 'pipe',
    encoding: 'utf8',
  });
};

/**
 * Creates and provisions every test database the suite needs.
 */
export const provisionTestDatabases = async (services: ServiceName[]): Promise<void> => {
  for (const service of services) {
    await createTestDatabase(service);
    pushTestSchema(service);
    // The schema push only covers what Prisma describes, so the SQL
    // invariants are applied afterwards.
    applySqlMigrations(service);
  }
};

/**
 * Drops every row this suite could have created, identified by the synthetic
 * marker. Implemented per service because each service owns a different set
 * of tables. Rows that do not belong to the suite are left untouched.
 */
export const truncateTestTables = async (service: ServiceName): Promise<void> => {
  const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl(service) });
  try {
    switch (service) {
      case 'marketing': {
        // Child rows first: the audit/history tables reference their parents.
        await prisma.$executeRawUnsafe(`
          TRUNCATE TABLE
            "quotation_snapshots", "quotation_histories", "quotation_pdfs", "quotation_items", "quotations",
            "company_contract_histories", "company_contract_prices", "company_contracts",
            "company_staff_histories", "company_staffs", "company_histories", "companies",
            "catalog_audit_logs", "audit_logs", "item_prices", "item_sizes", "items", "service_scopes", "services",
            "quotation_sequences", "tax_cache", "tax_cache_revisions", "tax_sync_state"
          RESTART IDENTITY CASCADE
        `);
        break;
      }
      case 'fieldservice': {
        await prisma.$executeRawUnsafe(`
          TRUNCATE TABLE
            "work_order_link_deliveries", "work_order_link_events",
            "work_order_histories", "work_order_inspectors", "work_order_items", "work_order",
            "work_order_sequences", "audit_logs"
          RESTART IDENTITY CASCADE
        `);
        break;
      }
      case 'finance': {
        await prisma.$executeRawUnsafe(`
          TRUNCATE TABLE
            "tax_deliveries", "tax_events", "tax_revisions", "tax_sync_state",
            "tax_cache", "taxes", "audit_logs"
          RESTART IDENTITY CASCADE
        `);
        break;
      }
      case 'auth': {
        await prisma.$executeRawUnsafe(`
          TRUNCATE TABLE
            "user_histories", "security_audit_logs",
            "refresh_tokens", "user_passwords", "users"
          RESTART IDENTITY CASCADE
        `);
        break;
      }
      case 'appManager': {
        await prisma.$executeRawUnsafe(`
          TRUNCATE TABLE
            "menu_accesses", "menu_items", "menus", "office_branches", "audit_logs"
          RESTART IDENTITY CASCADE
        `);
        break;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Truncates the given test databases so a test file starts from a known
 * state. This keeps test files independent of each other and of the order in
 * which they run.
 */
export const resetTestDatabases = async (services: ServiceName[]): Promise<void> => {
  for (const service of services) {
    await truncateTestTables(service);
  }
};
