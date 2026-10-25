const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/items/item.routes.js').default;
const { createItemScopeSchema, createItemSchema } = require('../dist/modules/items/item.schemas.js');

async function main() {
  const branch = randomUUID();
  const foreignBranch = randomUUID();
  const actor = { id: randomUUID(), name: 'Scope test' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = { id: actor.id, firstName: 'Scope', lastName: 'test', role: 'ADMIN', section: 'MARKETING', officeBranchId: req.headers['x-branch'] || branch };
    next();
  });
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
    return status >= 400 ? result : result.data;
  }

  let service, foreignService;
  const cleanup = [];
  try {
    service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Scope service', type: 'TUBULAR', ...audit } });
    foreignService = await prisma.service.create({ data: { officeBranchId: foreignBranch, name: 'Foreign scope service', type: 'TUBULAR', ...audit } });
    assert.equal(createItemScopeSchema.safeParse({ inspectionScopes: ['Visual inspection'] }).success, true);
    assert.equal(createItemScopeSchema.safeParse({ inspectionScopes: [] }).success, false);
    assert.equal(createItemScopeSchema.safeParse({}).success, false);
    assert.equal(createItemScopeSchema.safeParse({ inspectionScopes: [''] }).success, false);
    assert.equal(createItemScopeSchema.safeParse({ inspectionScopes: ['x'.repeat(501)] }).success, false);
    assert.equal(createItemScopeSchema.safeParse({ inspectionScopes: ['Same scope', '  same   scope  '] }).success, false);
    assert.equal(createItemScopeSchema.safeParse({ inspectionScopes: Array.from({ length: 101 }, (_, i) => `Scope ${i}`) }).success, false);

    // Creation accepts inspection scopes for a standalone item only; a service
    // item owns no scopes and a standalone item never owns maintenance scopes.
    const base = { name: 'Rule item', uom: 'JOINT' };
    assert.equal(createItemSchema.safeParse({ ...base, inspectionScopes: ['Visual'] }).success, true);
    assert.equal(createItemSchema.safeParse({ ...base, serviceId: null, inspectionScopes: ['Visual'] }).success, true);
    assert.equal(createItemSchema.safeParse({ ...base, maintenanceScopes: ['Cleaning'] }).success, false);
    assert.equal(createItemSchema.safeParse({ ...base, serviceId: null, maintenanceScopes: ['Cleaning'] }).success, false);
    assert.equal(createItemSchema.safeParse({ ...base, serviceId: randomUUID() }).success, true);
    assert.equal(createItemSchema.safeParse({ ...base, serviceId: randomUUID(), inspectionScopes: ['Visual'] }).success, false);
    assert.equal(createItemSchema.safeParse({ ...base, serviceId: randomUUID(), maintenanceScopes: ['Cleaning'] }).success, false);

    const standalone = await prisma.item.create({ data: {
      officeBranchId: branch, name: 'Standalone item', uom: 'JOINT', ...audit, activeKey: 'standalone item',
      scopes: { create: [{ type: 'INSPECTION', scope: 'Existing scope', revoked: false }] },
    } });
    cleanup.push(standalone.id);
    let item = await request('POST', `/${standalone.id}/scopes`, { inspectionScopes: ['Visual inspection'] }, 201);
    assert.deepEqual(item.inspectionScopes.map(row => row.inspectionScope), ['Existing scope', 'Visual inspection']);
    item = await request('POST', `/${standalone.id}/scopes`, { inspectionScopes: ['existing scope', 'Thickness measurement', 'Leak test'] }, 201);
    assert.deepEqual(item.inspectionScopes.map(row => row.inspectionScope), ['Existing scope', 'Visual inspection', 'Thickness measurement', 'Leak test']);
    assert.equal(item.inspectionScopes.filter(row => row.inspectionScope.toLowerCase() === 'existing scope').length, 1);

    // A previously revoked scope can be added again.
    const revokedScope = await prisma.serviceScope.create({ data: { itemId: standalone.id, type: 'INSPECTION', scope: 'Revived scope', revoked: true } });
    item = await request('POST', `/${standalone.id}/scopes`, { inspectionScopes: ['Revived scope'] }, 201);
    assert.equal((await prisma.serviceScope.findUniqueOrThrow({ where: { id: revokedScope.id } })).revoked, false);
    assert.equal(item.inspectionScopes.some(row => row.inspectionScope === 'Revived scope'), true);

    // An item linked to a service cannot receive scopes.
    const linked = await prisma.item.create({ data: {
      officeBranchId: branch, name: 'Linked item', uom: 'JOINT', serviceId: service.id, ...audit, activeKey: 'linked item',
    } });
    cleanup.push(linked.id);
    let error = await request('POST', `/${linked.id}/scopes`, { inspectionScopes: ['Visual inspection'] }, 409);
    assert.match(error.message, /service/i);

    // Unknown and foreign-branch items are not found.
    error = await request('POST', `/${randomUUID()}/scopes`, { inspectionScopes: ['Visual inspection'] }, 404);
    assert.match(error.message, /not found/i);
    const foreignItem = await prisma.item.create({ data: {
      officeBranchId: foreignBranch, name: 'Foreign item', uom: 'JOINT', ...audit, activeKey: 'foreign item',
    } });
    cleanup.push(foreignItem.id);
    error = await request('POST', `/${foreignItem.id}/scopes`, { inspectionScopes: ['Visual inspection'] }, 404);
    assert.match(error.message, /not found/i);

    // A revoked (inactive) item cannot receive scopes.
    const revoked = await prisma.item.create({ data: {
      officeBranchId: branch, name: 'Revoked item', uom: 'JOINT', ...audit, activeKey: null, isActive: false,
    } });
    cleanup.push(revoked.id);
    error = await request('POST', `/${revoked.id}/scopes`, { inspectionScopes: ['Visual inspection'] }, 409);
    assert.match(error.message, /inactive/i);

    // Invalid item ids are rejected by request validation.
    error = await request('POST', '/not-a-uuid/scopes', { inspectionScopes: ['Visual inspection'] }, 400);
    assert.match(error.message, /validation failed/i);
  } finally {
    if (cleanup.length) {
      await prisma.serviceScope.deleteMany({ where: { itemId: { in: cleanup } } });
      await prisma.item.deleteMany({ where: { id: { in: cleanup } } });
    }
    await prisma.service.deleteMany({ where: { id: { in: [service?.id, foreignService?.id].filter(Boolean) } } });
    await new Promise(resolve => server.close(resolve));
  }
}

main().then(() => {
  console.log('item inspection scope verification passed');
  process.exit(0);
}).catch(error => {
  console.error(error);
  process.exit(1);
});
