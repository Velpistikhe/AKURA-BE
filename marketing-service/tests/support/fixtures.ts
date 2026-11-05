/**
 * Synthetic fixtures for the reliability suite.
 *
 * Fixtures are created through the real HTTP API wherever possible, so the
 * suite exercises the same code paths a client would. Anything that cannot be
 * reached over HTTP (an office branch assignment, a tax row in the consumer
 * cache) is seeded directly through Prisma with a synthetic identifier.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { localDatabaseUrl, type ServiceName } from './env.js';
import { httpRequest, TEST_PASSWORD, syntheticName, syntheticUsername } from './http.js';
import { TEST_PORTS } from './env.js';

export const GATEWAY = `http://127.0.0.1:${TEST_PORTS.gateway}`;

export interface SeededUser {
  id: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'USER' | 'APP_MANAGER';
  section: 'MARKETING' | 'FINANCE' | 'FIELD_SERVICE' | 'ACCOUNTING' | 'HRD_MANAGEMENT';
  officeBranchId: string;
  accessToken: string;
}

/**
 * Registers a user through the public register endpoint and then promotes the
 * row to the required role/section/branch with Prisma.
 *
 * Registration is the only unauthenticated write path, so it is used to
 * create a genuinely new account; the role, section and branch assignment are
 * administration operations that require an existing administrator.
 */
export const seedUser = async (options: {
  role: SeededUser['role'];
  section: SeededUser['section'];
  officeBranchId: string;
  officeBranchName?: string;
}): Promise<SeededUser> => {
  const username = syntheticUsername();
  const password = TEST_PASSWORD;
  const response = await httpRequest(`${GATEWAY}/api/v1/auth/register`, {
    method: 'POST',
    body: {
      username,
      password,
      passwordConfirmation: password,
      firstName: 'Rel',
      lastName: 'Test',
      email: `${username}@reltest.local`,
      telp: '0000',
    },
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Failed to register test user ${username}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }

  const auth = new PrismaClient({ datasourceUrl: localDatabaseUrl('auth') });
  try {
    // The auth service owns the users table; the promotion is written with raw
    // SQL against the auth test database because the marketing Prisma client
    // does not know the auth models.
    const rows = await auth.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE users
         SET role = $1::user_role,
             section = $2::user_section,
             office_branch_id = $3::uuid,
             office_branch_name = $4,
             is_active = true
       WHERE normalize_username = $5
       RETURNING id`,
      options.role,
      options.section,
      options.officeBranchId,
      options.officeBranchName ?? 'RelTest Branch',
      username.toLowerCase(),
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`Registered user ${username} was not found in the users table`);
    return {
      id,
      username,
      password,
      firstName: 'Rel',
      lastName: 'Test',
      role: options.role,
      section: options.section,
      officeBranchId: options.officeBranchId,
      accessToken: '',
    };
  } finally {
    await auth.$disconnect();
  }
};

/**
 * Builds the identity headers the API Gateway adds to a proxied request.
 *
 * A direct call to a service bypasses the gateway, so the service cannot see
 * the identity the gateway would have rebuilt from the token. The authorize
 * guard compares those headers with the token payload, so a direct call must
 * present them explicitly.
 */
export const gatewayIdentityHeaders = (user: SeededUser): Record<string, string> => ({
  'x-user-id': user.id,
  'x-user-role': user.role,
  'x-user-section': user.section,
  'x-user-name': `${user.firstName} ${user.lastName}`,
  'x-office-branch-id': user.officeBranchId,
});

/** Logs a seeded user in and returns a fresh access token. */
export const loginAs = async (user: SeededUser): Promise<string> => {
  const response = await httpRequest(`${GATEWAY}/api/v1/auth/login`, {
    method: 'POST',
    body: { username: user.username, password: user.password },
  });
  // The login envelope carries the access token directly on `data`.
  const body = response.body as { data?: { accessToken?: string } };
  const token = body?.data?.accessToken;
  if (!token) {
    throw new Error(`Login failed for ${user.username}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  user.accessToken = token;
  return token;
};

/** Creates an office branch row directly; the branch is the tenant boundary. */
export const seedOfficeBranch = async (options: { isHead?: boolean } = {}): Promise<{ id: string; name: string }> => {
  const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl('appManager') });
  const name = syntheticName('BRANCH');
  const id = randomUUID();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO office_branches (id, name, address, telp, email, is_head, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, now(), now())`,
      id,
      name,
      'RelTest address',
      '0000',
      'reltest@example.local',
      options.isHead ?? false,
    );
    return { id, name };
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Seeds a tax row in the marketing tax cache. The cache is a consumer read
 * model fed by the finance service; a quotation cannot be created without a
 * tax for the branch and document date.
 */
export const seedMarketingTax = async (officeBranchId: string, percentage = 11): Promise<void> => {
  const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl('marketing') });
  try {
    const effectiveFrom = new Date(Date.now() - 86_400_000);
    await prisma.taxCache.create({
      data: {
        id: randomUUID(),
        officeBranchId,
        percentage: String(percentage),
        effectiveFrom,
        effectiveUntil: null,
        sourceUpdatedAt: new Date(),
      },
    });
    await prisma.taxCacheRevision.create({
      data: { officeBranchId, version: 1, eventId: randomUUID() },
    });
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Direct Prisma client for a test database, for assertions and cleanup.
 * Only the marketing schema is known to the generated client; other services
 * must be reached with raw SQL.
 */
export const prismaFor = (service: ServiceName): PrismaClient =>
  new PrismaClient({ datasourceUrl: localDatabaseUrl(service) });

/**
 * Runs a read-only query against a service test database.
 *
 * The generated Prisma client only knows the marketing models, so assertions
 * about the other services are expressed as SQL. The database is always one
 * of the dedicated local test databases.
 */
export const query = async <T = unknown>(
  service: ServiceName,
  sql: string,
  ...params: unknown[]
): Promise<T[]> => {
  const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl(service) });
  try {
    return await prisma.$queryRawUnsafe<T[]>(sql, ...params);
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Runs a write statement against a service test database.
 *
 * `query` uses `$queryRawUnsafe`, which is meant for reads. A write is
 * executed with `$executeRawUnsafe`, so a constraint violation is reported as
 * a rejected promise instead of being swallowed.
 */
export const execute = async (
  service: ServiceName,
  sql: string,
  ...params: unknown[]
): Promise<number> => {
  const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl(service) });
  try {
    return await prisma.$executeRawUnsafe(sql, ...params);
  } finally {
    await prisma.$disconnect();
  }
};

/** Reads a user row from the auth test database. */
export const authUser = async (id: string): Promise<{
  id: string;
  firstName: string;
  lastName: string;
  version: number;
  isActive: boolean;
} | undefined> => {
  const rows = await query<{
    id: string; first_name: string; last_name: string; version: number; is_active: boolean;
  }>(
    'auth',
    'SELECT id, first_name, last_name, version, is_active FROM users WHERE id = $1::uuid',
    id,
  );
  const row = rows[0];
  return row
    ? {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      version: row.version,
      isActive: row.is_active,
    }
    : undefined;
};

/** Counts user rows with the given normalized username. */
export const authUserCount = async (normalizeUsername: string): Promise<number> => {
  const rows = await query<{ count: number }>(
    'auth',
    'SELECT count(*)::int AS count FROM users WHERE normalize_username = $1',
    normalizeUsername,
  );
  return rows[0]?.count ?? 0;
};

/** Counts the non-revoked refresh tokens of a user. */
export const authActiveTokenCount = async (userId: string): Promise<number> => {
  const rows = await query<{ count: number }>(
    'auth',
    'SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id = $1::uuid AND is_revoked = false',
    userId,
  );
  return rows[0]?.count ?? 0;
};
