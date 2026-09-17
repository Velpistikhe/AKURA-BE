const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/items/item.routes.js').default;
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');
const { renderQuotationPdf } = require('../dist/modules/quotations/quotation-pdf.js');
const { createPriceWorkbook, parsePriceWorkbook } = require('../dist/modules/contracts/contract-excel.workbook.js');
const { contractExcelRepository } = require('../dist/modules/contracts/contract-excel.repository.js');

async function main() {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'Unsized test' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor.id, firstName: 'Unsized', lastName: 'test', officeBranchId: req.headers['x-branch'] || branch }; next(); });
  app.use('/items', routes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  async function request(method, path, body, status = 200, requestBranch = branch) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/items${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-branch': requestBranch },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (status !== null) assert.equal(response.status, status, JSON.stringify(result));
    return status === null ? response.status : status >= 400 ? result : result.data;
  }
  try {
    const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Inspection', type: 'TUBULAR', hasMaintenance: true, ...audit } });
    const input = { serviceId: service.id, name: 'Without size', uom: 'SET' };
    const item = await request('POST', '', input, 201);
    assert.equal(item.sizes.length, 1);
    const size = item.sizes[0];
    assert.equal(size.size, null);
    assert.equal(size.priceStatus, 'UNAVAILABLE');
    for (const sizes of [[], [{ size: null }]]) {
      const result = await request('POST', '', { ...input, name: randomUUID(), sizes }, 201);
      assert.equal(result.sizes.length, 1);
      assert.equal(result.sizes[0].size, null);
    }
    const named = await request('POST', '', { ...input, name: 'Named', sizes: [{ size: 'Large' }, { size: 'Small' }] }, 201);
    assert.deepEqual(named.sizes.map(row => row.size), ['Large', 'Small']);
    const directError = await request('POST', '/sizes', { itemId: item.id, itemVersion: item.version, size: 'Large' }, 409);
    assert.equal(directError.message, 'This item uses direct pricing and cannot have additional sizes');
    const namedError = await request('POST', '/sizes', { itemId: named.id, itemVersion: named.version, size: null }, 409);
    assert.equal(namedError.message, 'An item with named sizes cannot use direct pricing');
    for (const sizes of [[{ size: null }, { size: 'Large' }], [{ size: 'Large' }, { size: null }]]) {
      await request('POST', '', { ...input, name: 'Mixed rollback', sizes }, 409);
      assert.equal(await prisma.item.count({ where: { officeBranchId: branch, name: 'Mixed rollback' } }), 0);
    }
    assert.equal((await request('GET', `/${item.id}`)).version, item.version);
    assert.equal(await prisma.itemSize.count({ where: { itemId: item.id } }), 1);
    await request('POST', '', { ...input, name: 'Rollback', sizes: [{ size: null }, { size: null }] }, 409);
    assert.equal(await prisma.item.count({ where: { officeBranchId: branch, name: 'Rollback' } }), 0);
    for (const invalid of ['', ' ', 123]) await request('POST', '/sizes', { itemId: item.id, itemVersion: item.version, size: invalid }, 400);
    await request('POST', '/sizes', { itemId: item.id, itemVersion: item.version, size: null }, 409);
    await request('GET', `/sizes/${size.id}`, undefined, 404, randomUUID());
    const listed = await request('GET', `/sizes?itemId=${item.id}`);
    assert.equal(listed.sizes[0].size, null);
    assert.equal((await request('GET', `/sizes?itemId=${item.id}&size=Large`)).pagination.total, 0);
    const price = await request('POST', `/sizes/${size.id}/price`, {
      priceServicePrimary: '100', priceServiceSisterCompany: '80', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '10',
    }, 201);
    const updatedPrice = await request('PATCH', `/sizes/${size.id}/price`, { version: price.version, priceServicePrimary: '120' });
    assert.equal(updatedPrice.priceServicePrimary, '120');
    const priceHistory = await request('GET', `/sizes/${size.id}/price/history`);
    assert(priceHistory.history.some(row => row.changes.some(change => change.field === 'priceServicePrimary' && change.before === '100' && change.after === '120')));
    const sizeHistory = await request('GET', `/sizes/${size.id}/history`);
    assert(sizeHistory.history.some(row => row.action === 'CREATE' && row.changes.some(change => change.field === 'size' && change.after === null)));

    const company = await prisma.company.create({ data: { officeBranchId: branch, name: 'Customer', normalizeName: randomUUID(), type: 'PT', npwp: '1', address: 'Jakarta', createdById: actor.id } });
    const options = await request('GET', `/sizes/prices?companyId=${company.id}&itemId=${item.id}`);
    assert.equal(options.sizes[0].size, null);
    assert.equal(options.sizes[0].priceService, '120');
    await prisma.taxCache.create({ data: { id: randomUUID(), officeBranchId: branch, percentage: '11', effectiveFrom: new Date('2000-01-01'), sourceUpdatedAt: new Date() } });
    const quoteInput = { companyId: company.id, inquiryMethod: 'EMAIL', inquiryDate: '2026-01-01', subject: 'Unsized', termOfPayment: '30 days', validity: '30 days', supplyAkura: 'Tools', supplyCustomer: 'Access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF', items: [{ itemSizeId: size.id, quantityInspection: '2', quantityMaintenance: '1' }] };
    const quote = await quotationRepository.create(quoteInput, branch, actor);
    assert.equal(quote.items[0].size, null);
    assert.equal(quote.subTotal.toString(), '260');
    await prisma.company.update({ where: { id: company.id }, data: { isSisterCompany: true } });
    const sister = await quotationRepository.create(quoteInput, branch, actor);
    assert.equal(sister.items[0].priceInspection.toString(), '80');
    assert.equal(sister.subTotal.toString(), '170');
    const texts = [], originalText = PDFDocument.prototype.text;
    PDFDocument.prototype.text = function (value, ...args) { texts.push(String(value)); return originalText.call(this, value, ...args); };
    try {
      const pdf = await renderQuotationPdf({ ...quote, no: 1, numberYear: 2026 }, actor, new Date());
      assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
      assert(texts.some(text => text.includes(item.name)));
      assert(!texts.some(text => text.includes(`${item.name} - null`) || text.includes(`${item.name} - `)));
    } finally { PDFDocument.prototype.text = originalText; }

    const contract = await prisma.companyContract.create({ data: { companyId: company.id, contractNumber: randomUUID(), contractDate: new Date('2020-01-01'), effectiveFrom: new Date('2020-01-01'), effectiveUntil: new Date('2099-01-01'), status: 'ACTIVE', createdById: actor.id } });
    const contractPrice = await request('POST', `/sizes/${size.id}/contract-prices`, { contractId: contract.id, priceService: '50', priceMaintenance: '5' }, 201);
    assert.equal(contractPrice.catalogSnapshot.size, null);
    const revised = await request('PATCH', `/contract-prices/${contractPrice.id}`, { version: contractPrice.version, priceService: '60', priceMaintenance: '5' });
    assert.equal(revised.priceService, '60');
    assert((await request('GET', `/sizes/${size.id}/history`)).history.some(row => row.entityType === 'COMPANY_CONTRACT_PRICE' && row.action === 'UPDATE'));
    const exportRows = await contractExcelRepository.exportSizes({ itemId: item.id }, branch);
    const buffer = await createPriceWorkbook(exportRows, branch);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    assert.equal(workbook.getWorksheet('Harga Normal').getCell('D6').value, null);
    const importedRows = await parsePriceWorkbook(buffer, branch);
    assert.equal(importedRows[0].itemSizeId, size.id);
    const secondCompany = await prisma.company.create({ data: { officeBranchId: branch, name: 'Import customer', normalizeName: randomUUID(), type: 'PT', npwp: '2', address: 'Jakarta', createdById: actor.id } });
    const secondContract = await prisma.companyContract.create({ data: { companyId: secondCompany.id, contractNumber: randomUUID(), contractDate: new Date('2020-01-01'), effectiveFrom: new Date('2020-01-01'), effectiveUntil: new Date('2099-01-01'), status: 'ACTIVE', createdById: actor.id } });
    await contractExcelRepository.importPrices(secondContract.id, secondCompany.id, secondContract.version, importedRows, branch, actor);
    assert.equal((await prisma.companyContractPrice.findFirst({ where: { contractId: secondContract.id } })).catalogSnapshot.size, null);

    // Existing items without any size can opt in. Concurrent requests create exactly one variant.
    const legacy = await prisma.item.create({ data: { officeBranchId: branch, serviceId: service.id, name: 'Legacy', uom: 'SET', ...audit } });
    const statuses = await Promise.all([1, 2].map(() => request('POST', '/sizes', { itemId: legacy.id, itemVersion: 0, size: null }, null)));
    assert.deepEqual(statuses.sort(), [201, 409]);
    const original = await prisma.itemSize.findFirst({ where: { itemId: legacy.id } });
    await request('DELETE', `/sizes/${original.id}`, { version: original.version });
    const latestItem = await request('GET', `/${legacy.id}`);
    await request('POST', '/sizes', { itemId: legacy.id, itemVersion: latestItem.version, size: 'Large' }, 409);
    const replacement = await request('POST', '/sizes', { itemId: legacy.id, itemVersion: latestItem.version, size: null }, 201);
    assert.notEqual(replacement.id, original.id);
    assert.equal(await prisma.itemSize.count({ where: { itemId: legacy.id, isActive: true, size: null } }), 1);
    console.log('PASS: unsized creation, validation, concurrency, soft deletion, prices, history, primary/sister quotations, PDF, contract and Excel round trip.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const where = { officeBranchId: branch };
    await prisma.quotationHistory.deleteMany({ where: { quotation: where } });
    await prisma.quotationItem.deleteMany({ where: { quotation: where } });
    await prisma.quotation.deleteMany({ where });
    await prisma.taxCache.deleteMany({ where });
    await prisma.companyContractPrice.deleteMany({ where: { contract: { company: where } } });
    await prisma.companyContractHistory.deleteMany({ where: { companyContract: { company: where } } });
    await prisma.company.deleteMany({ where });
    await prisma.service.deleteMany({ where });
    await prisma.catalogAuditLog.deleteMany({ where });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
