/**
 * Akura reliability test harness - environment guard.
 *
 * HARD RULE: this suite must never talk to a production or remote database.
 * Every database URL the suite uses must point at 127.0.0.1 / localhost, and
 * every database name must carry the dedicated test suffix. The guard fails
 * fast (process exit) instead of skipping, because a false "skipped" result
 * would be indistinguishable from a real pass in the report.
 *
 * The guard runs before any service module is imported, so an unsafe
 * DATABASE_URL can never reach a Prisma client.
 */
import { resolve } from 'node:path';

export const TEST_DB_SUFFIX = '_test';
export const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Database name -> dedicated test database on the local PostgreSQL instance. */
export const TEST_DATABASES = {
  auth: 'akura_test_auth',
  appManager: 'akura_test_app_manager',
  marketing: 'akura_test_marketing',
  finance: 'akura_test_finance',
  fieldservice: 'akura_test_fieldservice',
} as const;

/** The only database names this suite is ever allowed to touch. */
export const ALLOWED_TEST_DATABASES: ReadonlySet<string> = new Set(Object.values(TEST_DATABASES));

export type ServiceName = keyof typeof TEST_DATABASES;

/** Test ports, deliberately offset from the development ports (5000-5005). */
export const TEST_PORTS = {
  gateway: 5100,
  auth: 5101,
  appManager: 5102,
  marketing: 5103,
  finance: 5104,
  fieldservice: 5105,
} as const;

const PG_USER = 'postgres';
const PG_PASSWORD = 'admin';
const PG_PORT = '5432';

export const localDatabaseUrl = (service: ServiceName): string =>
  `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${TEST_DATABASES[service]}?schema=public`;

export const localAdminUrl = (): string =>
  `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres?schema=public`;

export const localGatewayUrl = (): string => `http://127.0.0.1:${TEST_PORTS.gateway}`;

export class UnsafeTestEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTestEnvironmentError';
  }
}

/**
 * Verifies that `url` is a local PostgreSQL URL pointing at a dedicated test
 * database. Throws UnsafeTestEnvironmentError when it is not.
 */
export const assertLocalTestDatabase = (url: string, label: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTestEnvironmentError(`${label}: DATABASE_URL is not a valid URL`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new UnsafeTestEnvironmentError(`${label}: DATABASE_URL must use the postgresql protocol`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new UnsafeTestEnvironmentError(
      `${label}: refusing to use remote database host "${parsed.hostname}". The reliability suite only runs against local PostgreSQL.`,
    );
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (!ALLOWED_TEST_DATABASES.has(database)) {
    throw new UnsafeTestEnvironmentError(
      `${label}: database "${database}" is not a dedicated test database of this suite. ` +
      `Allowed: ${[...ALLOWED_TEST_DATABASES].join(', ')}. The suite refuses to touch any other database.`,
    );
  }
};

/**
 * Asserts that no configured service URL points at a deployed (production)
 * host. Every hop in the test topology must stay on 127.0.0.1.
 */
export const assertLocalServiceUrl = (url: string, label: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTestEnvironmentError(`${label}: "${url}" is not a valid URL`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new UnsafeTestEnvironmentError(
      `${label}: refusing to use non-local service host "${parsed.hostname}". The suite must not call production or staging services.`,
    );
  }
};

/**
 * Asserts that the environment variable set on `process.env` does not point at
 * a remote database. Called by the harness before any service is started.
 */
export const assertProcessEnvIsLocal = (label: string): void => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) assertLocalTestDatabase(databaseUrl, `${label}.DATABASE_URL`);
  const gatewayUrl = process.env.API_GATEWAY_URL;
  if (gatewayUrl) assertLocalServiceUrl(gatewayUrl, `${label}.API_GATEWAY_URL`);
  const deliveryTargets = process.env.TAX_DELIVERY_TARGETS;
  if (deliveryTargets) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(deliveryTargets);
    } catch {
      throw new UnsafeTestEnvironmentError(`${label}.TAX_DELIVERY_TARGETS is not valid JSON`);
    }
    for (const target of parsed as Array<{ name: string; url: string }>) {
      assertLocalServiceUrl(target.url, `${label}.TAX_DELIVERY_TARGETS[${target.name}]`);
    }
  }
};

/**
 * Directory that contains a service's package.json, used to run npm commands
 * inside the service folder (Akura has no root package.json).
 */
export const serviceDir = (service: string): string => resolve(process.cwd(), '..', service);
