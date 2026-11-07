/**
 * EVENT SYNCHRONISATION - idempotency and version guards.
 *
 * The internal event endpoints of marketing-service receive deliveries from
 * finance-service (tax cache) and fieldservice-service (Work Order link
 * state). Each endpoint must be idempotent and must never apply an outdated
 * event.
 *
 * The user directory is no longer replicated and is no longer read over the
 * network: Auth is the source of truth, but the contact and inspector
 * lookups that consumed it have been removed, so there is no user event
 * endpoint left either. These endpoints are protected by a shared secret and
 * are not reachable through the API Gateway with a user token, so the suite
 * calls them directly on the local service with the test secret.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  gatewayIdentityHeaders, loginAs, prismaFor, seedMarketingTax,
  seedOfficeBranch, seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import { TEST_PORTS } from './support/env.js';
import { TEST_TAX_SYNC_SECRET, TEST_GATEWAY_SECRETS } from './support/harness.js';
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

  test('SECURITY: the removed user event endpoint is no longer mounted', async () => {
    // The user read model is gone, so Marketing has no user event receiver.
    // The caller is authenticated, so the request reaches the routing table
    // and the service answers with its own 404.
    const response = await httpRequest(`${MARKETING}/internal/users/events`, {
      method: 'POST',
      token: admin.accessToken,
      headers: { ...MARKETING_HEADERS, ...gatewayIdentityHeaders(admin) },
      body: { eventId: randomUUID() },
    });
    assert.equal(response.status, 404, JSON.stringify(response.body));
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
