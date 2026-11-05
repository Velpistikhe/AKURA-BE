/**
 * CONCURRENCY - fieldservice-service.
 *
 * Covers the work order identity allocation and the user read-model
 * synchronisation:
 *   - concurrent work order creation allocates distinct, gapless numbers
 *   - the user sync event is idempotent and rejects an outdated version
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { query, seedOfficeBranch } from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import { TEST_PORTS } from './support/env.js';
import { TEST_GATEWAY_SECRETS, TEST_USER_SYNC_SECRET } from './support/harness.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

const FIELDSERVICE = `http://127.0.0.1:${TEST_PORTS.fieldservice}`;
const FIELDSERVICE_HEADERS = { 'x-gateway-secret': TEST_GATEWAY_SECRETS.fieldservice };

let fieldservice: ServiceProcess;

let branchId: string;

/** Builds a valid FIELD_SERVICE user read-model event. */
const userEvent = (version: number, overrides: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  officeBranchId: branchId,
  version,
  user: {
    id: randomUUID(),
    username: `reltest_field_${randomUUID().slice(0, 8)}`,
    firstName: 'Rel',
    lastName: 'Test',
    email: 'rel@reltest.local',
    telp: '0000',
    role: 'USER',
    section: 'FIELD_SERVICE',
    officeBranchId: branchId,
    isActive: true,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  },
});

describe('fieldservice-service concurrency', () => {
  // Every test starts from an empty field-service database.
  resetBeforeEach(['fieldservice']);

  before(async () => {
    await ensureDatabases();
    fieldservice = await startService('fieldservice');
  });

  after(async () => {
    await fieldservice?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
  });

  test('NUMBER ALLOCATION: concurrent work order identities are unique and gapless', async () => {
    // The allocation helper is the code path under test: it locks the
    // branch/year sequence and hands out the next number. It lives in the
    // field-service source tree, so it is imported by absolute path.
    // `import.meta` is not available because the package resolves to
    // CommonJS, so the path is built with node:path instead.
    const { pathToFileURL } = await import('node:url');
    const { resolve } = await import('node:path');
    const { nextWorkOrderIdentity } = await import(pathToFileURL(
      resolve(process.cwd(), '..', 'fieldservice-service', 'src', 'modules', 'work-orders', 'work-order-number.js'),
    ).href);
    const { PrismaClient } = await import('@prisma/client');
    const { localDatabaseUrl } = await import('./support/env.js');

    const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl('fieldservice') });
    try {
      const TOTAL = 5;
      const identities = await Promise.all(Array.from({ length: TOTAL }, async () => {
        // Each transaction is independent, exactly like a concurrent request.
        return prisma.$transaction(async (tx) => {
          const identity = await nextWorkOrderIdentity(tx, branchId);
          return identity.number;
        });
      }));

      const unique = new Set(identities);
      assert.equal(unique.size, TOTAL, `numbers must be unique, got ${identities.join(', ')}`);

      // The numbers are formatted "WO/<year>/<counter>"; compare the counters.
      const counters = identities
        .map((number) => Number.parseInt(number.split('/').pop() ?? '', 10))
        .sort((a, b) => a - b);
      assert.ok(counters.every(Number.isInteger), `every number must be parsable, got ${identities.join(', ')}`);
      const expected = counters.map((_, index) => counters[0] + index);
      assert.deepEqual(counters, expected, `numbers must be gapless, got ${counters.join(', ')}`);

      // The sequence counter must match the highest allocated number.
      const rows = await query<{ last_number: number }>(
        'fieldservice',
        'SELECT last_number FROM work_order_sequences WHERE office_branch_id = $1::uuid AND year = $2',
        branchId,
        new Date().getUTCFullYear(),
      );
      assert.equal(rows[0]?.last_number, counters[counters.length - 1], 'the sequence counter must match the last number');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('IDEMPOTENCY: the same user event applied twice keeps one read-model row', async () => {
    const event = userEvent(1);
    const send = async () => httpRequest(`${FIELDSERVICE}/internal/users/events`, {
      method: 'POST',
      headers: { ...FIELDSERVICE_HEADERS, 'x-user-sync-secret': TEST_USER_SYNC_SECRET },
      body: event,
    });

    const first = await send();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await send();
    assert.equal(second.status, 200, JSON.stringify(second.body));

    const rows = await query<{ count: number }>(
      'fieldservice',
      'SELECT count(*)::int AS count FROM field_service_users WHERE id = $1::uuid',
      event.user.id,
    );
    assert.equal(rows[0]?.count, 1, 'a repeated event must not duplicate the read-model row');
  });

  test('VERSION GUARD: an older user event must not overwrite a newer one', async () => {
    const userId = randomUUID();
    const base = {
      id: userId,
      username: `reltest_field_${randomUUID().slice(0, 8)}`,
      firstName: 'Rel',
      lastName: 'Test',
      email: 'rel@reltest.local',
      telp: '0000',
      role: 'USER',
      section: 'FIELD_SERVICE',
      officeBranchId: branchId,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const send = async (version: number, firstName: string) => httpRequest(`${FIELDSERVICE}/internal/users/events`, {
      method: 'POST',
      headers: { ...FIELDSERVICE_HEADERS, 'x-user-sync-secret': TEST_USER_SYNC_SECRET },
      body: {
        eventId: randomUUID(),
        officeBranchId: branchId,
        version,
        user: { ...base, version, firstName },
      },
    });

    assert.equal((await send(5, 'Newer')).status, 200);
    assert.equal((await send(3, 'Older')).status, 200);

    const rows = await query<{ user: string | { firstName: string; version: number }; source_version: number }>(
      'fieldservice',
      // "user" is a reserved word in PostgreSQL, so the column must be quoted.
      'SELECT "user", source_version FROM field_service_users WHERE id = $1::uuid',
      userId,
    );
    assert.equal(rows.length, 1, 'exactly one read-model row must exist');
    assert.equal(rows[0].source_version, 5, 'the newer version must be kept');
    // A raw query returns the JSONB document as text; normalize it first.
    const snapshot = typeof rows[0].user === 'string'
      ? JSON.parse(rows[0].user) as { firstName: string; version: number }
      : rows[0].user;
    assert.equal(snapshot.firstName, 'Newer', 'an older event must not overwrite newer data');
    assert.equal(snapshot.version, 5, 'the stored snapshot must carry the newer version');
  });

  test('SECURITY: a user event without the delivery secret is rejected with 403', async () => {
    const response = await httpRequest(`${FIELDSERVICE}/internal/users/events`, {
      method: 'POST',
      headers: FIELDSERVICE_HEADERS,
      body: userEvent(1),
    });
    assert.equal(response.status, 403);
  });
});
