/**
 * WORK ORDER QUOTATION BASIS - the rules that guard a quotation-based Work Order.
 *
 * A Work Order created from a quotation may only use a quotation that
 *   - belongs to the branch of the actor,
 *   - is still active and APPROVED,
 *   - is not already backing another Work Order.
 *
 * The "already in use" rule is checked twice: against the local Work Order
 * rows (atomically, inside the write transaction) and against the mirrored
 * link Marketing owns, which is the same rule Marketing applies when it
 * claims the quotation.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY,
  loginAs,
  prismaFor,
  seedMarketingTax,
  seedOfficeBranch,
  seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { approveQuotation, buildCatalogFixture, createQuotation, createSubmittedQuotation, workOrderFromMarketingCreate } from './support/catalog.js';
import { httpRequest } from './support/http.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let marketing: ServiceProcess;
let fieldservice: ServiceProcess;
let gateway: ServiceProcess;

let admin: SeededUser;
let user: SeededUser;
let branchId: string;

/** The day after another date, so a date pair is valid. */
const dayAfter = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Creates an approved quotation ready to be used as a Work Order basis. */
const approvedQuotation = async () => {
  const fixture = await buildCatalogFixture(admin.accessToken);
  const submitted = await createSubmittedQuotation(admin.accessToken, fixture);
  await approveQuotation(admin.accessToken, submitted.id, submitted.version);
  return { fixture, quotationId: submitted.id };
};

/** Creates a Work Order from a quotation as the marketing officer. */
const createFromQuotation = async (quotationId: string, itemSizeId: string, token = user.accessToken) => {
  const today = new Date().toISOString().slice(0, 10);
  return httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotationId}/work-order`, {
    method: 'POST',
    token,
    body: {
      startDate: today,
      endDate: dayAfter(today),
      inspectors: ['BasisTest Inspector'],
      items: [{ itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
    },
  });
};

describe('fieldservice-service work order quotation basis rules', () => {
  // Every test starts from an empty marketing and field-service database.
  resetBeforeEach(['marketing', 'fieldservice']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    marketing = await startService('marketing');
    fieldservice = await startService('fieldservice');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, fieldservice, marketing, auth]) await process_?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    await seedMarketingTax(branchId);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
    user = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(user);
  });

  test('APPROVED QUOTATION: a free quotation in the same branch is accepted', async () => {
    const { fixture, quotationId } = await approvedQuotation();

    const response = await createFromQuotation(quotationId, fixture.itemSizeId);
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  test('IN USE: a second Work Order for the same quotation is rejected with 409', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const first = await createFromQuotation(quotationId, fixture.itemSizeId);
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await createFromQuotation(quotationId, fixture.itemSizeId);
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.match(String((second.body as { message?: string }).message), /already has/i);
  });

  test('IN USE: the mirrored Marketing link blocks the Work Order even without a local one', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    // Marketing owns the mirrored link. Setting it directly proves the guard
    // reads the mirror, not only the local Work Order rows.
    const prisma = prismaFor('marketing');
    try {
      await prisma.quotation.update({
        where: { id: quotationId },
        data: { hasWorkOrder: true, workOrderId: '11111111-1111-4111-8111-111111111111' },
      });
    } finally {
      await prisma.$disconnect();
    }

    const response = await createFromQuotation(quotationId, fixture.itemSizeId);
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(String((response.body as { message?: string }).message), /already has/i);
  });

  test('RELEASED: revoking the Work Order frees the quotation again', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const created = await createFromQuotation(quotationId, fixture.itemSizeId);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const workOrder = workOrderFromMarketingCreate(created.body);

    const revoked = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'DELETE',
      token: user.accessToken,
      body: { version: workOrder.version },
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));

    // The revoke is delivered to Marketing, which clears the mirrored link.
    const again = await createFromQuotation(quotationId, fixture.itemSizeId);
    assert.equal(again.status, 201, JSON.stringify(again.body));
  });

  test('REMOVED ENDPOINT: Field Service no longer exposes POST from-quotation', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);
    const response = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/from-quotation`, {
      method: 'POST',
      token: user.accessToken,
      body: {
        quotationId,
        startDate: today,
        endDate: dayAfter(today),
        inspectors: ['BasisTest Inspector'],
        items: [{ itemSizeId: fixture.itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
      },
    });
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
  test('BRANCH: a quotation of another branch is not found', async () => {
    const { fixture, quotationId } = await approvedQuotation();

    const otherBranch = await seedOfficeBranch();
    const otherUser = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: otherBranch.id });
    await loginAs(otherUser);

    const response = await createFromQuotation(quotationId, fixture.itemSizeId, otherUser.accessToken);
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  test('LIFECYCLE: a quotation that is not APPROVED is rejected with 409', async () => {
    const fixture = await buildCatalogFixture(admin.accessToken);
    const created = await createQuotation(admin.accessToken, fixture);

    const response = await createFromQuotation(created.id, fixture.itemSizeId);
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(String((response.body as { message?: string }).message), /APPROVED/i);
  });

  test('LIFECYCLE: a deactivated quotation is not found', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const detail = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotationId}`, {
      method: 'GET',
      token: admin.accessToken,
    });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const version = (detail.body as { data: { version: number } }).data.version;

    const deactivated = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotationId}`, {
      method: 'DELETE',
      token: admin.accessToken,
      body: { version },
    });
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));

    const response = await createFromQuotation(quotationId, fixture.itemSizeId);
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
});
