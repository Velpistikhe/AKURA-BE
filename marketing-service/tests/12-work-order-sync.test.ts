/**
 * WORK ORDER SYNCHRONISATION - the recorded sync history of one Work Order.
 *
 * Field Service owns the transactional outbox that mirrors a Work Order into a
 * Marketing quotation. This suite covers the endpoint that exposes that
 * history:
 *   - the array holds one record per recorded delivery
 *   - every Work Order write that changes the link adds a record
 *   - the delivery state tells a delivered event from a queued one
 *   - a Work Order of another branch is not readable
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

interface SyncDelivery {
  id: string;
  targetService: string;
  attempts: number;
  deliveredAt: string | null;
  lastError: string | null;
  deliveryStatus: 'DELIVERED' | 'PENDING' | 'RETRYING';
}

interface SyncRecord {
  eventId: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderStatus: string;
  action: 'CREATE' | 'START' | 'UPDATE' | 'REVOKE';
  revoked: boolean;
  quotationId: string;
  createdAt: string;
  delivery: SyncDelivery;
}

interface SyncResponse {
  status: number;
  success: boolean;
  data: SyncRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

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

/** Creates a Work Order from an approved quotation as the marketing officer. */
const createFromQuotation = async (quotationId: string, itemSizeId: string) => {
  const today = new Date().toISOString().slice(0, 10);
  const response = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/from-quotation`, {
    method: 'POST',
    token: user.accessToken,
    body: {
      quotationId,
      startDate: today,
      endDate: dayAfter(today),
      inspectors: ['SyncTest Inspector'],
      items: [{ itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return (response.body as { data: { id: string; version: number } }).data;
};

/** Reads the synchronisation history of one Work Order. */
const readSync = async (workOrderId: string, token = user.accessToken) =>
  httpRequest<SyncResponse>(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrderId}/sync`, {
    method: 'GET',
    token,
  });
describe('fieldservice-service work order synchronisation history', () => {
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

  test('CREATE FROM QUOTATION: the sync history records the link event', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    const response = await readSync(workOrder.id);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(Array.isArray(response.body.data), 'the synchronisation data must be an array');
    assert.equal(response.body.data.length, 1);
    const record = response.body.data[0];
    assert.equal(record.workOrderId, workOrder.id);
    assert.equal(record.quotationId, quotationId);
    assert.equal(record.action, 'CREATE');
    assert.equal(record.revoked, false);
    assert.equal(record.workOrderStatus, 'DRAFT');
    assert.equal(record.delivery.targetService, 'marketing');
    assert.equal(response.body.pagination.total, 1);
  });

  test('START: the sync history records the status change', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    const started = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}/start`, {
      method: 'POST',
      token: user.accessToken,
      body: { version: workOrder.version },
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));

    const response = await readSync(workOrder.id);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.length, 2);
    // The newest record comes first.
    assert.equal(response.body.data[0].action, 'START');
    assert.equal(response.body.data[0].workOrderStatus, 'IN_PROGRESS');
    assert.equal(response.body.data[1].action, 'CREATE');
  });

  test('REVOKE: the sync history records the unlink event', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    const revoked = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'DELETE',
      token: user.accessToken,
      body: { version: workOrder.version },
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));

    const response = await readSync(workOrder.id);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.length, 2);
    const record = response.body.data[0];
    assert.equal(record.action, 'REVOKE');
    assert.equal(record.revoked, true);
  });

  test('DELIVERY STATE: a delivered event is reported as DELIVERED', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    const response = await readSync(workOrder.id);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const record = response.body.data[0];
    // The delivery is flushed in the request, so it is acknowledged already.
    assert.equal(record.delivery.deliveryStatus, 'DELIVERED');
    assert.ok(record.delivery.deliveredAt, 'a delivered event carries the acknowledgement time');
    assert.equal(record.delivery.lastError, null);
    assert.ok(record.delivery.attempts >= 1);
  });

  test('BRANCH ISOLATION: a Work Order of another branch is not readable', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    const otherBranch = await seedOfficeBranch();
    const otherUser = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: otherBranch.id });
    await loginAs(otherUser);

    const response = await readSync(workOrder.id, otherUser.accessToken);
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  test('NO QUOTATION BASIS: the sync history is an empty array', async () => {
    const fixture = await buildCatalogFixture(admin.accessToken);
    const today = new Date().toISOString().slice(0, 10);

    const created = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders`, {
      method: 'POST',
      token: user.accessToken,
      body: {
        companyId: fixture.companyId,
        subject: 'SyncTest company basis',
        officialReport: true,
        dailyReport: today,
        officialReportDelivery: today,
        dailyReportDelivery: today,
        poNumber: 'PO-SYNCTEST',
        poDate: today,
        startDate: today,
        endDate: dayAfter(today),
        inspectors: ['SyncTest Inspector'],
        items: [{ itemSizeId: fixture.itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const workOrder = (created.body as { data: { id: string } }).data;

    const response = await readSync(workOrder.id);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data, []);
    assert.equal(response.body.pagination.total, 0);
  });

  test('UNKNOWN WORK ORDER: an unknown id returns 404', async () => {
    const response = await readSync(randomUUID());
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
});
