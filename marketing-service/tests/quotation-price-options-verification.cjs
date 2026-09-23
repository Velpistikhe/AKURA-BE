const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const itemRoutes = require('../dist/modules/items/item.routes.js').default;
const serviceRoutes = require('../dist/modules/services/service.routes.js').default;
const quotationRoutes = require('../dist/modules/quotations/quotation.routes.js').default;
const { contractExcelRepository } = require('../dist/modules/contracts/contract-excel.repository.js');

async function main() {
  const branch = randomUUID(), actor = randomUUID(), otherBranch = randomUUID();
  const audit = { createdById: actor, createdByName: 'Price Options Test' };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor, firstName: 'Price Options', lastName: 'Test', officeBranchId: req.headers['x-branch'] || branch }; next(); });
  app.use('/items', itemRoutes); app.use('/services', serviceRoutes); app.use('/quotations', quotationRoutes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (method, path, body, status = 200, requestBranch = branch) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', 'x-branch': requestBranch }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json(); assert.equal(response.status, status, JSON.stringify(payload)); return payload.data;
  };
  const line = row => ({ itemSizeId: row.id, quantityInspection: '2' });
  const quote = (staffId, items) => ({ inquiryMethod: 'EMAIL', inquiryDate: '2026-09-11', subject: 'Mixed prices', termOfPayment: '30 days', validity: '30 days', tax: 0, supplyAkura: 'Tools', supplyCustomer: 'Access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF', staffId, items });
  try {
    const company = await prisma.company.create({ data: { officeBranchId: branch, name: 'Customer', normalizeName: 'customer', type: 'PT', address: 'Jakarta', npwp: '123' } });
    const staff = await prisma.companyStaff.create({ data: { companyId: company.id, name: 'Buyer', normalizeName: 'buyer', title: 'mr' } });
    const contract = await prisma.companyContract.create({ data: { companyId: company.id, contractNumber: 'SIGNED', contractDate: new Date('2026-01-01'), effectiveFrom: new Date('2020-01-01'), effectiveUntil: new Date('2099-01-01'), status: 'APPROVED', createdById: actor } });
    const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Original Service', type: 'TUBULAR', hasMaintenance: true, ...audit } });
    const item = await request('POST', '/items', { serviceId: service.id, uom: 'JOINT', name: 'Original Pipe', sizes: ['Contract', 'Normal', 'Imported', 'Incomplete', 'Missing'].map(size => ({ size })) }, 201);
    const [contractSize, normalSize, importedSize, incompleteSize] = item.sizes;
    const prices = { priceServicePrimary: '100', priceServiceSisterCompany: '80', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '10' };
    for (const size of item.sizes.slice(0, 4)) await request('POST', `/items/sizes/${size.id}/price`, prices, 201);
    const cp = await request('POST', `/items/sizes/${contractSize.id}/contract-prices`, { contractId: contract.id, priceService: '50', priceMaintenance: '5' }, 201);
    assert.deepEqual(cp.catalogSnapshot, { serviceName: 'Original Service', serviceType: 'TUBULAR', itemName: 'Original Pipe', size: 'Contract', hasMaintenance: true });
    // Excel snapshots follow the same schema, including maintenance requirements.
    const imported = await prisma.itemSize.findUniqueOrThrow({ where: { id: importedSize.id }, include: { price: true } });
    await contractExcelRepository.importPrices(contract.id, company.id, (await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } })).version,
      [{ row: 2, itemSizeId: imported.id, sizeVersion: imported.version, priceVersion: imported.price.version, priceService: '60', priceMaintenance: '6' }], branch, { id: actor, name: audit.createdByName });
    const importedPrice = await prisma.companyContractPrice.findUniqueOrThrow({ where: { contractId_itemSizeId: { contractId: contract.id, itemSizeId: imported.id } } });
    assert.equal(importedPrice.catalogSnapshot.itemName, 'Original Pipe');
    const incompletePrice = await request('POST', `/items/sizes/${incompleteSize.id}/contract-prices`, { contractId: contract.id, priceService: '70', priceMaintenance: '7' }, 201);
    // Simulate incomplete legacy data to ensure it does not silently fall back.
    await prisma.companyContractPrice.update({ where: { id: incompletePrice.id }, data: { priceMaintenance: null } });
    const options = async (query = '') => request('GET', `/items/sizes/prices?companyId=${company.id}&itemId=${item.id}${query}`);
    let list = await options();
    assert.equal(list.pagination.total, 5);
    assert.equal(new Set(list.sizes.map(row => row.id)).size, 5);
    const excluded = await options(`&exclude=${contractSize.id.toUpperCase()},${normalSize.id}&limit=2`);
    assert.equal(excluded.pagination.total, 3);
    assert.equal(excluded.sizes.length, 2);
    assert.equal(excluded.sizes.some(row => [contractSize.id, normalSize.id].includes(row.id)), false);
    const combined = await options(`&exclude=${contractSize.id},${contractSize.id}&notIn=${normalSize.id}`);
    assert.equal(combined.pagination.total, 3);
    const allExcluded = await options(`&exclude=${item.sizes.map(row => row.id).join(',')}`);
    assert.deepEqual(allExcluded.sizes, []); assert.equal(allExcluded.pagination.total, 0);
    for (const exclude of ['', 'invalid', `${contractSize.id},`, Array.from({ length: 101 }, () => contractSize.id).join(',')]) {
      await request('GET', `/items/sizes/prices?companyId=${company.id}&exclude=${exclude}`, undefined, 400);
    }

    const normal = list.sizes.find(row => row.id === normalSize.id);
    assert.equal(normal.priceService, '100'); assert.equal(normal.priceMaintenance, '20');
    assert.equal(normal.priceSource, 'PRIMARY'); assert.equal(normal.item.service.name, 'Original Service'); assert.equal(list.company.id, company.id);
    const contractOption = list.sizes.find(row => row.id === contractSize.id);
    assert.equal(contractOption.priceService, '50'); assert.equal(contractOption.priceMaintenance, '5');
    assert.equal(contractOption.priceSource, 'CONTRACT'); assert.equal(contractOption.contractId, contract.id);
    assert.equal(list.sizes.find(row => row.id === incompleteSize.id).priceStatus, 'AVAILABLE');
    await request('POST', '/quotations', quote(staff.id, [line(normal), line(list.sizes.find(row => row.id === contractSize.id))]), 201);
    await request('POST', '/quotations', quote(staff.id, [{ itemSizeId: normal.id, quantity: '1', unitPrice: '100' }]), 400);
    await request('POST', '/quotations', quote(staff.id, [{ ...line(normal), unitPrice: '1' }]), 400);
    await request('GET', `/items/sizes/prices?companyId=${company.id}`, undefined, 404, otherBranch);
    const companyOnly = await request('POST', '/quotations', { ...quote(staff.id, [{ ...line(normal), quantityMaintenance: 0 }]), staffId: undefined, companyId: company.id }, 201);
    assert.equal(companyOnly.status, 'CREATED'); assert.equal(companyOnly.invoiceStatus, null);
    for (const fields of [{status:'CREATED'},{status:'APPROVED'},{invoiceStatus:null},{invoiceStatus:'APPROVED'}]) {
      await request('POST','/quotations',{...quote(staff.id,[line(normal)]),...fields},400);
      await request('PATCH',`/quotations/${companyOnly.id}`,{version:companyOnly.version,...fields},400);
    }
    assert.equal((await request('GET',`/quotations/${companyOnly.id}`)).version,companyOnly.version);
    assert.equal(companyOnly.staffId, null); assert.equal(companyOnly.companySnapshot.id, company.id);
    assert.equal(companyOnly.items[0].quantityMaintenance, '0'); assert.equal(companyOnly.items[0].subTotal, '200');
    const incompleteOption = list.sizes.find(row=>row.id===incompleteSize.id);
    await request('POST','/quotations',quote(staff.id,[line(incompleteOption)]),201);
    await request('POST','/quotations',quote(staff.id,[{...line(incompleteOption),quantityMaintenance:1}]),409);
    for (const quantities of [{quantityInspection:0,quantityMaintenance:0},{quantityInspection:'2',quantityMaintenance:-1},{quantityInspection:'2',quantityMaintenance:null},{quantityInspection:'2',quantityMaintenance:'0.0001'},{quantityInspection:true}]) {
      await request('POST','/quotations',quote(staff.id,[{itemSizeId:normal.id,...quantities}]),400);
    }
    await request('POST','/quotations',quote(staff.id,[line(normal),line(normal)]),400);
    await request('POST','/quotations',{...quote(staff.id,[line(normal)]),companyId:randomUUID()},404);
    const savedPrice = await prisma.companyContractPrice.findUniqueOrThrow({ where: { id: cp.id } });
    const savedContract = await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } });
    const contractCount = await prisma.companyContract.count({ where: { companyId: company.id } });
    const beforeDelete = list.sizes.find(row => row.id === contractSize.id);
    await request('DELETE', `/items/sizes/${contractSize.id}`, { version: (await request('GET', `/items/sizes/${contractSize.id}`)).version });
    assert.deepEqual(await prisma.companyContractPrice.findUniqueOrThrow({ where: { id: cp.id } }), savedPrice);
    assert.deepEqual(await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } }), savedContract);
    assert.equal(await prisma.companyContract.count({ where: { companyId: company.id } }), contractCount);
    await request('POST', '/quotations', quote(staff.id, [line(beforeDelete)]), 201);
    list = await options();
    const deletedOption = list.sizes.find(row => row.id === contractSize.id);
    assert.equal(deletedOption.priceService, '50');
    assert.equal((await options(`&exclude=${contractSize.id}`)).sizes.some(row => row.id === contractSize.id), false);
    const historyQuote = await request('POST', '/quotations', quote(staff.id, [line(deletedOption)]), 201);
    // Server uses current prices when options were loaded earlier.
    const normalNow = list.sizes.find(row => row.id === normalSize.id);
    await request('PATCH', `/items/sizes/${normalSize.id}/price`, { version: (await prisma.itemPrice.findUniqueOrThrow({ where: { itemSizeId: normalSize.id } })).version, priceServicePrimary: '111' });
    const latest = await request('POST', '/quotations', quote(staff.id, [line(normalNow)]), 201);
    assert.equal(latest.items[0].priceInspection,'111');
    const refreshedCompanyOnly = await request('PATCH',`/quotations/${companyOnly.id}`,{version:companyOnly.version,items:[{id:companyOnly.items[0].id,...line(normal)}]});
    assert.equal(refreshedCompanyOnly.items[0].priceInspection,'111');assert.equal(refreshedCompanyOnly.items[0].subTotal,'222');
    const originalHistory = await prisma.quotationHistory.findUniqueOrThrow({where:{quotationId_version:{quotationId:companyOnly.id,version:0}}});
    assert.equal(originalHistory.snapshot.items[0].priceInspection,'100');

    await request('PATCH', `/items/${item.id}`, { version: (await request('GET', `/items/${item.id}`)).version, name: 'Renamed Pipe' });
    const serviceNow = await request('GET', `/services/${service.id}`);
    await request('PATCH', `/services/${service.id}`, { version: serviceNow.version, name: 'Renamed Service', hasMaintenance: false });
    const historicalSearch = await options('&itemName=ORIGINAL&serviceName=original&limit=2&sortBy=size&sortOrder=asc');
    assert.equal(historicalSearch.pagination.total, 3);
    assert.equal(historicalSearch.sizes.length, 2);
    assert.equal(historicalSearch.sizes[0].item.name, 'Original Pipe');
    assert.equal(historicalSearch.sizes[0].item.service.name, 'Original Service');
    const secondPage = await options('&itemName=ORIGINAL&limit=2&page=2&sortBy=size&sortOrder=asc');
    assert.equal(secondPage.sizes.length, 1);
    assert.equal((await options('&page=999')).pagination.total, 5);
    const contractBeforeServiceDelete = await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } });
    await request('DELETE', `/services/${service.id}`, { version: (await request('GET', `/services/${service.id}`)).version });
    assert.deepEqual(await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } }), contractBeforeServiceDelete);
    assert.deepEqual(await prisma.companyContractPrice.findUniqueOrThrow({ where: { id: cp.id } }), savedPrice);
    assert.equal(await prisma.itemPrice.count({ where: { isActive: true, itemSize: { itemId: item.id } } }), 0);
    list = await options(); assert.equal(list.pagination.total, 3);
    assert.equal(list.sizes.some(row => row.id === normalSize.id), false);
    const freshContractOption = list.sizes.find(row => row.id === contractSize.id);
    const maintenance = await request('POST', '/quotations', quote(staff.id, [{ ...line(freshContractOption), quantityMaintenance:'3' }]), 201);
    assert.equal(maintenance.items[0].priceMaintenance, '5'); assert.equal(maintenance.items[0].subTotal, '115');
    const maintained = await request('PATCH', `/quotations/${maintenance.id}`, { version: maintenance.version, items: [{ id: maintenance.items[0].id, itemSizeId: contractSize.id, quantityInspection: '3', quantityMaintenance: 0 }] });
    assert.equal(maintained.items[0].quantityMaintenance, '0'); assert.equal(maintained.items[0].subTotal, '150');
    const newQuote = await request('POST', '/quotations', quote(staff.id, [line(freshContractOption)]), 201);
    assert.equal(newQuote.items[0].serviceName, 'Original Service'); assert.equal(newQuote.items[0].itemName, 'Original Pipe');
    assert.equal(newQuote.items[0].priceSelection.priceId, cp.id);
    assert.equal((await request('GET', `/quotations/${historyQuote.id}`)).items[0].priceInspection, '50');
    // Submitted items are revalidated and priced again; saved history remains intact.
    const retained = await request('PATCH', `/quotations/${historyQuote.id}`, { version: historyQuote.version, items: [{ id: historyQuote.items[0].id, itemSizeId: contractSize.id, quantityInspection: '3' }] });
    assert.equal(retained.items[0].itemName, 'Original Pipe');
    await request('PATCH', `/quotations/${retained.id}`, { version: retained.version, items: [{ id: retained.items[0].id, itemSizeId: contractSize.id, quantityInspection: '3', unitPrice: '1' }] }, 400);
    // Inactive contract prices fall back to normal pricing for the active catalog size.
    await prisma.companyContractPrice.update({ where: { id: cp.id }, data: { isActive: false, version: { increment: 1 } } });
    const unavailable = (await options()).sizes.find(row => row.id === contractSize.id);
    assert.equal(unavailable.priceStatus, 'AVAILABLE');
    assert.equal(unavailable.priceService, '100'); assert.equal(unavailable.priceSource, 'PRIMARY');
    await request('POST', '/quotations', quote(staff.id, [line(unavailable)]), 201);
    await prisma.companyContract.update({ where: { id: contract.id }, data: { effectiveUntil: new Date('2021-01-01'), version: { increment: 1 } } });
    assert.equal((await options()).pagination.total, 5);
    // A different active catalog falls back to sister-company prices despite an unrelated contract.
    const otherService = await prisma.service.create({ data: { officeBranchId: branch, name: 'Other', type: 'OCTG', ...audit } });
    const otherItem = await request('POST', '/items', { serviceId: otherService.id, uom: 'JOINT', name: 'Other Item', sizes: [{ size: 'One' }] }, 201);
    await request('POST', `/items/sizes/${otherItem.sizes[0].id}/price`, prices, 201);
    await prisma.company.update({ where: { id: company.id }, data: { isSisterCompany: true, version: { increment: 1 } } });
    const fallback = (await request('GET', `/items/sizes/prices?companyId=${company.id}`)).sizes[0];
    assert.equal(fallback.priceService, '80'); assert.equal(fallback.item.service.hasMaintenance, false);
    await request('POST', '/quotations', quote(staff.id, [{ ...line(fallback),quantityMaintenance: '1' }]), 409);
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => request('POST', '/quotations', quote(staff.id, [line(fallback)]), 201)));
    assert.equal(new Set(concurrent.map(row => row.no)).size, 12);
    assert.ok(concurrent.every(row => row.items[0].priceInspection === '80' && row.items[0].priceSelection.priceSource === 'SISTER_COMPANY'));
    await request('POST', '/quotations', quote(staff.id, [{ ...line(fallback), priceSelection: {} }]), 400);
    const removed = concurrent[0];
    await request('DELETE', `/quotations/${removed.id}`, { version: removed.version });
    const listing = await request('GET', '/quotations?limit=100');
    assert.equal(listing.pagination.total, await prisma.quotation.count({ where: { officeBranchId: branch } }));
    const removedRow = listing.quotations.find(row => row.id === removed.id);
    assert.equal(removedRow.isActive, false);
    assert.equal(removedRow.items.length, removed.items.length);
    assert.ok(removedRow.items.every(row => row.isActive === false));
    assert.ok(listing.quotations.some(row => row.isActive));
    const otherListing = await request('GET', '/quotations?limit=100', undefined, 200, otherBranch);
    assert.equal(otherListing.pagination.total, 0);
    assert.deepEqual(otherListing.quotations, []);
    const paged = await request('GET', '/quotations?limit=1&page=2');
    assert.equal(paged.pagination.total, listing.pagination.total);
    assert.equal(paged.quotations.length, 1);
    await request('GET', `/quotations/${removed.id}`, undefined, 404);
    console.log('PASS: mixed options, snapshot search/pagination, service/size deletion, immutable contracts, Excel snapshots, current server prices and dual quantities, saved snapshots, sister prices and 12 concurrent quotation creates.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const quotes = { quotation: { officeBranchId: branch } };
    await prisma.quotationHistory.deleteMany({ where: quotes });
    await prisma.quotationItem.deleteMany({ where: quotes });
    await prisma.quotation.deleteMany({ where: { officeBranchId: branch } });
    await prisma.quotationSequence.deleteMany({ where: { officeBranchId: branch } });
    await prisma.companyContractHistory.deleteMany({ where: { companyContract: { company: { officeBranchId: branch } } } });
    await prisma.company.deleteMany({ where: { officeBranchId: branch } });
    await prisma.service.deleteMany({ where: { officeBranchId: branch } });
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: branch } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
