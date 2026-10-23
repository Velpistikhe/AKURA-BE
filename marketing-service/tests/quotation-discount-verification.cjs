// External harness: verifies the discount percentage (0-100) recalculation for
// POST /quotations and POST /quotations/:quotationId/items on an isolated branch.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../dist/config/db.js');
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');

async function main() {
  const branch = randomUUID();
  const actor = { id: randomUUID(), name: 'Discount quotation test', section: 'MARKETING', role: 'USER' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  try {
    const company = await prisma.company.create({ data: {
      officeBranchId: branch, name: 'Discount customer', normalizeName: randomUUID(), type: 'PT', npwp: '1', address: 'Jakarta',
      staffs: { create: { name: 'Contact', normalizeName: randomUUID(), title: 'mr' } },
    }, include: { staffs: true } });
    const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Inspection', type: 'TUBULAR', hasMaintenance: true, ...audit } });
    const catalogItem = await prisma.item.create({ data: { officeBranchId: branch, serviceId: service.id, name: 'Pipe', uom: 'JOINT', ...audit } });
    const sizes = [];
    for (const label of ['Large', 'Small']) sizes.push(await prisma.itemSize.create({ data: { itemId: catalogItem.id, size: label, ...audit, price: {
      create: { priceServicePrimary: '100', priceServiceSisterCompany: '100', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '20', ...audit },
    } } }));
    await prisma.taxCache.create({ data: { id: randomUUID(), officeBranchId: branch, percentage: '11', effectiveFrom: new Date('2000-01-01'), sourceUpdatedAt: new Date() } });

    const header = {
      jobStart: '2026-10-01', companyId: company.id, inquiryMethod: 'EMAIL', inquiryDate: '2026-01-01', subject: 'Discount quotation',
      termOfPayment: '30 days', validity: '30 days', supplyAkura: 'Tools', supplyCustomer: 'Access', location: 'Jakarta',
      accomplished: '7 days', deliveryReports: 'PDF', deliveryInvoice: 'After report', staffId: company.staffs[0].id,
    };

    // Create: 15 percent applies to both unit prices. (100 - 15) * 2 + (20 - 3) * 1 = 187.00, tax 11% = 20.57.
    const quote = await quotationRepository.create({
      ...header, items: [{ itemSizeId: sizes[0].id, quantityInspection: '2', quantityMaintenance: '1', discount: '15' }],
    }, branch, actor);
    assert.equal(quote.items[0].discount.toFixed(2), '15.00');
    assert.equal(quote.items[0].priceInspection.toFixed(2), '100.00', 'catalog price stays untouched');
    assert.equal(quote.items[0].priceMaintenance.toFixed(2), '20.00');
    assert.equal(quote.items[0].subTotal.toFixed(2), '187.00');
    assert.equal(quote.subTotal.toFixed(2), '187.00');
    assert.equal(quote.taxAmount.toFixed(2), '20.57');
    assert.equal(quote.total.toFixed(2), '207.57');

    // Without discount the line keeps the plain calculation.
    const plain = await quotationRepository.create({
      ...header, subject: 'No discount', items: [{ itemSizeId: sizes[0].id, quantityInspection: '2', quantityMaintenance: '1' }],
    }, branch, actor);
    assert.equal(plain.items[0].discount.toFixed(2), '0.00');
    assert.equal(plain.items[0].subTotal.toFixed(2), '220.00');

    // A 100 percent discount reduces the effective unit price to zero.
    const free = await quotationRepository.create({
      ...header, subject: 'Free line', items: [{ itemSizeId: sizes[0].id, quantityInspection: '1', discount: '100' }],
    }, branch, actor);
    assert.equal(free.items[0].subTotal.toFixed(2), '0.00');
    assert.equal(free.total.toFixed(2), '0.00');

    // Add item: 10 percent of 100 leaves 90.00 on top of the stored 187.00; totals recalculate in the same transaction.
    const added = await quotationRepository.addItem(quote.id, {
      version: quote.version, itemSizeId: sizes[1].id, quantityInspection: '1', discount: '10',
    }, branch, actor);
    const addedItem = added.items.find(row => row.itemSizeId === sizes[1].id && row.isActive);
    assert.equal(addedItem.discount.toFixed(2), '10.00');
    assert.equal(addedItem.priceInspection.toFixed(2), '100.00');
    assert.equal(addedItem.subTotal.toFixed(2), '90.00');
    assert.equal(added.subTotal.toFixed(2), '277.00');
    assert.equal(added.taxAmount.toFixed(2), '30.47');
    assert.equal(added.total.toFixed(2), '307.47');

    // Stored rows agree with the response.
    const stored = await quotationRepository.find(quote.id, branch);
    assert.equal(stored.subTotal.toFixed(2), '277.00');
    assert.equal(stored.items.reduce((sum, row) => sum.add(row.subTotal), new Prisma.Decimal(0)).toFixed(2), '277.00');

    // Invalid discounts are rejected before any write, on both endpoints.
    const fresh = await quotationRepository.create({
      ...header, subject: 'Invalid discount target', items: [{ itemSizeId: sizes[0].id, quantityInspection: '1' }],
    }, branch, actor);
    for (const discount of ['-1', '10.001', '100.01', '101', null]) {
      const badCreate = { ...header, subject: 'Invalid', items: [{ itemSizeId: sizes[0].id, quantityInspection: '1', discount }] };
      await assert.rejects(quotationRepository.create(badCreate, branch, actor), e => e.name === 'ZodError', String(discount));
      await assert.rejects(
        quotationRepository.addItem(fresh.id, { version: fresh.version, itemSizeId: sizes[1].id, quantityInspection: '1', discount }, branch, actor),
        e => e.name === 'ZodError', String(discount));
    }
    console.log('PASS: per-unit discount recalculates item subTotal and quotation totals on create and add-item, floors at zero, and rejects invalid values.');
  } finally {
    const where = { officeBranchId: branch };
    await prisma.quotationSnapshot.deleteMany({ where: { quotation: where } });
    await prisma.quotationHistory.deleteMany({ where: { quotation: where } });
    await prisma.quotationItem.deleteMany({ where: { quotation: where } });
    await prisma.quotation.deleteMany({ where });
    await prisma.taxCache.deleteMany({ where });
    await prisma.company.deleteMany({ where });
    await prisma.service.deleteMany({ where });
    await prisma.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

