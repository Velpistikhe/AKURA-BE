const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/items/item.routes.js').default;
const { itemRepository } = require('../dist/modules/items/item.repository.js');

async function main() {
  const branch = randomUUID();
  const otherBranch = randomUUID();
  const actor = { id: randomUUID(), name: 'Size list test' };
  const services = [];
  const companies = [];
  const app = express();
  app.use((req, res, next) => {
    res.locals.authUser = { officeBranchId: req.headers['x-test-branch'] ?? branch };
    next();
  });
  app.use('/items', routes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const get = async (query = '', officeBranchId = branch) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/items/sizes${query}`, {
      headers: { 'x-test-branch': officeBranchId },
    });
    return { status: response.status, body: await response.json() };
  };
  const create = async (name, serviceName, officeBranchId = branch, serviceBranch = officeBranchId) => {
    const service = await prisma.service.create({ data: { officeBranchId: serviceBranch, name: serviceName, type: 'TUBULAR' } });
    services.push(service.id);
    const created = await itemRepository.create({ serviceId: service.id, uom: 'JOINT', name,
      sizes: [{ size: 'Large', priceServicePrimary: 100, priceServiceSisterCompany: 90 }],
    }, serviceBranch, actor);
    if (officeBranchId !== serviceBranch) await prisma.item.update({ where: { id: created.id }, data: { officeBranchId } });
    return created;
  };
  try {
    const pipe = await create('Drill Pipe', 'Inspection');
    const casing = await create('Casing', 'Cleaning');
    const foreign = await create('Drill Pipe', 'Inspection', otherBranch);
    await create('Drill Pipe', 'Inspection', branch, otherBranch);
    const inactiveItem = await create('Drill Pipe', 'Inspection');
    await prisma.item.update({ where: { id: inactiveItem.id }, data: { isActive: false } });
    const inactiveService = await create('Drill Pipe', 'Inspection');
    await prisma.service.update({ where: { id: inactiveService.serviceId }, data: { isActive: false } });
    const inactiveSize = await create('Drill Pipe', 'Inspection');
    await itemRepository.removeSize(inactiveSize.sizes[0].id, branch, actor, 0);

    const global = await get();
    assert.equal(global.status, 200, JSON.stringify(global.body));
    assert.deepEqual(global.body.data.sizes.map(row => row.itemId).sort(), [pipe.id, casing.id].sort());
    assert.equal(global.body.data.pagination.total, 2);
    const row = global.body.data.sizes.find(row => row.itemId === pipe.id);
    assert.equal(row.item.name, 'Drill Pipe');
    assert.equal(row.item.officeBranchId, branch);
    assert.deepEqual(row.item.service, { id: pipe.serviceId, name: 'Inspection', type: 'TUBULAR', hasMaintenance: false });
    assert.equal(row.priceServicePrimary, '100');
    for (const query of ['?itemName=PIPE', '?serviceName=sPeC', '?itemName=pipe&serviceName=spec&size=ARG', `?itemId=${pipe.id}`]) {
      const result = await get(query);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data.sizes.map(row => row.itemId), [pipe.id]);
      assert.equal(result.body.data.pagination.total, 1);
    }
    for (const query of ['?itemName=pipe&serviceName=clean', '?itemName=missing']) {
      const result = await get(query);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data.sizes, []);
      assert.equal(result.body.data.pagination.total, 0);
    }
    const page = await get('?limit=1&page=2');
    const excluded = await get(`?notIn=${pipe.sizes[0].id}&limit=1`);
    assert.equal(excluded.status, 200);
    assert.deepEqual(excluded.body.data.sizes.map(row => row.id), [casing.sizes[0].id]);
    assert.deepEqual(excluded.body.data.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    for (const query of [
      `?notIn=${pipe.sizes[0].id},${casing.sizes[0].id}`,
      `?itemId=${pipe.id}&itemName=pipe&serviceName=spec&notIn=${pipe.sizes[0].id}`,
    ]) {
      const result = await get(query);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data.sizes, []);
      assert.equal(result.body.data.pagination.total, 0);
    }
    const unrelated = await get(`?notIn=${foreign.sizes[0].id},${randomUUID()}`);
    assert.equal(unrelated.status, 200);
    assert.equal(unrelated.body.data.pagination.total, 2);
    for (const value of ['', 'bad', `${pipe.sizes[0].id},bad`, `${pipe.sizes[0].id},`, Array(101).fill(pipe.sizes[0].id).join(',')]) {
      assert.equal((await get(`?notIn=${value}`)).status, 400);
    }
    assert.equal(page.body.data.sizes.length, 1);
    assert.deepEqual(page.body.data.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
    assert.equal((await get('', randomUUID())).body.data.pagination.total, 0);
    assert.equal((await get('', '')).status, 403);
    const company = await prisma.company.create({ data: {
      officeBranchId: branch, name: 'Contract test', normalizeName: randomUUID(), type: 'PT', npwp: '0012345678901234', address: 'Jakarta', isSisterCompany: false,
    } });
    companies.push(company.id);
    const foreignCompany = await prisma.company.create({ data: {
      officeBranchId: otherBranch, name: 'Foreign contract', normalizeName: randomUUID(), type: 'PT', npwp: '0012345678901234', address: 'Jakarta', isSisterCompany: false,
    } });
    companies.push(foreignCompany.id);
    const contractsByCompany = new Map();
    for (const companyId of [company.id, foreignCompany.id]) {
      const agreement = await prisma.companyContract.create({ data: { companyId, status: 'ACTIVE', effectiveFrom: new Date('2020-01-01'), createdById: actor.id, createdByName: actor.name } });
      contractsByCompany.set(companyId, agreement.id);
    }
    const contract = async (itemSizeId, companyId = company.id, extra = {}) => prisma.companyContractPrice.create({ data: {
      contractId: contractsByCompany.get(companyId), itemSizeId, priceService: 75, priceMaintenance: 15,
      createdById: actor.id, createdByName: actor.name, effectiveFrom: new Date('2020-01-01'), ...extra,
    } });
    const pipeContract = await contract(pipe.sizes[0].id);
    const casingContract = await contract(casing.sizes[0].id);
    await contract(foreign.sizes[0].id);
    await contract(inactiveItem.sizes[0].id);
    await contract(inactiveService.sizes[0].id);
    await contract(inactiveSize.sizes[0].id);
    await contract(pipe.sizes[0].id, foreignCompany.id, { priceService: 999 });
    await prisma.itemSize.update({ where: { id: casing.sizes[0].id }, data: { size: 'Small' } });
    const contractGet = (query = '') => get(`/contract-prices?companyId=${company.id}${query}`);
    const contracts = await contractGet('&sortBy=size&sortOrder=asc');
    assert.equal(contracts.status, 200, JSON.stringify(contracts.body));
    assert.deepEqual(contracts.body.data.sizes.map(row => row.id), [pipe.sizes[0].id, casing.sizes[0].id]);
    assert.equal(contracts.body.data.pagination.total, 2);
    assert.equal(contracts.body.data.sizes[0].contractPrice.id, pipeContract.id);
    assert.equal(contracts.body.data.sizes[0].contractPrice.contractId, contractsByCompany.get(company.id));
    assert.equal(contracts.body.data.sizes[0].contractPrice.priceService, '75');
    assert.equal(contracts.body.data.sizes[0].contractPrice.priceMaintenance, '15');
    assert.equal(contracts.body.data.sizes[0].item.service.name, 'Inspection');
    const sorted = await contractGet('&sortBy=size&sortOrder=desc&limit=1');
    assert.deepEqual(sorted.body.data.sizes.map(row => row.id), [casing.sizes[0].id]);
    assert.equal(sorted.body.data.pagination.total, 2);
    for (const query of ['&itemName=PIPE&serviceName=SPEC&size=ARG', `&itemId=${pipe.id}`, `&notIn=${casing.sizes[0].id}`]) {
      const result = await contractGet(query);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data.sizes.map(row => row.id), [pipe.sizes[0].id]);
      assert.equal(result.body.data.pagination.total, 1);
    }
    assert.equal((await contractGet(`&notIn=${pipe.sizes[0].id},${casing.sizes[0].id}`)).body.data.pagination.total, 0);
    for (const data of [
      { isActive: false },
      { isActive: true, effectiveFrom: new Date('2099-01-01') },
      { effectiveFrom: new Date('2020-01-01'), effectiveUntil: new Date('2021-01-01') },
    ]) {
      await prisma.companyContractPrice.update({ where: { id: casingContract.id }, data });
      assert.deepEqual((await contractGet()).body.data.sizes.map(row => row.id), [pipe.sizes[0].id]);
    }
    await prisma.companyContractPrice.delete({ where: { id: pipeContract.id } });
    assert.equal((await contractGet()).body.data.pagination.total, 0);
    for (const query of ['/contract-prices', '/contract-prices?companyId=bad']) {
      assert.equal((await get(query)).status, 400);
    }
    for (const id of [foreignCompany.id, randomUUID()]) {
      assert.equal((await get(`/contract-prices?companyId=${id}`)).status, 404);
    }
    assert.equal((await contractGet(`&itemId=${foreign.id}`)).status, 404);
    assert.equal((await contractGet('&sortBy=priceService')).status, 400);
    await prisma.company.update({ where: { id: company.id }, data: { revoked: true } });
    assert.equal((await contractGet()).status, 404);
    for (const id of [foreign.id, inactiveItem.id, inactiveService.id, randomUUID()]) {
      assert.equal((await get(`?itemId=${id}`)).status, 404);
    }
    for (const query of ['?itemId=bad', '?itemName=', '?serviceName=%20', '?officeBranchId=' + otherBranch]) {
      assert.equal((await get(query)).status, 400);
    }
    console.log('PASS: global and contract sizes, responses, combined filters, exclusion, sorting, pagination, branch/company isolation, contract validity, inactive records and validation.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (companies.length) await prisma.companyHistory.deleteMany({ where: { companyId: { in: companies } } });
    if (companies.length) await prisma.company.deleteMany({ where: { id: { in: companies } } });
    if (services.length) await prisma.service.deleteMany({ where: { id: { in: services } } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
