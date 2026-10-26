const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config();
const { contractSchema } = require('../dist/integrations/gateway.js');
const { createWorkOrderSchema } = require('../dist/modules/work-orders/work-order.schemas.js');
const { workOrderRepository } = require('../dist/modules/work-orders/work-order.repository.js');
const { prisma } = require('../dist/config/db.js');

test('Marketing contract lifecycle and date-only references normalize without an isActive column', () => {
  const companyId = randomUUID();
  const reference = { id: randomUUID(), companyId, version: 1, contractNumber: 'CONTRACT', contractDate: '2026-01-01', effectiveFrom: '2026-01-01', effectiveUntil: '2099-01-01', status: 'APPROVED', isDeleted: false, company: { id: companyId, name: 'Company', officeBranchId: randomUUID(), revoked: false } };
  const parsed = contractSchema.parse(reference);
  assert.equal(parsed.isActive, true);
  assert.equal(parsed.contractDate, '2026-01-01T00:00:00.000Z');
  assert.equal(parsed.effectiveUntil, '2099-01-01T00:00:00.000Z');
  assert.equal(contractSchema.parse({ ...reference, isDeleted: true, isActive: true }).isActive, false);
  const { isDeleted, ...legacy } = reference;
  assert.equal(contractSchema.parse({ ...legacy, isActive: false }).isActive, false);
  assert.equal(contractSchema.safeParse(legacy).success, false);
  assert.equal(contractSchema.safeParse({ ...reference, contractDate: '2026-02-30' }).success, false);
});

test('Work Order quantities reject precision loss/overflow and item lines accept only size and quantities', () => {
  const itemSizeId = randomUUID();
  const item = { itemSizeId, quantityInspection: 1, quantityMaintenance: 0 };
  const input = { performaInvoiceId: randomUUID(), startDate: '2030-01-01', inspectors: [{ userId: randomUUID(), name: 'Inspector' }], items: [item] };
  for (const field of ['quantityInspection', 'quantityMaintenance']) {
    for (const value of [0.0001, 1000000000000, -1, Infinity, NaN]) assert.equal(createWorkOrderSchema.safeParse({ ...input, items: [{ ...item, [field]: value }] }).success, false, `${field}=${value}`);
    for (const value of [0, 0.001, 1.234, 999999999999.999]) assert.equal(createWorkOrderSchema.safeParse({ ...input, items: [{ ...item, [field]: value }] }).success, true, `${field}=${value}`);
  }
  // Description fields are resolved server-side, never accepted from the client.
  for (const extra of ['snapshotItemSize', 'item', 'snapShotItem']) {
    assert.equal(createWorkOrderSchema.safeParse({ ...input, items: [{ ...item, [extra]: {} }] }).success, false, extra);
  }
});

test('Start rejects a future version before entering a transaction or trusting an earlier snapshot', async t => {
  const originalFind = prisma.workOrder.findFirst, originalTransaction = prisma.$transaction;
  t.after(() => { prisma.workOrder.findFirst = originalFind; prisma.$transaction = originalTransaction; });
  prisma.workOrder.findFirst = async () => ({ id: randomUUID(), status: 'DRAFT', version: 0, revoked: false, quotationId: null });
  prisma.$transaction = async () => { assert.fail('a future version must not enter a transaction'); };
  await assert.rejects(workOrderRepository.start(randomUUID(), 1, null, { id: randomUUID(), name: 'Actor', officeBranchId: randomUUID() }), error => error.statusCode === 409);
});
