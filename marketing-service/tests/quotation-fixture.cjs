const { randomUUID } = require('node:crypto');
const { prisma } = require('../dist/config/db.js');
exports.withQuotationFixture = async run => {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'Quotation test', role: 'ADMIN', section: 'MARKETING' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  try {
    const company = await prisma.company.create({ data: { officeBranchId: branch, name: 'Quotation test', normalizeName: branch, type: 'PT', npwp: '123', address: 'Jakarta', staffs: { create: { name: 'Contact', normalizeName: branch, title: 'mr' } } }, include: { staffs: true } });
    const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Inspection', type: 'TUBULAR', ...audit, itemCatalog: { create: { officeBranchId: branch, name: 'Pipe', uom: 'JOINT', ...audit, sizes: { create: { size: 'Large', ...audit, price: { create: { priceServicePrimary: '100.25', ...audit } } } } } } }, include: { itemCatalog: { include: { sizes: true } } } });
    await prisma.taxCache.create({ data: { id: randomUUID(), officeBranchId: branch, percentage: '11', effectiveFrom: new Date('2000-01-01'), sourceUpdatedAt: new Date() } });
    const itemSizeId = service.itemCatalog[0].sizes[0].id;
    const input = { jobStart: '2026-11-01', inquiryMethod: 'EMAIL', inquiryDate: '2026-10-01', subject: 'Inspection quotation', termOfPayment: '30 days', validity: '30 days', supplyAkura: 'Equipment\nTools', supplyCustomer: 'Access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF', deliveryInvoice: 'Email', staffId: company.staffs[0].id, items: [{ itemSizeId, quantityInspection: '2.5', note: 'Initial item note' }] };
    await run({ branch, actor, company, service, itemSizeId, input, prisma });
  } finally {
    const where = { officeBranchId: branch }, quotation = { quotation: where };
    await prisma.quotation.updateMany({ where, data: { previousQuotationId: null } });
    for (const name of ['quotationPdf', 'quotationSnapshot', 'quotationHistory', 'quotationItem']) await prisma[name].deleteMany({ where: quotation });
    for (const name of ['quotation', 'quotationSequence', 'taxCache', 'service', 'company', 'catalogAuditLog']) await prisma[name].deleteMany({ where });
    await prisma.$disconnect();
  }
};
