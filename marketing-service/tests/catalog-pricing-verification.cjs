const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/items/item.routes.js').default;

async function main() {
  const branch = randomUUID(), foreignBranch = randomUUID(), actor = randomUUID();
  const createdBy = { createdById: actor, createdByName: 'Catalog Test' };
  const samples = [], failures = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = { id: actor, firstName: 'Catalog', lastName: 'Test', officeBranchId: req.headers['x-branch'] || branch };
    next();
  });
  app.use('/items', routes);
  app.use((error, req, res, next) => res.status(error.statusCode || (error.code === 'P2002' ? 409 : 500)).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (method, path, body, officeBranchId = branch) => {
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/items${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-branch': officeBranchId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const result = { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
    samples.push({ ms: performance.now() - start, status: result.status });
    if (result.status >= 500) failures.push({ method, path, ...result });
    return result;
  };
  const ok = async (method, path, body, status = 200) => {
    const result = await request(method, path, body);
    assert.equal(result.status, status, JSON.stringify(result)); return result.body.data;
  };
  const pool = async (jobs, concurrency = 12) => {
    let next = 0;
    const results = [];
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) { const index = next++; results[index] = await jobs[index](); }
    }));
    return results;
  };
  const prices = { priceServicePrimary: '100.25', priceServiceSisterCompany: '80', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '10' };
  const started = performance.now();
  try {
    const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Inspection', type: 'TUBULAR', hasMaintenance: true, ...createdBy } });
    const company = await prisma.company.create({ data: { officeBranchId: branch, name: 'Customer', normalizeName: 'customer', npwp: '1', type: 'PT', address: 'Test', createdById: actor } });
    const contract = await prisma.companyContract.create({ data: { companyId: company.id, contractNumber: randomUUID(), contractDate: new Date('2026-01-01'), effectiveFrom: new Date('2020-01-01'), effectiveUntil: new Date('2099-01-01'), status: 'APPROVED', createdById: actor } });
    const standardCompany = await prisma.company.create({ data: { officeBranchId: branch, name: 'Standard Customer', normalizeName: 'standardcustomer', npwp: '2', type: 'PT', address: 'Test', createdById: actor } });
    const input = { serviceId: service.id, uom: 'JOINT', name: 'Pipe', sizes: [{ size: 'Large' }, { size: 'Small' }] };
    const item = await ok('POST', '', input, 201), [large, small] = item.sizes;
    assert.equal(large.priceId, null);
    assert.equal(large.priceStatus, 'UNAVAILABLE');
    assert.equal(await prisma.itemPrice.count({ where: { itemSize: { itemId: item.id } } }), 0);
    assert.equal((await request('POST', '', { ...input, name: 'Invalid', sizes: [{ size: 'X', ...prices }] })).status, 400);
    assert.equal((await request('POST', '', { ...input, name: 'Rollback', sizes: [{ size: 'X' }, { size: ' x ' }] })).status, 409);
    assert.equal(await prisma.item.count({ where: { officeBranchId: branch, name: 'Rollback' } }), 0);
    // Normalized database key and transaction lock prevent concurrent duplicates.
    const duplicateCreates = await pool(Array.from({ length: 16 }, (_, i) => () => request('POST', '', { serviceId: service.id, uom: 'JOINT', name: i % 2 ? '  Race   Item ' : 'race item' })));
    assert.equal(duplicateCreates.filter(r => r.status === 201).length, 1);
    assert.equal(duplicateCreates.filter(r => r.status === 409).length, 15);
    assert.equal(await prisma.item.count({ where: { serviceId: service.id, activeKey: 'race item' } }), 1);
    const duplicateSizes = await pool(Array.from({ length: 12 }, () => () => request('POST', '/sizes', { itemId: item.id, itemVersion: item.version, size: 'Medium' })));
    assert.equal(duplicateSizes.filter(r => r.status === 201).length, 1);
    assert.equal(duplicateSizes.filter(r => r.status === 409).length, 11);
    // Prices reuse references; creating a price never creates another item or size.
    const sizeCount = await prisma.itemSize.count({ where: { itemId: item.id } });
    const priceCreates = await pool(Array.from({ length: 12 }, () => () => request('POST', `/sizes/${large.id}/price`, prices)));
    assert.equal(priceCreates.filter(r => r.status === 201).length, 1);
    assert.equal(priceCreates.filter(r => r.status === 409).length, 11);
    assert.equal(await prisma.itemSize.count({ where: { itemId: item.id } }), sizeCount);
    let price = await ok('GET', `/sizes/${large.id}/price`);
    for (const value of [null, '', false, -1, '1.001']) assert.equal((await request('PATCH', `/sizes/${large.id}/price`, { version: price.version, priceServicePrimary: value })).status, 400);
    assert.equal((await request('PATCH', `/sizes/${large.id}/price`, { version: price.version })).status, 400);
    const updates = await pool(Array.from({ length: 16 }, (_, i) => () => request('PATCH', `/sizes/${large.id}/price`, { version: price.version, priceServicePrimary: String(200 + i) })));
    assert.equal(updates.filter(r => r.status === 200).length, 1);
    assert.equal(updates.filter(r => r.status === 409).length, 15);
    price = await ok('GET', `/sizes/${large.id}/price`);
    assert.equal(price.priceServiceSisterCompany, '80');
    assert.equal(price.priceMaintenancePrimary, '20');
    const preserved = price.priceServicePrimary;
    price = await ok('PATCH', `/sizes/${large.id}/price`, { version: price.version, priceServiceSisterCompany: '88' });
    assert.equal(price.priceServicePrimary, preserved);
    const resolved = await ok('GET', `/sizes/prices?companyId=${standardCompany.id}&itemId=${item.id}`);
    assert.equal(resolved.sizes.find(size => size.id === large.id).priceService, preserved);
    // Audit failure rolls back the price and ancestor versions in the same transaction.
    const beforeItem = await ok('GET', `/${item.id}`);
    const injected = await prisma.catalogAuditLog.create({ data: { officeBranchId: branch, entityType: 'ITEM_PRICE', entityId: price.id, version: price.version + 1, action: 'TEST_CONFLICT', after: {}, ...createdBy } });
    assert.equal((await request('PATCH', `/sizes/${large.id}/price`, { version: price.version, priceServicePrimary: '999' })).status, 409);
    assert.deepEqual(await ok('GET', `/sizes/${large.id}/price`), price);
    assert.equal((await ok('GET', `/${item.id}`)).version, beforeItem.version);
    await prisma.catalogAuditLog.delete({ where: { id: injected.id } });
    // Atomic contract PUT and version checks.
    const puts = await pool(Array.from({ length: 12 }, () => () => request('PUT', `/sizes/${large.id}/contract-prices`, { contractId: contract.id, priceService: '50', priceMaintenance: '5' })));
    assert.equal(puts.filter(r => r.status === 201).length, 1);
    assert.equal(puts.filter(r => r.status === 400).length, 11);
    const cp = puts.find(r => r.status === 201).body.data;
    assert.equal((await request('PUT', `/sizes/${large.id}/contract-prices`, { contractId: contract.id, version: cp.version, priceService: '55', priceMaintenance: '5' })).status, 200);
    await ok('POST', `/sizes/${small.id}/price`, prices, 201);
    await ok('POST', `/sizes/${small.id}/contract-prices`, { contractId: contract.id, priceService: '60', priceMaintenance: '6' }, 201);
    // Branch isolation and history remain valid after deactivation.
    for (const path of [`/${item.id}`, `/${item.id}/history`, `/sizes/${large.id}`, `/sizes/${large.id}/history`, `/sizes/${large.id}/price/history`]) assert.equal((await request('GET', path, undefined, foreignBranch)).status, 404);
    assert.equal((await request('PATCH', `/${item.id}`, { version: 0, name: 'Attack' }, foreignBranch)).status, 404);
    await ok('DELETE', `/sizes/${large.id}/price`, { version: price.version });
    assert.equal((await request('PATCH', `/sizes/${large.id}/price`, { version: price.version + 1, isActive: true })).status, 409);
    assert.equal((await ok('GET', `/sizes/${large.id}/price`)).isActive, false);
    let currentSize = await ok('GET', `/sizes/${large.id}`);
    const deletedSize = await ok('DELETE', `/sizes/${large.id}`, { version: currentSize.version });
    assert.equal(deletedSize.isActive, false);
    assert.equal((await ok('GET', `/${item.id}`)).isActive, true);
    assert.equal((await ok('GET', `/sizes/${small.id}`)).isActive, true);
    assert.equal(await prisma.itemPrice.count({ where: { itemSizeId: large.id, isActive: true } }), 0);
    assert.equal(await prisma.companyContractPrice.count({ where: { itemSizeId: large.id, isActive: true } }), 1);
    assert.equal((await request('PATCH', `/sizes/${large.id}/price`, { version: price.version + 1, isActive: true })).status, 409);
    const parent = await ok('GET', `/${item.id}`);
    const reused = await ok('POST', '/sizes', { itemId: item.id, itemVersion: parent.version, size: 'Large' }, 201);
    assert.notEqual(reused.id, large.id);
    let history = await ok('GET', `/sizes/${large.id}/price/history`);
    assert(history.history.every(entry => entry.entityType === 'ITEM_PRICE'));
    const sizeHistory = await ok('GET', `/sizes/${large.id}/history?limit=100`);
    assert(sizeHistory.history.some(entry => entry.entityType === 'ITEM_SIZE'));
    assert(sizeHistory.history.some(entry => entry.entityType === 'ITEM_PRICE'));
    assert(sizeHistory.history.every(entry => ['ITEM_SIZE', 'ITEM_PRICE', 'COMPANY_CONTRACT_PRICE'].includes(entry.entityType)));
    assert.equal(history.history[0].action, 'DEACTIVATE');
    assert.equal(history.history[0].actionLabel, 'Deactivated');
    assert.equal(history.history[0].changedBy.name, 'Catalog Test');
    assert.ok(history.history.some(entry => entry.changes.some(change => change.field === 'priceServicePrimary' && change.before !== change.after)));
    assert.equal((await request('GET', `/${item.id}/history?limit=101`)).status, 400);
    // A price update racing size deletion must never leave an active child of an inactive size.
    let deleteTarget = await ok('GET', `/sizes/${small.id}`);
    const targetPrice = await ok('GET', `/sizes/${small.id}/price`);
    const priceDeleteRace = await Promise.all([
      request('DELETE', `/sizes/${small.id}`, { version: deleteTarget.version }),
      request('PATCH', `/sizes/${small.id}/price`, { version: targetPrice.version, priceServicePrimary: '777' }),
    ]);
    assert.equal(priceDeleteRace.filter(r => r.status === 200).length, 1);
    assert.equal(priceDeleteRace.filter(r => r.status === 409).length, 1);
    if (priceDeleteRace[0].status !== 200) await ok('DELETE', `/sizes/${small.id}`, { version: (await ok('GET', `/sizes/${small.id}`)).version });
    assert.equal(await prisma.itemPrice.count({ where: { itemSizeId: small.id, isActive: true } }), 0);
    assert.equal(await prisma.companyContractPrice.count({ where: { itemSizeId: small.id, isActive: true } }), 1);
    const replacementSmall = await ok('POST', '/sizes', { itemId: item.id, itemVersion: (await ok('GET', `/${item.id}`)).version, size: 'Small' }, 201);
    small.id = replacementSmall.id;
    // Size labels are immutable: removed PATCH must not change the row or audit.
    const sizeNow = await ok('GET', `/sizes/${small.id}`);
    const auditCount = await prisma.catalogAuditLog.count({ where: { officeBranchId: branch } });
    assert.equal((await request('PATCH', `/sizes/${small.id}`, { version: sizeNow.version, size: 'Renamed' })).status, 404);
    assert.deepEqual(await ok('GET', `/sizes/${small.id}`), sizeNow);
    assert.equal(await prisma.catalogAuditLog.count({ where: { officeBranchId: branch } }), auditCount);
    const parentNow = await ok('GET', `/${item.id}`);
    const deleteRace = await Promise.all([
      request('DELETE', `/${item.id}`, { version: parentNow.version }),
      request('POST', '/sizes', { itemId: item.id, itemVersion: parentNow.version, size: 'Delete race' }),
    ]);
    assert.equal(deleteRace.filter(r => [200, 201].includes(r.status)).length, 1);
    assert.equal(deleteRace.filter(r => r.status === 409).length, 1);
    if (deleteRace[0].status !== 200) await ok('DELETE', `/${item.id}`, { version: (await ok('GET', `/${item.id}`)).version });
    assert.equal(await prisma.itemSize.count({ where: { itemId: item.id, isActive: true } }), 0);
    assert.equal(await prisma.itemPrice.count({ where: { itemSize: { itemId: item.id }, isActive: true } }), 0);
    assert.equal(await prisma.companyContractPrice.count({ where: { itemSize: { itemId: item.id }, isActive: true } }), 2);
    history = await ok('GET', `/${item.id}/history?limit=100`);
    assert(history.history.length > 0);
    assert(history.history.some(entry => entry.entityType === 'ITEM'));
    assert(history.history.some(entry => entry.entityType === 'ITEM_SIZE' && entry.action === 'CREATE'));
    assert(history.history.some(entry => entry.entityType === 'ITEM_SIZE' && entry.action === 'DEACTIVATE'));
    assert(history.history.every(entry => ['ITEM', 'ITEM_SIZE'].includes(entry.entityType)));
    assert.equal(history.pagination.total, await prisma.catalogAuditLog.count({ where: { officeBranchId: branch, OR: [
      { entityType: 'ITEM', entityId: item.id, action: { not: 'CHILD_UPDATE' } },
      { entityType: 'ITEM_SIZE', entityId: { in: await prisma.itemSize.findMany({ where: { itemId: item.id }, select: { id: true } }).then(rows => rows.map(row => row.id)) }, action: { in: ['CREATE', 'DEACTIVATE'] } },
    ] } }));
    assert.equal(history.history.some(entry => entry.entityType === 'COMPANY_CONTRACT_PRICE' && entry.action === 'DEACTIVATE'), false);
    assert.deepEqual((await ok('GET', `/${item.id}/history?page=9999`)).history, []);
    const recreated = await ok('POST', '', input, 201);
    assert.notEqual(recreated.id, item.id);
    // Sustained traffic on independent references, plus batched multi-size cascade.
    const stressCount = Number(process.env.CATALOG_STRESS_ITEMS || 30);
    assert.ok(Number.isInteger(stressCount) && stressCount > 0 && stressCount <= 200);
    const stressStart = samples.length;
    const stressRows = await pool(Array.from({ length: stressCount }, (_, i) => async () => {
      const row = await ok('POST', '', { serviceId: service.id, uom: 'JOINT', name: `Stress ${i}`, sizes: [{ size: 'A' }, { size: 'B' }] }, 201);
      for (const size of row.sizes) {
        await ok('POST', `/sizes/${size.id}/price`, prices, 201);
        await ok('POST', `/sizes/${size.id}/contract-prices`, { contractId: contract.id, priceService: '40', priceMaintenance: '4' }, 201);
      }
      const current = await ok('GET', `/${row.id}`);
      await ok('DELETE', `/${row.id}`, { version: current.version });
      return row;
    }));
    assert.equal(await prisma.itemSize.count({ where: { itemId: { in: stressRows.map(row => row.id) }, isActive: true } }), 0);
    assert.equal(await prisma.itemPrice.count({ where: { itemSize: { itemId: { in: stressRows.map(row => row.id) } }, isActive: true } }), 0);
    assert.equal(await prisma.companyContractPrice.count({ where: { itemSize: { itemId: { in: stressRows.map(row => row.id) } }, isActive: true } }), stressRows.length * 2);
    // Every entity version is accounted for, with no missing or duplicate audit versions.
    const auditRows = await prisma.catalogAuditLog.findMany({ where: { officeBranchId: branch }, orderBy: { version: 'asc' } });
    const sequences = new Map();
    for (const row of auditRows) {
      if (row.entityType === 'COMPANY_CONTRACT') continue; // Fixture contract began outside the API.
      const key = `${row.entityType}:${row.entityId}`;
      const expected = sequences.get(key) || 0;
      assert.equal(row.version, expected, `Audit gap for ${key}`);
      sequences.set(key, expected + 1);
    }
    assert.deepEqual(failures, []);
    const latency = samples.slice(stressStart).map(row => row.ms).sort((a, b) => a - b);
    const percentile = n => Math.round(latency[Math.min(latency.length - 1, Math.floor(latency.length * n))]);
    const report = { checkedAt: new Date().toISOString(), environment: 'Local PostgreSQL, Express router, injected auth; gateway excluded', concurrency: 12, stressItems: stressCount, stressRequests: latency.length, totalRequests: samples.length, unexpectedServerErrors: failures.length, auditRows: auditRows.length, durationMs: Math.round(performance.now() - started), stressLatencyMs: { p50: percentile(.5), p95: percentile(.95), max: percentile(1) } };
    mkdirSync(join(__dirname, 'reports'), { recursive: true });
    writeFileSync(join(__dirname, 'reports/item-catalog.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    console.log('PASS: references, normalization, rollback, branch isolation, partial PATCH, concurrency, cascade, history and stress checks.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const companies = await prisma.company.findMany({ where: { officeBranchId: branch }, select: { id: true } });
    const contracts = await prisma.companyContract.findMany({ where: { companyId: { in: companies.map(row => row.id) } }, select: { id: true } });
    await prisma.companyContractHistory.deleteMany({ where: { companyContractId: { in: contracts.map(row => row.id) } } });
    await prisma.company.deleteMany({ where: { officeBranchId: branch } });
    await prisma.service.deleteMany({ where: { officeBranchId: branch } });
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: branch } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
