const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const { prisma } = require('../dist/config/db.js');
const itemRoutes = require('../dist/modules/items/item.routes.js').default;
const contractRoutes = require('../dist/modules/contracts/contract.routes.js').default;
const companyRoutes = require('../dist/modules/companies/company.routes.js').default;

async function main() {
  const branch = randomUUID(), actor = randomUUID();
  const companies = [], services = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor, officeBranchId: req.headers['x-branch'] || branch, firstName: 'Excel', lastName: 'Test' }; next(); });
  app.use('/items', itemRoutes); app.use('/company-contracts', contractRoutes); app.use('/companies', companyRoutes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (method, path, body, expected = 200) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result.data;
  };
  const upload = async (contract, buffer, expected = 201, officeBranchId = branch) => {
    const form = new FormData(); form.append('companyId', contract.companyId); form.append('version', String(contract.version));
    form.append('file', new Blob([buffer]), 'prices.xlsx');
    const response = await fetch(`${base}/company-contracts/${contract.id}/prices/import`, { method: 'POST', headers: { 'x-branch': officeBranchId }, body: form });
    const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body.data;
  };
  try {
    const company = await json('POST', '/companies', { name: randomUUID(), type: 'PT', npwp: '0012345678901234', address: 'Test' }, 201); companies.push(company.id);
    const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Normal Service', type: 'TUBULAR', hasMaintenance: true } }); services.push(service.id);
    const item = await json('POST', '/items', { serviceId: service.id, name: 'Pipe', sizes: [
      { size: 'Large', priceServicePrimary: '100.25', priceServiceSisterCompany: '70', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '10' },
      { size: 'Small', priceServicePrimary: '90', priceServiceSisterCompany: '60', priceMaintenancePrimary: '15', priceMaintenanceSisterCompany: '5' },
    ] }, 201);
    const period = { companyId: company.id, effectiveFrom: '2020-01-01T00:00:00Z', effectiveUntil: null };
    for (const status of ['active', 'CREATED', null, 1]) await json('POST', '/company-contracts', { ...period, status }, 400);
    let contract = await json('POST', '/company-contracts', period, 201);
    assert.equal(contract.status, 'CREATE');
    const resolve = () => json('GET', `/items/sizes/prices?companyId=${company.id}&itemId=${item.id}`);
    assert.equal((await resolve()).sizes[0].priceSource, 'PRIMARY');
    assert.equal((await json('GET', `/companies/${company.id}`)).contract, null);
    const exportPath = `${base}/items/sizes/export?itemId=${item.id}&size=Large&companyId=${company.id}`;
    assert.equal((await fetch(exportPath, { headers: { 'x-branch': randomUUID() } })).status, 404);
    assert.equal((await fetch(`${base}/items/sizes/export?companyId=${randomUUID()}`)).status, 404);
    assert.equal((await fetch(`${base}/items/sizes/export?companyId=invalid`)).status, 400);
    assert.equal((await fetch(`${base}/items/sizes/export?officeBranchId=${randomUUID()}`)).status, 400);
    const response = await fetch(exportPath);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /spreadsheetml/);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const sheet = workbook.getWorksheet('Harga Normal');
    assert.equal(sheet.rowCount, 6);
    assert.deepEqual([2, 3, 4, 5, 6].map(col => sheet.getRow(6).getCell(col).value), ['Normal Service', 'Pipe', 'Large', 100.25, 20]);
    assert.equal(sheet.getColumn(7).hidden, true);
    sheet.getCell('E6').value = -1;
    await upload(contract, await workbook.xlsx.writeBuffer(), 400);
    assert.equal(await prisma.companyContractPrice.count({ where: { contractId: contract.id } }), 0);
    sheet.getCell('E6').value = 55; sheet.getCell('F6').value = 12;
    const buffer = await workbook.xlsx.writeBuffer();
    await upload(contract, buffer, 403, randomUUID());
    const imported = await upload(contract, buffer); assert.equal(imported.imported, 1);
    await upload(contract, buffer, 409);
    assert.equal((await prisma.itemPrice.findUniqueOrThrow({ where: { itemSizeId: item.sizes[0].id } })).priceServicePrimary.toString(), '100.25');
    assert.equal((await resolve()).sizes[0].priceSource, 'PRIMARY');
    contract = await json('PATCH', `/company-contracts/${contract.id}`, { version: imported.version, status: 'ACTIVE' });
    assert.equal(contract.status, 'ACTIVE'); assert.equal(contract.effectiveFrom, period.effectiveFrom.replace('Z', '.000Z'));
    const resolved = await resolve(); assert.equal(resolved.sizes.find(row => row.id === item.sizes[0].id).priceService, '55');
    assert.equal((await json('GET', `/companies/${company.id}`)).contract.status, 'ACTIVE');
    await json('PATCH', `/company-contracts/${contract.id}`, { version: contract.version, effectiveUntil: '2019-01-01T00:00:00Z' }, 400);
    const draft = await json('POST', '/company-contracts', period, 201);
    await json('PATCH', `/company-contracts/${draft.id}`, { version: draft.version, status: 'ACTIVE' }, 409);
    for (const status of ['EXPIRED', 'TERMINATED']) {
      contract = await json('PATCH', `/company-contracts/${contract.id}`, { version: contract.version, status });
      assert.equal((await resolve()).sizes[0].priceSource, 'PRIMARY');
      assert.equal((await json('GET', `/companies/${company.id}`)).contract, null);
      await upload(contract, buffer, 409);
      await json('POST', `/items/sizes/${item.sizes[1].id}/contract-prices`, { contractId: contract.id, priceService: '5', priceMaintenance: '1' }, 409);
      assert.equal((await json('GET', `/company-contracts?companyId=${company.id}&status=${status}`)).contracts.length, 1);
    }
    const deleted = await json('DELETE', `/company-contracts/${draft.id}`, { version: draft.version });
    assert.equal(deleted.status, 'TERMINATED'); assert.equal(deleted.isActive, false);
    const foreign = await fetch(`${base}/items/sizes/export?itemId=${item.id}`, { headers: { 'x-branch': randomUUID() } }); assert.equal(foreign.status, 404);
    console.log('PASS: contract statuses/default/filter/activation/conflicts, primary Excel export, edited upload, rollback, stale/foreign templates and blocked terminal statuses.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (companies.length) await prisma.companyHistory.deleteMany({ where: { companyId: { in: companies } } });
    if (companies.length) await prisma.company.deleteMany({ where: { id: { in: companies } } });
    if (services.length) await prisma.service.deleteMany({ where: { id: { in: services } } });
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: branch } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
