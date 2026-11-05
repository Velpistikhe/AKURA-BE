/**
 * EVENT SYNCHRONISATION - idempotency and version guards.
 *
 * The internal event endpoints of marketing-service receive deliveries from
 * auth-service (user read model), finance-service (tax cache) and
 * fieldservice-service (Work Order link state). Each endpoint must be
 * idempotent and must never apply an outdated event.
 *
 * These endpoints are protected by a shared secret and are not reachable
 * through the API Gateway with a user token, so the suite calls them
 * directly on the local service with the test secret.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  loginAs, prismaFor, seedMarketingTax, seedOfficeBranch, seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import { TEST_PORTS } from './support/env.js';
import { TEST_TAX_SYNC_SECRET, TEST_USER_SYNC_SECRET, TEST_GATEWAY_SECRETS } from './support/harness.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

const MARKETING = `http://127.0.0.1:${TEST_PORTS.marketing}`;

/**
 * The marketing service verifies the gateway secret before every route, so
 * direct calls to the internal endpoints must present it as well.
 */
const MARKETING_HEADERS = { 'x-gateway-secret': TEST_GATEWAY_SECRETS.marketing };

let auth: ServiceProcess;
let marketing: ServiceProcess;
let gateway: ServiceProcess;

let admin: SeededUser;
let branchId: string;

/** Builds a valid user read-model event for the current branch. */
const userEvent = (version: number, overrides: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  officeBranchId: branchId,
  version,
  user: {
    id: randomUUID(),
    username: `reltest_user_${randomUUID().slice(0, 8)}`,
    firstName: 'Rel',
    lastName: 'Test',
    email: 'rel@reltest.local',
    telp: '0000',
    role: 'ADMIN',
    section: 'MARKETING',
    officeBranchId: branchId,
    isActive: true,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  },
});

/** Builds a valid tax cache event for the current branch. */
const taxEvent = (version: number, percentage = '10') => ({
  eventId: randomUUID(),
  officeBranchId: branchId,
  version,
  taxes: [{
    id: randomUUID(),
    officeBranchId: branchId,
    percentage,
    effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
    effectiveUntil: null,
    updatedAt: new Date().toISOString(),
  }],
});

describe('marketing-service event synchronisation', () => {
  // Every test starts from an empty marketing database, so the version guards
  // are asserted against a known state.
  resetBeforeEach(['marketing']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    marketing = await startService('marketing');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, marketing, auth]) await process_?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    await seedMarketingTax(branchId);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
  });

  test('SECURITY: an event without the delivery secret is rejected with 403', async () => {
    const response = await httpRequest(`${MARKETING}/internal/users/events`, {
      method: 'POST',
      body: userEvent(1),
    });
    assert.equal(response.status, 403);
  });

  test('IDEMPOTENCY: the same user event applied twice keeps one row and one revision', async () => {
    const event = userEvent(1);
    const prisma = prismaFor('marketing');
    try {
      const first = await httpRequest(`${MARKETING}/internal/users/events`, {
        method: 'POST',
        headers: { ...MARKETING_HEADERS, 'x-user-sync-secret': TEST_USER_SYNC_SECRET },
        body: event,
      });
      assert.equal(first.status, 200, JSON.stringify(first.body));

      const second = await httpRequest(`${MARKETING}/internal/users/events`, {
        method: 'POST',
        headers: { ...MARKETING_HEADERS, 'x-user-sync-secret': TEST_USER_SYNC_SECRET },
        body: event,
      });
      assert.equal(second.status, 200, JSON.stringify(second.body));

      const rows = await prisma.marketingAdminUser.count({ where: { id: event.user.id } });
      assert.equal(rows, 1, 'a repeated event must not duplicate the read-model row');

      const revision = await prisma.marketingUserSyncRevision.findUnique({
        where: { userId: event.user.id },
      });
      assert.equal(revision?.version, 1);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('SECURITY: an event with a wrong delivery secret is rejected with 403', async () => {
    const response = await httpRequest(`${MARKETING}/internal/users/events`, {
      method: 'POST',
      headers: { ...MARKETING_HEADERS, 'x-user-sync-secret': 'wrong-secret-value-that-is-long-enough-32' },
      body: userEvent(1),
    });
    assert.equal(response.status, 403);
  });

  test('VERSION GUARD: an older user event must not overwrite a newer one', async () => {
    const userId = randomUUID();
    const base = {
      id: userId,
      username: `reltest_user_${randomUUID().slice(0, 8)}`,
      firstName: 'Rel',
      lastName: 'Test',
      email: 'rel@reltest.local',
      telp: '0000',
      role: 'ADMIN',
      section: 'MARKETING',
      officeBranchId: branchId,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const send = async (version: number, firstName: string) => httpRequest(`${MARKETING}/internal/users/events`, {
      method: 'POST',
      headers: { ...MARKETING_HEADERS, 'x-user-sync-secret': TEST_USER_SYNC_SECRET },
      body: {
        eventId: randomUUID(),
        officeBranchId: branchId,
        version,
        user: { ...base, version, firstName },
      },
    });

    const newer = await send(5, 'Newer');
    assert.equal(newer.status, 200, JSON.stringify(newer.body));
    const older = await send(3, 'Older');
    assert.equal(older.status, 200, JSON.stringify(older.body));

    const prisma = prismaFor('marketing');
    try {
      const row = await prisma.marketingAdminUser.findUnique({ where: { id: userId } });
      const snapshot = row?.user as { firstName: string; version: number };
      assert.equal(snapshot.version, 5, 'the newer version must be kept');
      assert.equal(snapshot.firstName, 'Newer', 'an older event must not overwrite newer data');
      const revision = await prisma.marketingUserSyncRevision.findUnique({ where: { userId } });
      assert.equal(revision?.version, 5);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('VERSION GUARD: a tax event with an older version must not replace the cache', async () => {
    const newer = await httpRequest(`${MARKETING}/internal/taxes/events`, {
      method: 'POST',
      headers: { ...MARKETING_HEADERS, 'x-tax-sync-secret': TEST_TAX_SYNC_SECRET },
      body: taxEvent(9, '12'),
    });
    assert.equal(newer.status, 200, JSON.stringify(newer.body));

    const older = await httpRequest(`${MARKETING}/internal/taxes/events`, {
      method: 'POST',
      headers: { ...MARKETING_HEADERS, 'x-tax-sync-secret': TEST_TAX_SYNC_SECRET },
      body: taxEvent(4, '5'),
    });
    assert.equal(older.status, 200, JSON.stringify(older.body));

    const prisma = prismaFor('marketing');
    try {
      const revision = await prisma.taxCacheRevision.findUnique({
        where: { officeBranchId: branchId },
      });
      assert.equal(revision?.version, 9, 'the newest tax revision must be kept');
      const rows = await prisma.taxCache.findMany({ where: { officeBranchId: branchId } });
      assert.equal(rows.length, 1, 'the tax cache must hold exactly one row for the branch');
      assert.equal(rows[0].percentage.toString(), '12', 'an older tax event must not replace the cache');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('VERSION GUARD: racing tax events leave the highest version in the cache', async () => {
    // Ten events with descending versions race for the same branch. Only the
    // highest version may end up in the cache.
    const versions = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const responses = await Promise.all(versions.map((version) => httpRequest(`${MARKETING}/internal/taxes/events`, {
      method: 'POST',
      headers: { ...MARKETING_HEADERS, 'x-tax-sync-secret': TEST_TAX_SYNC_SECRET },
      body: taxEvent(version),
    })));
    for (const response of responses) {
      assert.equal(response.status, 200, JSON.stringify(response.body));
    }

    const prisma = prismaFor('marketing');
    try {
      const revision = await prisma.taxCacheRevision.findUnique({
        where: { officeBranchId: branchId },
      });
      assert.equal(revision?.version, 10, 'the highest tax version must win');
      const rows = await prisma.taxCache.findMany({ where: { officeBranchId: branchId } });
      assert.equal(rows.length, 1, 'exactly one tax row may exist for the branch');
    } finally {
      await prisma.$disconnect();
    }
  });
});
