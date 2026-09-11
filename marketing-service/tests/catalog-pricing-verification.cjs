const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const itemRoutes = require('../dist/modules/items/item.routes.js').default;
const contractRoutes = require('../dist/modules/contracts/contract.routes.js').default;
const companyRoutes = require('../dist/modules/companies/company.routes.js').default;

async function main() {
  const branch = randomUUID(), foreignBranch = randomUUID(), actor = randomUUID();
  const companies = [], services = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor, firstName: 'Catalog', lastName: 'Test', username: 'test', officeBranchId: req.headers['x-branch'] ?? branch }; next(); });
  app.use('/items', itemRoutes); app.use('/company-contracts', contractRoutes); app.use('/companies', companyRoutes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (method, path, body, officeBranchId = branch) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { 'content-type': 'application/json', 'x-branch': officeBranchId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const ok = async (method, path, body, expected = 200) => {
    const result = await request(method, path, body); assert.equal(result.status, expected, JSON.stringify(result.body)); return result.body.data;
  };
  const company = async (isSisterCompany = false) => {
    const row = await ok('POST', '/companies', { name: randomUUID(), type: 'PT', npwp: '0012345678901234', address: 'Jakarta', isSisterCompany }, 201);
    companies.push(row.id); assert.equal(Object.hasOwn(row, 'hasContract'), false); assert.equal(row.isSisterCompany, isSisterCompany); return row;
  };
  try {
    const primary = await company(), sister = await company(true);
    assert.equal((await request('POST', '/companies', { name: 'bad', type: 'PT', npwp: '0012345678901234', address: 'x', hasContract: true })).status, 400);
    const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Inspection', type: 'TUBULAR', hasMaintenance: true } });
    services.push(service.id);
    const prices = { priceServicePrimary: '100.25', priceServiceSisterCompany: '80.15', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '10' };
    const input = { serviceId: service.id, name: 'Pipe', sizes: [{ size: 'Large', ...prices }] };
    const auditCount = await prisma.catalogAuditLog.count({ where: { officeBranchId: branch } });
    assert.equal((await request('POST', '/items', { ...input, sizes: [input.sizes[0], input.sizes[0]] })).status, 409);
    assert.equal(await prisma.item.count({ where: { officeBranchId: branch } }), 0);
    assert.equal(await prisma.catalogAuditLog.count({ where: { officeBranchId: branch } }), auditCount);
    for (const value of [undefined, null, '', false, -1, '-1', '1.001']) {
      for (const field of ['priceServicePrimary', 'priceServiceSisterCompany']) {
        assert.equal((await request('POST', '/items', { ...input, sizes: [{ ...input.sizes[0], [field]: value }] })).status, 400);
      }
    }
    const item = await ok('POST', '/items', input, 201), size = item.sizes[0];
    assert.equal(item.version, 0); assert.equal(size.version, 0); assert.equal(size.priceVersion, 0);
    assert.equal((await request('DELETE', `/items/${item.id}`, {})).status, 400);
    assert.equal((await request('POST', '/items/sizes', { itemId: item.id, size: 'Small', ...prices })).status, 400);
    const base = `/items/sizes/${size.id}`;
    const resolve = id => ok('GET', `/items/sizes/prices?companyId=${id}&itemId=${item.id}`);
    assert.equal((await request('GET', '/items/sizes/prices')).status, 400);
    let resolved = await resolve(primary.id);
    assert.equal(resolved.sizes[0].priceSource, 'PRIMARY'); assert.equal(resolved.sizes[0].priceService, '100.25');
    resolved = await resolve(sister.id);
    assert.equal(resolved.sizes[0].priceSource, 'SISTER_COMPANY'); assert.equal(resolved.sizes[0].priceService, '80.15');
    assert.equal((await request('GET', `/items/sizes/prices?companyId=${primary.id}`, undefined, foreignBranch)).status, 404);
    assert.equal((await request('PATCH', `${base}/price`, { version: 0, ...prices }, foreignBranch)).status, 404);

    const updates = await Promise.all([1, 2].map(n => request('PATCH', `${base}/price`, { ...prices, priceServicePrimary: String(110 + n), version: 0 })));
    assert.deepEqual(updates.map(r => r.status).sort(), [200, 409]);
    const currentPrice = await ok('GET', `${base}/price`);
    assert.equal(currentPrice.version, 1);
    let history = await ok('GET', `/items/history?entityType=ITEM_PRICE&entityId=${currentPrice.id}`);
    assert.equal(history.pagination.total, 2);
    assert.equal(history.history[0].before.priceServicePrimary, '100.25');
    assert.equal(history.history[0].after.priceServicePrimary, currentPrice.priceServicePrimary);
    assert.equal(history.history[0].createdById, actor);
    assert.equal((await request('PATCH', base, { version: 0, size: 'Renamed' })).status, 409);
    assert.equal((await request('DELETE', `/items/${item.id}`, { version: 0 })).status, 409);
    let itemNow = await ok('GET', `/items/${item.id}`);
    const itemUpdates = await Promise.all(['Pipe A', 'Pipe B'].map(name => request('PATCH', `/items/${item.id}`, { version: itemNow.version, name })));
    assert.deepEqual(itemUpdates.map(r => r.status).sort(), [200, 409]);
    let sizeNow = await ok('GET', base);
    const sizeUpdates = await Promise.all(['Large A', 'Large B'].map(label => request('PATCH', base, { version: sizeNow.version, size: label })));
    assert.deepEqual(sizeUpdates.map(r => r.status).sort(), [200, 409]);
    await ok('DELETE', `${base}/price`, { version: currentPrice.version });
    assert.equal((await resolve(primary.id)).sizes[0].priceStatus, 'UNAVAILABLE');
    const retired = await ok('GET', `${base}/price`);
    await ok('PATCH', `${base}/price`, { version: retired.version, ...prices, priceServicePrimary: 0, isActive: true });
    resolved = await resolve(primary.id); assert.equal(resolved.sizes[0].priceStatus, 'AVAILABLE'); assert.equal(resolved.sizes[0].priceService, '0');

    const period = { companyId: primary.id, status: 'ACTIVE', effectiveFrom: '2020-01-01T00:00:00Z', effectiveUntil: '2099-01-01T00:00:00Z' };
    for (const body of [{ ...period, effectiveUntil: period.effectiveFrom }, { ...period, effectiveUntil: '2019-01-01T00:00:00Z' }, { companyId: primary.id }]) {
      assert.equal((await request('POST', '/company-contracts', body)).status, 400);
    }
    const attempts = await Promise.all([0, 1].map(() => request('POST', '/company-contracts', period)));
    assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
    const contract = attempts.find(r => r.status === 201).body.data;
    assert.equal((await request('POST', '/company-contracts', period)).status, 409);
    // Date ordering is enforced by the API, not by database CHECK/range construction.
    for (const end of [period.effectiveFrom, '2019-01-01T00:00:00Z']) {
      const row = await prisma.companyContract.create({ data: {
        companyId: primary.id, effectiveFrom: new Date(period.effectiveFrom), effectiveUntil: new Date(end),
        createdById: actor, createdByName: 'Date ordering test',
      } });
      assert.equal(row.effectiveUntil.toISOString(), new Date(end).toISOString());
      await prisma.companyContract.delete({ where: { id: row.id } });
    }
    resolved = await resolve(primary.id); assert.equal(resolved.sizes[0].priceSource, 'CONTRACT'); assert.equal(resolved.sizes[0].priceStatus, 'UNAVAILABLE'); assert.equal(resolved.sizes[0].priceService, null);
    for (const value of [undefined, null, '', false, -1, '-1', '2.123']) {
      assert.equal((await request('POST', `${base}/contract-prices`, { contractId: contract.id, priceService: value, priceMaintenance: '5' })).status, 400);
    }
    assert.equal((await request('POST', `${base}/contract-prices`, { companyId: primary.id, priceService: 10 })).status, 400);
    const cp = await ok('POST', `${base}/contract-prices`, { contractId: contract.id, priceService: '60', priceMaintenance: '5' }, 201);
    assert.equal(cp.contractId, contract.id); assert.equal(Object.hasOwn(cp, 'companyId'), false);
    assert.equal((await request('POST', `${base}/contract-prices`, { contractId: contract.id, priceService: '60', priceMaintenance: '5' })).status, 409);
    resolved = await resolve(primary.id); assert.equal(resolved.sizes[0].priceService, '60'); assert.equal(resolved.sizes[0].priceSource, 'CONTRACT');
    assert.equal((await request('PATCH', `/company-contracts/${contract.id}`, { version: 0, effectiveFrom: period.effectiveFrom, effectiveUntil: period.effectiveUntil })).status, 409);
    const cpUpdates = await Promise.all([65, 70].map(value => request('PATCH', `/items/contract-prices/${cp.id}`, { version: 0, priceService: value, priceMaintenance: 5 })));
    assert.deepEqual(cpUpdates.map(r => r.status).sort(), [200, 409]);
    let contractNow = await ok('GET', `/company-contracts/${contract.id}`);
    const contractUpdates = await Promise.all(['2098', '2097'].map(year => request('PATCH', `/company-contracts/${contract.id}`, { version: contractNow.version, effectiveFrom: period.effectiveFrom, effectiveUntil: `${year}-01-01T00:00:00Z` })));
    assert.deepEqual(contractUpdates.map(r => r.status).sort(), [200, 409]);
    contractNow = await ok('GET', `/company-contracts/${contract.id}`);
    await ok('PATCH', `/company-contracts/${contract.id}`, { version: contractNow.version, effectiveFrom: '2090-01-01T00:00:00Z', effectiveUntil: '2099-01-01T00:00:00Z' });
    assert.equal((await resolve(primary.id)).sizes[0].priceSource, 'PRIMARY');
    contractNow = await ok('GET', `/company-contracts/${contract.id}`);
    await ok('PATCH', `/company-contracts/${contract.id}`, { version: contractNow.version, effectiveFrom: '2010-01-01T00:00:00Z', effectiveUntil: '2011-01-01T00:00:00Z' });
    assert.equal((await resolve(primary.id)).sizes[0].priceSource, 'PRIMARY');
    contractNow = await ok('GET', `/company-contracts/${contract.id}`);
    await ok('PATCH', `/company-contracts/${contract.id}`, { version: contractNow.version, effectiveFrom: period.effectiveFrom, effectiveUntil: null });
    assert.equal((await resolve(primary.id)).sizes[0].priceSource, 'CONTRACT');
    const copiedCompany = await ok('PATCH', `/companies/${primary.id}`, { version: primary.version, name: randomUUID(), isSisterCompany: true });
    companies.push(copiedCompany.id);
    assert.equal(copiedCompany.isSisterCompany, true);
    resolved = await resolve(copiedCompany.id); assert.equal(resolved.sizes[0].priceSource, 'CONTRACT');
    assert.equal(copiedCompany.id, primary.id);
    const copiedContract = (await ok('GET', `/company-contracts?companyId=${copiedCompany.id}`)).contracts[0];
    const copiedPrice = resolved.sizes[0].contractPrice;
    assert.equal(copiedContract.id, contract.id); assert.equal(copiedPrice.id, cp.id);
    await ok('DELETE', `/items/contract-prices/${copiedPrice.id}`, { version: copiedPrice.version });
    assert.equal((await resolve(copiedCompany.id)).sizes[0].priceStatus, 'UNAVAILABLE');
    await ok('PATCH', `/items/contract-prices/${copiedPrice.id}`, { version: copiedPrice.version + 1, priceService: '55', priceMaintenance: '5', isActive: true });
    contractNow = await ok('GET', `/company-contracts/${copiedContract.id}`);
    await ok('DELETE', `/company-contracts/${copiedContract.id}`, { version: contractNow.version });
    assert.equal((await resolve(copiedCompany.id)).sizes[0].priceSource, 'SISTER_COMPANY');

    // Audit is read-only through HTTP, and duplicate sizes are rejected before saving.
    const auditBefore = await prisma.catalogAuditLog.findUniqueOrThrow({ where: { id: history.history[0].id } });
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/items/history/${auditBefore.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'TAMPER' }),
    })).status, 404);
    assert.deepEqual(await prisma.catalogAuditLog.findUniqueOrThrow({ where: { id: auditBefore.id } }), auditBefore);
    const duplicateItem = await ok('GET', `/items/${item.id}`);
    assert.equal((await request('POST', '/items/sizes', {
      itemId: item.id, itemVersion: duplicateItem.version, size: (await ok('GET', base)).size, ...prices,
    })).status, 409);
    const missing = await prisma.itemSize.create({ data: { itemId: item.id, size: 'Missing', createdById: actor, createdByName: 'Test' } });
    assert.equal((await request('GET', `/items/sizes/${missing.id}/price`)).status, 404);
    assert.equal((await resolve(sister.id)).sizes.find(row => row.id === missing.id).priceStatus, 'UNAVAILABLE');
    await ok('POST', `/items/sizes/${missing.id}/price`, prices, 201);
    assert.equal((await resolve(sister.id)).sizes.find(row => row.id === missing.id).priceStatus, 'AVAILABLE');
    itemNow = await ok('GET', `/items/${item.id}`);
    const race = await Promise.all([
      request('DELETE', `/items/${item.id}`, { version: itemNow.version }),
      request('POST', '/items/sizes', { itemId: item.id, itemVersion: itemNow.version, size: 'Race', ...prices }),
    ]);
    assert.equal(race.filter(r => r.status === 200 || r.status === 201).length, 1);
    assert.equal(race.filter(r => r.status === 409).length, 1);
    if (race[0].status === 409) {
      itemNow = await ok('GET', `/items/${item.id}`); await ok('DELETE', `/items/${item.id}`, { version: itemNow.version });
    }
    assert.equal(await prisma.itemSize.count({ where: { itemId: item.id, isActive: true } }), 0);
    assert.equal(await prisma.itemPrice.count({ where: { itemSize: { itemId: item.id }, isActive: true } }), 0);
    assert.equal(await prisma.companyContractPrice.count({ where: { itemSize: { itemId: item.id }, isActive: true } }), 0);
    history = await ok('GET', `/items/history?entityType=ITEM&entityId=${item.id}`);
    assert.equal(history.history[0].action, 'DEACTIVATE');
    console.log('PASS: API price/period/duplicate validation, company flag, contract CRUD/copy, resolution, concurrency, parent-delete race and read-only audit API.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (companies.length) await prisma.companyHistory.deleteMany({ where: { companyId: { in: companies } } });
    if (companies.length) await prisma.company.deleteMany({ where: { id: { in: companies } } });
    if (services.length) await prisma.service.deleteMany({ where: { id: { in: services } } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
