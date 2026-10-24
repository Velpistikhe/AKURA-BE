const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/items/item.routes.js').default;
const { itemRepository } = require('../dist/modules/items/item.repository.js');
const { createItemSchema } = require('../dist/modules/items/item.schemas.js');

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
    const service = await prisma.service.create({ data: { officeBranchId: serviceBranch, name: serviceName, type: 'TUBULAR', createdById: actor.id, createdByName: actor.name } });
    services.push(service.id);
    const created = await itemRepository.create(createItemSchema.parse({ serviceId: service.id, uom: 'JOINT', name,
      sizes: [{ size: 'Large', priceServicePrimary: 100, priceServiceSisterCompany: 90 }],
    }), serviceBranch, actor);
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
    assert.deepEqual(row.item.service, { id: pipe.serviceId, name: 'Inspection', type: 'TUBULAR', hasMaintenance: false, isActive: true, version: 0 });
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
    const company = await prisma.company.create({ data: { officeBranchId: branch, name: 'Price options', normalizeName: randomUUID(), type: 'PT', npwp: '123', address: 'Jakarta' } });
    companies.push(company.id);
    const prices = await get(`/prices?companyId=${company.id}`);
    assert.equal(prices.status, 200, JSON.stringify(prices.body));
    assert.deepEqual(prices.body.data.sizes.map(row => row.id).sort(), [pipe.sizes[0].id, casing.sizes[0].id].sort());
    assert.ok(prices.body.data.sizes.every(row => row.priceSource === 'PRIMARY'));
    assert.equal((await get(`/prices?companyId=${company.id}`, otherBranch)).status, 404);
    assert.equal((await get('/prices?companyId=bad')).status, 400);
    for (const id of [foreign.id, inactiveItem.id, inactiveService.id, randomUUID()]) {
      assert.equal((await get(`?itemId=${id}`)).status, 404);
    }
    for (const query of ['?itemId=bad', '?itemName=', '?serviceName=%20', '?officeBranchId=' + otherBranch]) {
      assert.equal((await get(query)).status, 400);
    }
    console.log('PASS: active sizes, resolved price options, combined filters, exclusion, sorting, pagination, branch/company isolation, inactive parents and validation.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (companies.length) await prisma.companyHistory.deleteMany({ where: { companyId: { in: companies } } });
    if (companies.length) await prisma.company.deleteMany({ where: { id: { in: companies } } });
    if (services.length) await prisma.service.deleteMany({ where: { id: { in: services } } });
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: { in: [branch, otherBranch] } } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
