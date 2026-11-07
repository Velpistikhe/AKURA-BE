/**
 * CONCURRENCY - fieldservice-service.
 *
 * Covers the work order identity allocation:
 *   - concurrent work order creation allocates distinct, gapless numbers
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gatewayIdentityHeaders, loginAs, query, seedOfficeBranch, seedUser } from './support/fixtures.js';
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
