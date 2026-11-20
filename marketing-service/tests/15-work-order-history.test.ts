/**
 * Regression coverage for the Work Order change history response contract.
 * Full before/after Work Order snapshots are intentionally not exposed; the
 * endpoint returns only field-level changes and entry metadata.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY, loginAs, seedMarketingTax, seedOfficeBranch, seedUser, type SeededUser,
} from './support/fixtures.js';
import {
  approveQuotation,
  buildCatalogFixture,
  createSubmittedQuotation,
  workOrderFromMarketingCreate,
} from './support/catalog.js';
import { httpRequest } from './support/http.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import { s3Environment, startS3Stub, type S3Stub } from './support/s3-stub.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let marketing: ServiceProcess;
let fieldservice: ServiceProcess;
let gateway: ServiceProcess;
let s3: S3Stub;
let admin: SeededUser;
let user: SeededUser;

describe('Field Service Work Order change history response', () => {
  resetBeforeEach(['marketing', 'fieldservice']);

  before(async () => {
    await ensureDatabases();
    s3 = await startS3Stub();
    auth = await startService('auth');
    marketing = await startService('marketing', s3Environment(s3));
    fieldservice = await startService('fieldservice');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, fieldservice, marketing, auth]) await process_?.stop();
    await s3?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    await seedMarketingTax(branch.id);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branch.id });
    await loginAs(admin);
    user = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    await loginAs(user);
  });

  test('returns field changes and metadata but no full Work Order snapshots', async () => {
    const fixture = await buildCatalogFixture(admin.accessToken);
    const quotation = await createSubmittedQuotation(admin.accessToken, fixture);
    await approveQuotation(admin.accessToken, quotation.id, quotation.version);

    const today = new Date().toISOString().slice(0, 10);
    const created = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotation.id}/work-order`, {
      method: 'POST', token: user.accessToken,
      body: {
        startDate: today, endDate: today,
        inspectors: ['HistoryTest Inspector'],
        items: [{ itemSizeId: fixture.itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const workOrderId = workOrderFromMarketingCreate(created.body).id;

    const response = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrderId}/history`, {
      method: 'GET', token: user.accessToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const data = (response.body as { data: { history: Array<Record<string, unknown>>; pagination: { total: number } } }).data;
    assert.equal(data.pagination.total, 1);
    const [entry] = data.history;
    assert.ok(entry);
    assert.equal(entry.action, 'CREATE');
    assert.equal(entry.actionLabel, 'Work order created');
    assert.ok(Array.isArray(entry.changes));
    assert.ok((entry.changes as Array<Record<string, unknown>>).length > 0);
    assert.equal(entry.beforeSnapshot, undefined);
    assert.equal(entry.snapshot, undefined);
    assert.deepEqual(entry.changedBy, {
      id: entry.createdById,
      name: entry.createdByName,
    });
  });
});
