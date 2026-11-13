/**
 * WORK ORDER WRITE RULES - authorization and date validation.
 *
 * Covers the contract of the Field Service Work Order write endpoints:
 *   - creation and PATCH require section MARKETING with role USER only
 *   - the end date must not precede the start date; the same day is allowed
 *   - the removed read-only endpoints are no longer mounted
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  GATEWAY,
  loginAs,
  seedMarketingTax,
  seedOfficeBranch,
  seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { approveQuotation, buildCatalogFixture, createSubmittedQuotation } from './support/catalog.js';
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

/** The day after the start date, so the pair is valid. */
const dayAfter = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
/** The day before the start date, so the pair is invalid. */
const dayBefore = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

/** Creates an approved quotation ready to be used as a Work Order basis. */
const approvedQuotation = async () => {
  const fixture = await buildCatalogFixture(admin.accessToken);
  const submitted = await createSubmittedQuotation(admin.accessToken, fixture);
  await approveQuotation(admin.accessToken, submitted.id, submitted.version);
  return { fixture, quotationId: submitted.id };
};

/** Creates a Work Order from an approved quotation as the marketing officer. */
const createFromQuotation = async (quotationId: string, itemSizeId: string, startDate: string, endDate: string, token = user.accessToken) =>
  httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/from-quotation`, {
    method: 'POST',
    token,
    body: {
      quotationId,
      startDate,
      endDate,
      inspectors: ['RelTest Inspector'],
      items: [{ itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
    },
  });

describe('fieldservice-service work order write rules', () => {
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

  test('AUTHORIZATION: an ADMIN cannot create a Work Order from a quotation', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);

    const response = await createFromQuotation(quotationId, fixture.itemSizeId, today, today, admin.accessToken);
    assert.equal(response.status, 403, JSON.stringify(response.body));
  });

  test('AUTHORIZATION: a USER in MARKETING creates a Work Order from a quotation', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);

    const response = await createFromQuotation(quotationId, fixture.itemSizeId, today, today);
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  test('DATE VALIDATION: an end date before the start date is rejected with 400', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);

    const response = await createFromQuotation(quotationId, fixture.itemSizeId, today, dayBefore(today));
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  test('DATE VALIDATION: the same start and end date is accepted', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);

    const response = await createFromQuotation(quotationId, fixture.itemSizeId, today, today);
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });


  test('DATE VALIDATION: PATCH rejects an end date before the start date with 400', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);

    const created = await createFromQuotation(quotationId, fixture.itemSizeId, today, dayAfter(today));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const workOrder = (created.body as { data: { id: string; version: number } }).data;

    const response = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { version: workOrder.version, endDate: dayBefore(today) },
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  test('DATE VALIDATION: PATCH rejects an end date before the stored start date', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);

    const created = await createFromQuotation(quotationId, fixture.itemSizeId, today, dayAfter(today));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const workOrder = (created.body as { data: { id: string; version: number } }).data;

    // Only the end date is submitted, so it is compared with the stored start
    // date. The Work Order must keep its stored period after the rejection.
    const response = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { version: workOrder.version, endDate: dayBefore(today) },
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));

    const reloaded = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'GET',
      token: user.accessToken,
    });
    assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
    const stored = (reloaded.body as { data: { startDate: string; endDate: string; version: number } }).data;
    // The stored period is unchanged by the rejected PATCH.
    assert.equal(stored.startDate.slice(0, 10), today);
    assert.equal(stored.endDate.slice(0, 10), dayAfter(today));
    assert.equal(stored.version, workOrder.version, 'a rejected PATCH must not consume the version');
  });

  test('REMOVED ENDPOINTS: the deleted read-only routes are no longer mounted', async () => {
    const quotationId = randomUUID();
    const responses = await Promise.all([
      httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/by-quotation/${quotationId}`, {
        method: 'GET',
        token: user.accessToken,
      }),
      httpRequest(`${GATEWAY}/api/v1/fieldservice/options/quotations`, {
        method: 'GET',
        token: user.accessToken,
      }),
      httpRequest(`${GATEWAY}/api/v1/fieldservice/options/quotations/${quotationId}`, {
        method: 'GET',
        token: user.accessToken,
      }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 404, JSON.stringify(response.body));
    }
  });
});

