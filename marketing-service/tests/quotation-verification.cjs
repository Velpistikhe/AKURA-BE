const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../dist/config/db.js');
const { quotationRepository: repository } = require('../dist/modules/quotations/quotation.repository.js');

async function main() {
  const branch = randomUUID();
  const actor = { id: randomUUID(), name: 'Quotation test' };
  const editor = { id: randomUUID(), name: 'Quotation editor' };
  let company, service;
  try {
    company = await prisma.company.create({ data: {
      officeBranchId: branch, name: 'Quotation test', normalizeName: branch, type: 'PT', npwp: '0012345678901234', address: 'Jakarta',
      staffs: { create: { name: 'Contact', normalizeName: branch, title: 'mr' } },
    }, include: { staffs: true } });
    service = await prisma.service.create({ data: {
      officeBranchId: branch, name: 'Inspection', type: 'TUBULAR',
      itemCatalog: { create: {
        officeBranchId: branch, name: 'Pipe', createdById: actor.id, createdByName: actor.name,
        sizes: { create: { size: 'Large', createdById: actor.id, createdByName: actor.name } },
      } },
    }, include: { itemCatalog: { include: { sizes: true } } } });
    const itemSizeId = service.itemCatalog[0].sizes[0].id;
    const input = {
      inquiryMethod: 'EMAIL', inquiryDate: '2026-09-09', subject: 'Inspection quotation',
      termOfPayment: '30 days', validity: '30 days', tax: 11,
      supplyAkura: 'Equipment', supplyCustomer: 'Access', location: 'Jakarta',
      accomplished: '7 days', deliveryReports: 'PDF', staffId: company.staffs[0].id,
      items: [{ itemSizeId, quantity: '2.500', unitPrice: '100.25' }],
    };
    const quote = await repository.create(input, branch, actor);
    assert.equal(quote.customerSnapshot, 'Contact');
    assert.deepEqual(quote.companySnapshot, { id: company.id, version: 0, name: company.name, type: 'PT', address: 'Jakarta', npwp: company.npwp });
    await prisma.company.update({ where: { id: company.id }, data: { name: 'Updated company', address: 'Bandung', npwp: '0099999999999999' } });
    assert.equal(quote.invoiceStatus, null);
    await prisma.companyStaff.update({ where: { id: company.staffs[0].id }, data: { name: 'Renamed contact' } });
    assert.equal(quote.version, 0);
    assert.equal(quote.revision, 0);
    assert.equal(quote.createdById, actor.id);
    assert.equal(quote.updatedById, null);
    assert.equal(quote.subTotal.toFixed(2), '250.63');
    assert.equal(quote.taxAmount.toFixed(2), '27.57');
    assert.equal(quote.total.toFixed(2), '278.20');
    assert.equal(quote.items[0].createdById, actor.id);
    await assert.rejects(repository.update(quote.id, { version: 0, subject: 'Foreign' }, randomUUID(), editor), e => e.statusCode === 404);
    const race = await Promise.allSettled([
      repository.update(quote.id, { version: 0, subject: 'Winner A' }, branch, actor),
      repository.update(quote.id, { version: 0, subject: 'Winner B' }, branch, editor),
    ]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(race.find(r => r.status === 'rejected').reason.statusCode, 409);
    assert.equal((await repository.history(quote.id, branch)).length, 2);
    assert.equal((await repository.history(quote.id, randomUUID())).length, 0);
    // Catalog edits must not rewrite an existing quotation snapshot.
    await prisma.item.update({ where: { id: service.itemCatalog[0].id }, data: { name: 'Renamed Pipe' } });
    const changed = await repository.update(quote.id, {
      version: 1, items: [{ id: quote.items[0].id, itemSizeId, quantity: '3', unitPrice: '100.25' }],
    }, branch, editor);
    assert.equal(changed.items[0].itemName, 'Pipe');
    assert.equal(changed.revision, 2);
    assert.equal(changed.customerSnapshot, 'Contact');
    assert.deepEqual(changed.companySnapshot, quote.companySnapshot);
    assert.equal(changed.status, 'CREATED');
    assert.equal(changed.invoiceStatus, null);
    assert.equal(changed.inquiryMethod, 'EMAIL');
    assert.equal(changed.items[0].updatedById, editor.id);
    assert.equal(changed.items[0].createdById, actor.id);
    assert.equal(changed.updatedById, editor.id);
    assert.equal(changed.subTotal.toFixed(2), '300.75');
    // An invalid item after claiming the revision must roll back every write.
    await assert.rejects(repository.update(quote.id, {
      version: 2, subject: 'Must rollback', items: [{ itemSizeId: randomUUID(), quantity: '1', unitPrice: '1' }],
    }, branch, editor));
    const unchanged = await prisma.quotation.findUniqueOrThrow({ where: { id: quote.id }, include: { items: true } });
    assert.equal(unchanged.version, 2);
    assert.equal(unchanged.revision, 2);
    assert.equal(unchanged.subject, changed.subject);
    assert.equal(unchanged.items[0].isActive, true);
    assert.equal((await repository.history(quote.id, branch)).length, 3);
    const newContact = await prisma.companyStaff.create({ data: {
      companyId: company.id, name: 'Replacement contact', normalizeName: randomUUID(), title: 'mr',
    } });
    const replacement = await repository.update(quote.id, {
      version: 2, status: 'CONFIRMED', invoiceStatus: 'CREATED', inquiryMethod: 'WHATSAPP', staffId: newContact.id, items: [{ itemSizeId, quantity: '1', unitPrice: '25' }],
    }, branch, editor);
    assert.equal(replacement.customerSnapshot, 'Replacement contact');
    assert.equal(replacement.revision, 3);
    assert.equal(replacement.status, 'CONFIRMED');
    assert.equal(replacement.invoiceStatus, 'CREATED');
    assert.equal(replacement.inquiryMethod, 'WHATSAPP');
    const snapshotHistory = await repository.history(quote.id, branch);
    assert.equal(snapshotHistory[0].snapshot.customerSnapshot, 'Contact');
    assert.equal(snapshotHistory.at(-1).snapshot.customerSnapshot, 'Replacement contact');
    assert.equal(replacement.items.filter(i => i.isActive).length, 1);
    assert.equal(replacement.items.find(i => i.id === quote.items[0].id).isActive, false);
    assert.equal(replacement.subTotal.toFixed(2), '25.00');
    const removed = await repository.deactivate(quote.id, { version: 3 }, branch, editor);
    assert.equal(removed.isActive, false);
    assert.equal(removed.revision, 3);
    assert(removed.items.every(i => !i.isActive));
    await assert.rejects(repository.update(quote.id, { version: 4, subject: 'Inactive' }, branch, editor), e => e.statusCode === 409);
    const history = await repository.history(quote.id, branch);
    assert.deepEqual(history.map(h => h.version), [0, 1, 2, 3, 4]);
    assert.deepEqual(history.map(h => h.snapshot.revision), [0, 1, 2, 3, 3]);
    assert.equal(history[0].snapshot.items[0].quantity, '2.5');
    assert.equal(history[0].snapshot.subject, input.subject);
    assert.equal(history[4].action, 'DEACTIVATE');
    const invoiceQuote = await repository.create({ ...input, invoiceStatus: 'SEND' }, branch, actor);
    const preservedInvoice = await repository.update(invoiceQuote.id, { version: 0, subject: 'Invoice unchanged' }, branch, editor);
    assert.equal(preservedInvoice.invoiceStatus, 'SEND');
    const clearedInvoice = await repository.update(invoiceQuote.id, { version: 1, invoiceStatus: null }, branch, editor);
    assert.equal(clearedInvoice.invoiceStatus, null);
    assert.equal(clearedInvoice.revision, 1);
    const identical = await repository.update(invoiceQuote.id, {
      version: 2, subject: clearedInvoice.subject,
      items: clearedInvoice.items.filter(i => i.isActive).map(i => ({ id: i.id, itemSizeId: i.itemSizeId, quantity: i.quantity.toFixed(3), unitPrice: i.unitPrice.toFixed(2) })),
    }, branch, editor);
    assert.equal(identical.revision, 1);
    assert.equal(identical.version, 3);
    const statusOnly = await repository.update(invoiceQuote.id, { version: 3, status: 'REVISED' }, branch, editor);
    assert.equal(statusOnly.revision, 1);
    assert.equal(statusOnly.version, 4);
    await assert.rejects(repository.update(invoiceQuote.id, { version: 4, revision: 99 }, branch, editor));
    console.log('Quotation integration checks passed: totals, concurrent updates, rollback, snapshots, audit, branch isolation, soft deletion, nullable invoice updates.');
  } finally {
    // Only fixtures belonging to this randomly generated branch are removed.
    await prisma.quotationHistory.deleteMany({ where: { quotation: { officeBranchId: branch } } });
    await prisma.quotationItem.deleteMany({ where: { quotation: { officeBranchId: branch } } });
    await prisma.quotation.deleteMany({ where: { officeBranchId: branch } });
    await prisma.quotationSequence.deleteMany({ where: { officeBranchId: branch } });
    if (service) await prisma.service.delete({ where: { id: service.id } });
    if (company) await prisma.company.delete({ where: { id: company.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
