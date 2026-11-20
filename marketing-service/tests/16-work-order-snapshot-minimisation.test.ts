/**
 * WORK ORDER SNAPSHOT MINIMISATION - the document snapshots never leave the
 * server.
 *
 * A Work Order stores a reduced quotation and contract snapshot so it can
 * detect drift against Marketing. Those snapshots are internal state: no
 * Work Order response may carry them, the change history may only report that
 * the basis changed, and the snapshot must never be delivered to Marketing.
 *
 * The snapshots must keep working though, so the suite also proves that the
 * stored snapshot is still complete and still drives the start transition.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY, loginAs, query, seedMarketingTax, seedOfficeBranch, seedUser, type SeededUser,
} from './support/fixtures.js';
import { approveQuotation, buildCatalogFixture, createSubmittedQuotation, workOrderFromMarketingCreate } from './support/catalog.js';
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
let branchId: string;

/** The day after another date, so a date pair is valid. */
const dayAfter = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * Creates an approved quotation ready to be used as a Work Order basis.
 *
 * The staff display name is unique per branch, so a caller that needs a second
 * quotation in the same branch passes a distinct name.
 */
const approvedQuotation = async (staffName?: string) => {
  const fixture = await buildCatalogFixture(admin.accessToken, staffName);
  const submitted = await createSubmittedQuotation(admin.accessToken, fixture);
  await approveQuotation(admin.accessToken, submitted.id, submitted.version);
  return { fixture, quotationId: submitted.id };
};

/** Creates a Work Order from an approved quotation as the marketing officer. */
const createFromQuotation = async (quotationId: string, itemSizeId: string) => {
  const today = new Date().toISOString().slice(0, 10);
  const response = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotationId}/work-order`, {
    method: 'POST',
    token: user.accessToken,
    body: {
      startDate: today,
      endDate: dayAfter(today),
      inspectors: ['SnapshotTest Inspector'],
      items: [{ itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return workOrderFromMarketingCreate(response.body);
};

/** Reads the detail of one Work Order. */
const readDetail = async (workOrderId: string) =>
  httpRequest<{ data: Record<string, unknown> }>(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrderId}`, {
    method: 'GET',
    token: user.accessToken,
  });

/** Asserts that a Work Order payload carries neither document snapshot. */
const assertNoSnapshots = (payload: Record<string, unknown>, label: string): void => {
  assert.equal('quotationSnapshot' in payload, false, `${label} must not carry quotationSnapshot`);
  assert.equal('contractSnapshot' in payload, false, `${label} must not carry contractSnapshot`);
};


describe('fieldservice-service work order snapshot minimisation', () => {
  // Every test starts from an empty marketing and field-service database.
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
    branchId = branch.id;
    await seedMarketingTax(branchId);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
    user = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(user);
  });

  test('READ DETAIL: the Work Order detail carries neither document snapshot', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    const response = await readDetail(workOrder.id);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const data = response.body.data;
    assertNoSnapshots(data, 'the Work Order detail');
    // The rest of the document is still returned.
    assert.equal(data.id, workOrder.id);
    assert.equal(data.quotationId, quotationId);
    assert.ok(Array.isArray(data.items));
    assert.ok(Array.isArray(data.inspectors));
  });

  test('WRITE RESPONSES: creation, update, start and revoke carry no snapshot', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const today = new Date().toISOString().slice(0, 10);

    const created = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotationId}/work-order`, {
      method: 'POST',
      token: user.accessToken,
      body: {
        startDate: today,
        endDate: dayAfter(today),
        inspectors: ['SnapshotTest Inspector'],
        items: [{ itemSizeId: fixture.itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const workOrder = workOrderFromMarketingCreate(created.body);
    const createData = (created.body as { data: { workOrder: Record<string, unknown> } }).data;
    assertNoSnapshots(createData.workOrder, 'the creation response');

    const patched = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { version: workOrder.version, endDate: dayAfter(dayAfter(new Date().toISOString().slice(0, 10))) },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assertNoSnapshots((patched.body as { data: Record<string, unknown> }).data, 'the update response');
    const patchedVersion = (patched.body as { data: { version: number } }).data.version;

    const started = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}/start`, {
      method: 'POST',
      token: user.accessToken,
      body: { version: patchedVersion },
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assertNoSnapshots((started.body as { data: Record<string, unknown> }).data, 'the start response');
    const startedVersion = (started.body as { data: { version: number } }).data.version;

    const revoked = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'DELETE',
      token: user.accessToken,
      body: { version: startedVersion },
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assertNoSnapshots((revoked.body as { data: Record<string, unknown> }).data, 'the revoke response');
  });

  test('HISTORY: a changed document basis is reported without its content', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    // A second approved quotation replaces the document basis, so the stored
    // quotation snapshot really changes.
    const second = await approvedQuotation('SnapshotTest Staff Two');
    const patched = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { version: workOrder.version, quotationId: second.quotationId },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));

    const response = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}/history`, {
      method: 'GET',
      token: user.accessToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const entries = (response.body as { data: { history: Array<Record<string, unknown>> } }).data.history;
    const changes = entries.flatMap(entry => entry.changes as Array<Record<string, unknown>>);

    // The basis change is reported, with the captured document reduced to null.
    const snapshotChange = changes.find(change => change.field === 'quotationSnapshot');
    assert.ok(snapshotChange, 'the changed document basis must be reported');
    assert.equal(snapshotChange.before, null, 'a snapshot change must not expose its previous value');
    assert.equal(snapshotChange.after, null, 'a snapshot change must not expose its new value');
    assert.equal(typeof snapshotChange.label, 'string');
    // No change entry may carry the captured document.
    for (const change of changes) {
      if (change.field !== 'quotationSnapshot' && change.field !== 'contractSnapshot') continue;
      assert.equal(change.before, null, 'a snapshot change must not expose its previous value');
      assert.equal(change.after, null, 'a snapshot change must not expose its new value');
    }
    // The full snapshots are not part of the response either.
    assert.equal('beforeSnapshot' in entries[0], false);
    assert.equal('snapshot' in entries[0], false);
  });

  test('STORAGE: the snapshot is still stored and still drives the start transition', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    // The stored snapshot is complete, so the drift check against Marketing
    // still has what it needs to validate the start transition.
    const rows = await query<{ quotation_snapshot: unknown; contract_snapshot: unknown }>(
      'fieldservice',
      'SELECT quotation_snapshot, contract_snapshot FROM work_order WHERE id = $1::uuid',
      workOrder.id,
    );
    assert.equal(rows.length, 1);
    const stored = rows[0].quotation_snapshot as Record<string, unknown> | null;
    assert.ok(stored, 'the quotation snapshot must still be stored');
    assert.equal(stored.id, quotationId);
    assert.ok(Array.isArray(stored.items), 'the stored snapshot keeps its items');

    // The list endpoint still derives the quotation number from that snapshot.
    const list = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders`, {
      method: 'GET',
      token: user.accessToken,
    });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const listed = (list.body as { data: { workOrders: Array<Record<string, unknown>> } }).data.workOrders;
    const row = listed.find(entry => entry.id === workOrder.id);
    assert.ok(row, 'the created Work Order must be listed');
    assert.equal(typeof row.quotationNo, 'number', 'the list still reports the quotation number');
    assertNoSnapshots(row, 'the Work Order list row');

    // The start transition re-validates the stored snapshot against Marketing,
    // so it only succeeds while the snapshot is intact.
    const started = await httpRequest(`${GATEWAY}/api/v1/fieldservice/work-orders/${workOrder.id}/start`, {
      method: 'POST',
      token: user.accessToken,
      body: { version: workOrder.version },
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assertNoSnapshots((started.body as { data: Record<string, unknown> }).data, 'the start response');
  });

  test('DELIVERY: the document snapshot is never delivered to Marketing', async () => {
    const { fixture, quotationId } = await approvedQuotation();
    const workOrder = await createFromQuotation(quotationId, fixture.itemSizeId);

    const rows = await query<{ work_order_snapshot: Record<string, unknown> | null }>(
      'marketing',
      'SELECT work_order_snapshot FROM quotations WHERE id = $1::uuid',
      quotationId,
    );
    assert.equal(rows.length, 1);
    const delivered = rows[0].work_order_snapshot;
    assert.ok(delivered, 'Marketing must still receive the Work Order snapshot');
    // Marketing derives the mirrored status from the delivered snapshot.
    assert.equal(typeof delivered.status, 'string');
    assert.equal(delivered.id, workOrder.id);
    // The captured document does not cross the service boundary.
    assert.equal('quotationSnapshot' in delivered, false, 'the quotation snapshot must not be delivered');
    assert.equal('contractSnapshot' in delivered, false, 'the contract snapshot must not be delivered');
  });
});
