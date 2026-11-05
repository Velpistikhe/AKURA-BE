/**
 * CONCURRENCY - fieldservice-service.
 *
 * Covers the work order identity allocation and the live Auth validation of
 * the inspectors:
 *   - concurrent work order creation allocates distinct, gapless numbers
 *   - the inspector directory is read live from Auth, never from a local
 *     replica, so a deactivated user disappears from the options at once
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GATEWAY, gatewayIdentityHeaders, loginAs, query, seedOfficeBranch, seedUser } from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import { TEST_PORTS } from './support/env.js';
import { TEST_GATEWAY_SECRETS } from './support/harness.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let fieldservice: ServiceProcess;
let gateway: ServiceProcess;

let branchId: string;

/** Reads the inspector directory of the branch straight from Auth. */
const authInspectorDirectory = async (token: string) => {
  const response = await httpRequest(`${GATEWAY}/api/v1/auth/users/field-service/inspector-directory`, { token });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return (response.body as { data: { inspectors: Array<{ id: string; firstName: string; lastName: string }> } }).data.inspectors;
};

describe('fieldservice-service concurrency', () => {
  // Every test starts from an empty field-service database.
  resetBeforeEach(['fieldservice']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    fieldservice = await startService('fieldservice');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, fieldservice, auth]) await process_?.stop();
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

  test('LIVE DIRECTORY: the inspector options are read from Auth, not from a local replica', async () => {
    const inspector = await seedUser({ role: 'USER', section: 'FIELD_SERVICE', officeBranchId: branchId });
    const token = await loginAs(inspector);

    // Auth lists the inspector of the caller branch.
    const directory = await authInspectorDirectory(token);
    assert.ok(
      directory.some((entry) => entry.id === inspector.id),
      'Auth must list the active inspector of the branch',
    );

    // Field Service exposes the same inspector through its options endpoint,
    // read live from Auth.
    const options = await httpRequest(`${GATEWAY}/api/v1/fieldservice/options/inspectors`, { token });
    assert.equal(options.status, 200, JSON.stringify(options.body));
    const inspectors = (options.body as { data: { inspectors: Array<{ id: string; firstName: string; lastName: string }> } }).data.inspectors;
    const entry = inspectors.find((row) => row.id === inspector.id);
    assert.ok(entry, 'the inspector options must contain the Auth user');
    assert.equal(entry.firstName, 'Rel');
    assert.equal(entry.lastName, 'Test');
  });

  test('LIVE DIRECTORY: a deactivated inspector leaves the options immediately', async () => {
    // The reader is a separate account: deactivating the inspector must not
    // deactivate the caller, or the call itself would fail with 403.
    const inspector = await seedUser({ role: 'USER', section: 'FIELD_SERVICE', officeBranchId: branchId });
    const reader = await seedUser({ role: 'USER', section: 'FIELD_SERVICE', officeBranchId: branchId });
    const token = await loginAs(reader);

    const before = await httpRequest(`${GATEWAY}/api/v1/fieldservice/options/inspectors`, { token });
    assert.equal(before.status, 200, JSON.stringify(before.body));
    const listed = (before.body as { data: { inspectors: Array<{ id: string }> } }).data.inspectors;
    assert.ok(listed.some((row) => row.id === inspector.id));

    // Auth is the source of truth: deactivating the user removes it from the
    // directory right away, because nothing is replicated any more.
    await query('auth',
      'UPDATE users SET is_active = false WHERE id = $1::uuid',
      inspector.id);

    const after = await httpRequest(`${GATEWAY}/api/v1/fieldservice/options/inspectors`, { token });
    assert.equal(after.status, 200, JSON.stringify(after.body));
    const remaining = (after.body as { data: { inspectors: Array<{ id: string }> } }).data.inspectors;
    assert.ok(
      !remaining.some((row) => row.id === inspector.id),
      'a deactivated user must not appear in the inspector options',
    );
  });

  test('SECURITY: the removed user event endpoint is no longer mounted', async () => {
    const inspector = await seedUser({ role: 'USER', section: 'FIELD_SERVICE', officeBranchId: branchId });
    const token = await loginAs(inspector);
    // The caller is authenticated, so the request reaches the routing table
    // and the service answers with its own 404.
    const response = await httpRequest(
      `http://127.0.0.1:${TEST_PORTS.fieldservice}/internal/users/events`,
      {
        method: 'POST',
        token,
        headers: {
          'x-gateway-secret': TEST_GATEWAY_SECRETS.fieldservice,
          ...gatewayIdentityHeaders(inspector),
        },
        body: { eventId: randomUUID() },
      },
    );
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
});
