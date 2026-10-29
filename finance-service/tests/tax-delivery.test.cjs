const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config();
// The env module parses these at require time, so they must be set before the
// service modules are loaded.
process.env.TAX_DELIVERY_TARGETS = JSON.stringify([{ name: 'marketing-service', url: 'http://localhost:5000/api/v1/marketing/internal/taxes/events' }]);
process.env.TAX_SYNC_SECRET = 'test-secret-with-at-least-32-characters';
const { prisma } = require('../dist/config/db.js');
const { taxRepository } = require('../dist/modules/taxes/tax.repository.js');
const { deliverTax, startTaxDelivery, retryDelay } = require('../dist/modules/taxes/tax-delivery.js');
const { documentRepository } = require('../dist/modules/documents/document.repository.js');
const { documentCreateSchema: createSchema } = require('../dist/modules/documents/document.schemas.js');
require('../dist/utils/logger.js').logger.silent=true;

test('master/outbox atomicity, HTTP retry, restart recovery, and proforma tax authority', async () => {
  const branch=randomUUID(), user=randomUUID();
  const actor = { id: user, officeBranchId: branch, name: 'Finance test' };
  const old = await taxRepository.create({ percentage: '11', effectiveFrom: '2026-01-01' }, branch, actor);
  const newest = await taxRepository.create({ percentage: '12', effectiveFrom: '2026-09-01' }, branch, actor);
  assert.equal((await prisma.tax.findUnique({ where: { id: old.id } })).effectiveUntil.toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(await prisma.taxEvent.count({ where: { officeBranchId: branch } }), 2);
  assert.equal(await prisma.taxDelivery.count({ where: { event: { officeBranchId: branch } } }), 2);
  await assert.rejects(taxRepository.create({ percentage: '13', effectiveFrom: '2026-09-01' }, branch, actor), e => e.statusCode === 409);
  // The outbox is capped so the same master write cannot enqueue an unbounded
  // event: the cap must roll the whole write back. The unique index is swapped
  // for a global check so the third event of any branch is refused.
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events DROP CONSTRAINT IF EXISTS tax_events_office_branch_id_version_key');
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS tax_events_office_branch_id_version_key');
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events DROP CONSTRAINT IF EXISTS test_version_limit');
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events ADD CONSTRAINT test_version_limit CHECK (version <= 2)');
  await assert.rejects(taxRepository.create({ percentage: '13', effectiveFrom: '2026-10-01' }, branch, actor));
  assert.equal(await prisma.tax.count({ where: { officeBranchId: branch } }), 2);
  assert.equal((await prisma.tax.findUnique({ where: { id: newest.id } })).effectiveUntil, null);
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events DROP CONSTRAINT test_version_limit');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS tax_events_office_branch_id_version_key ON tax_events("officeBranchId", version)');

  const quotation = { id: randomUUID(), officeBranchId: branch, version: 1, isActive: true, status: 'APPROVED', subject: 'Tax test', tax: '12', subTotal: '100.25', taxAmount: '11.03', total: '111.28', items: [{ id: randomUUID(), position: 0, itemSizeId: randomUUID(), serviceName: 'Inspection', serviceType: 'INSPECTION', itemName: 'Tank', size: null, note: null, quantityInspection: '1', quantityMaintenance: '0', priceInspection: '100.25', priceMaintenance: null, discount: '0', subTotal: '100.25' }] };
  // The document date is the server day, so the deadline must not precede it.
  const input = createSchema.parse({ kind: 'PROFORMA_INVOICE', companyId: randomUUID(), title: 'Tax test', purchaseOrderNumber: 'PO/2026/000001', purchaseOrderDate: '2026-01-15', items: [randomUUID()], dueDate: '2099-12-31' });
  const invoice = await documentRepository.createFromMarketing('PROFORMA_INVOICE', quotation, input.dueDate, undefined, actor, null);
  assert.equal(invoice.taxSourceId, newest.id);
  assert.equal(invoice.tax.toString(), '12');
  assert.equal(invoice.taxAmount.toString(), '12.03');
  assert.equal(invoice.total.toString(), '112.28');
  assert.equal(invoice.quotationSnapshot.taxAmount, '11.03');
  // A repeated request for the same quotation and kind is refused.
 await assert.rejects(documentRepository.createFromMarketing('PROFORMA_INVOICE', quotation, new Date('2099-12-31'), undefined, actor, null), e => e.statusCode === 409);
 // The deadline of another quotation is still validated.
 await assert.rejects(documentRepository.createFromMarketing('PROFORMA_INVOICE', { ...quotation, id: randomUUID() }, new Date('2025-01-01'), undefined, actor, null), e => e.statusCode === 400);
  // The document date is server-generated, so a client cannot move the
  // document into another tax period.
  await assert.rejects(documentRepository.mutate(invoice.id, { version: 0, date: new Date('2026-08-01') }, actor), e => e.statusCode === 400);
  const revised = await documentRepository.mutate(invoice.id, { version: 0, title: 'Revised' }, actor);
  assert.equal(revised.tax.toString(), '12');
  // A draft leaves DRAFT only through the approval endpoint.
  await assert.rejects(documentRepository.mutate(invoice.id, { version: 1, status: 'FINAL' }, actor), e => e.statusCode === 409);
  const approved = await documentRepository.approve(invoice.id, 1, actor);
  assert.equal(approved.status, 'ON_PROGRESS');
  const final = await documentRepository.mutate(invoice.id, { version: 2, status: 'FINAL' }, actor);
  assert.equal(final.tax.toString(), '12');
  await assert.rejects(documentRepository.mutate(invoice.id, { version: 3, title: 'Changed' }, actor), e => e.statusCode === 409);

  const job = await prisma.taxDelivery.findFirst({ where: { event: { officeBranchId: branch } } });
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => { calls++; throw Error('offline'); };
    await deliverTax(job.id);
    let state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
    assert.equal(state.attempts, 1); assert.equal(state.deliveredAt, null); assert.ok(state.nextRetryAt > new Date());
    // The backoff keeps the next attempt from running before it is due.
    await deliverTax(job.id); assert.equal(calls, 1);
    await prisma.taxDelivery.update({ where: { id: job.id }, data: { nextRetryAt: new Date(0) } });
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true, eventId: randomUUID() }) });
    await deliverTax(job.id);
    state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
    assert.equal(state.deliveredAt, null); assert.equal(state.attempts, 2);
    await prisma.taxDelivery.updateMany({ where: { event: { officeBranchId: branch } }, data: { nextRetryAt: new Date(0) } });
    global.fetch = async (_url, options) => { calls++; return { ok: true, json: async () => ({ success: true, eventId: JSON.parse(options.body).eventId }) }; };
    await Promise.all([deliverTax(job.id), deliverTax(job.id)]);
    assert.equal(calls, 2);
    state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
    assert.ok(state.deliveredAt);
    await deliverTax(job.id); assert.equal(calls, 2);
    const stop = startTaxDelivery();
    try {
      const deadline = Date.now() + 10000;
      while (await prisma.taxDelivery.count({ where: { deliveredAt: null, event: { officeBranchId: branch } } })) {
        assert.ok(Date.now() < deadline, 'startup recovers pending jobs');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } finally { stop(); }
    assert.equal(retryDelay(1), 10000); assert.equal(retryDelay(100), 300000);
  } finally { global.fetch = originalFetch; }
  const where = { officeBranchId: branch };
  await prisma.documentHistory.deleteMany({ where: { document: { officeBranchId: branch } } });
  await prisma.documentItem.deleteMany({ where: { document: { officeBranchId: branch } } });
  await prisma.document.deleteMany({ where: { officeBranchId: branch } });
  await prisma.$executeRawUnsafe(`DELETE FROM proforma_invoice_sequences WHERE office_branch_id = '${branch}'::uuid`);
  await prisma.$executeRawUnsafe(`DELETE FROM invoice_sequences WHERE office_branch_id = '${branch}'::uuid`);
  await prisma.taxDelivery.deleteMany({ where: { event: { officeBranchId: branch } } });
  await prisma.taxEvent.deleteMany({ where: { officeBranchId: branch } });
  await prisma.taxRevision.deleteMany({ where: { officeBranchId: branch } });
  await prisma.tax.deleteMany({ where: { officeBranchId: branch } });
  await prisma.$disconnect();
});
