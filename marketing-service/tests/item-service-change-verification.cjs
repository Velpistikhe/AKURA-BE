const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/items/item.routes.js').default;
const { updateItemSchema } = require('../dist/modules/items/item.schemas.js');
const { itemHistoryRepository } = require('../dist/modules/items/item-history.repository.js');

async function main() {
  const branch = randomUUID();
  const foreignBranch = randomUUID();
  const actor = { id: randomUUID(), name: 'Service change test' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = {
      id: actor.id,
      firstName: 'Service',
      lastName: 'change',
      role: 'ADMIN',
      section: 'MARKETING',
      officeBranchId: req.headers['x-branch'] || branch,
    };
    next();
  });
  app.use('/items', routes);
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({ message: error.message });
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  async function request(method, path, body, status = 200, requestBranch = branch) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/items${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-branch': requestBranch },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (status !== null) assert.equal(response.status, status, JSON.stringify(result));
    return status === null ? response.status : status >= 400 ? result : result.data;
  }

  let serviceA, serviceB, maintenanceService, foreignService;
  try {
    serviceA = await prisma.service.create({ data: { officeBranchId: branch, name: 'Service A', type: 'TUBULAR', ...audit } });
    serviceB = await prisma.service.create({ data: { officeBranchId: branch, name: 'Service B', type: 'OCTG', ...audit } });
    maintenanceService = await prisma.service.create({ data: { officeBranchId: branch, name: 'Maintenance service', type: 'TUBULAR', hasMaintenance: true, ...audit } });
    foreignService = await prisma.service.create({ data: { officeBranchId: foreignBranch, name: 'Foreign service', type: 'TUBULAR', ...audit } });

    // Request validation: serviceId is optional, nullable and must be a UUID.
    assert.equal(updateItemSchema.safeParse({ version: 0, serviceId: randomUUID() }).success, true);
    assert.equal(updateItemSchema.safeParse({ version: 0, serviceId: null }).success, true);
    assert.equal(updateItemSchema.safeParse({ version: 0, serviceId: 'not-a-uuid' }).success, false);
    assert.equal(updateItemSchema.safeParse({ version: 0 }).success, false);
    assert.equal(updateItemSchema.safeParse({ serviceId: randomUUID() }).success, false);

    const item = await request('POST', '', { serviceId: serviceA.id, name: 'Movable item', uom: 'JOINT' }, 201);
    const itemId = item.id;

    // Move to another service with the same maintenance status.
    let moved = await request('PATCH', `/${itemId}`, { version: item.version, serviceId: serviceB.id });
    assert.equal(moved.serviceId, serviceB.id);
    assert.equal(moved.version, item.version + 1);
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).serviceId, serviceB.id);

    // Move back to the first service.
    moved = await request('PATCH', `/${itemId}`, { version: moved.version, serviceId: serviceA.id });
    assert.equal(moved.serviceId, serviceA.id);

    // Detach the item with null.
    moved = await request('PATCH', `/${itemId}`, { version: moved.version, serviceId: null });
    assert.equal(moved.serviceId, null);
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).serviceId, null);

    // A standalone item may join a service without maintenance.
    moved = await request('PATCH', `/${itemId}`, { version: moved.version, serviceId: serviceA.id });
    assert.equal(moved.serviceId, serviceA.id);

    // Duplicate active name in the target service is rejected.
    await request('POST', '', { serviceId: serviceB.id, name: 'Duplicate name', uom: 'JOINT' }, 201);
    const duplicate = await request('POST', '', { serviceId: serviceA.id, name: 'Duplicate name', uom: 'JOINT' }, 201);
    const conflict = await request('PATCH', `/${duplicate.id}`, { version: duplicate.version, serviceId: serviceB.id }, 409);
    assert.equal(conflict.message.includes('already exists'), true);
    // The failed move leaves the item untouched.
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: duplicate.id } })).serviceId, serviceA.id);

    // Renaming together with a service move validates the new name in the target service.
    const renamedOk = await request('PATCH', `/${duplicate.id}`, { version: duplicate.version, name: 'Renamed item', serviceId: serviceB.id });
    assert.equal(renamedOk.name, 'Renamed item');
    assert.equal(renamedOk.serviceId, serviceB.id);

    // Maintenance status must match between source and target.
    const maintenanceItem = await request('POST', '', { serviceId: maintenanceService.id, name: 'Maintenance item', uom: 'JOINT' }, 201);
    await request('PATCH', `/${maintenanceItem.id}`, { version: maintenanceItem.version, serviceId: serviceA.id }, 409);
    await request('PATCH', `/${maintenanceItem.id}`, { version: maintenanceItem.version, serviceId: null }, 409);
    await request('PATCH', `/${maintenanceItem.id}`, { version: maintenanceItem.version, serviceId: maintenanceService.id });
    // A non-maintenance item cannot join a maintenance service either.
    await request('PATCH', `/${renamedOk.id}`, { version: renamedOk.version, serviceId: maintenanceService.id }, 409);
    const detachedNonMaintenance = await request('PATCH', `/${renamedOk.id}`, { version: renamedOk.version, serviceId: null });
    assert.equal(detachedNonMaintenance.serviceId, null);

    // Target service must be active and inside the current branch.
    await request('PATCH', `/${renamedOk.id}`, { version: detachedNonMaintenance.version, serviceId: foreignService.id }, 409);
    await request('PATCH', `/${renamedOk.id}`, { version: detachedNonMaintenance.version, serviceId: randomUUID() }, 409);

    // Stale versions are rejected.
    await request('PATCH', `/${renamedOk.id}`, { version: renamedOk.version, serviceId: serviceA.id }, 409);

    // A missing version is a validation error.
    await request('PATCH', `/${renamedOk.id}`, { serviceId: serviceA.id }, 400);

    // Item scopes are revoked when the item joins a service.
    const standalone = await request('POST', '', {
      name: 'Scoped standalone', uom: 'JOINT', inspectionScopes: ['Visual'], maintenanceScopes: ['Cleaning'],
    }, 201);
    assert.equal(standalone.inspectionScopes.length, 1);
    assert.equal(standalone.maintenanceScopes.length, 1);
    const scoped = await request('PATCH', `/${standalone.id}`, { version: standalone.version, serviceId: serviceA.id });
    assert.equal(scoped.serviceId, serviceA.id);
    const scopes = await prisma.serviceScope.findMany({ where: { itemId: standalone.id } });
    assert.equal(scopes.length, 2);
    assert.ok(scopes.every(scope => scope.revoked));
    assert.equal((await prisma.serviceScope.count({ where: { itemId: standalone.id, revoked: false } })), 0);
    // Detaching keeps the revoked scopes as history.
    const detached = await request('PATCH', `/${standalone.id}`, { version: scoped.version, serviceId: null });
    assert.equal(detached.serviceId, null);
    assert.equal(await prisma.serviceScope.count({ where: { itemId: standalone.id, revoked: true } }), 2);

    // The item history records the service change.
    const history = await itemHistoryRepository.read('ITEM', standalone.id, branch, { page: 1, limit: 20 });
    const serviceChange = history.history.find(row => row.action === 'UPDATE'
      && row.changes.some(change => change.field === 'serviceId' && change.after === serviceA.id));
    assert.ok(serviceChange, 'history must expose the service change');
    const change = serviceChange.changes.find(entry => entry.field === 'serviceId');
    assert.equal(change.label, 'Service');
    assert.equal(change.after, serviceA.id);
    assert.equal(change.before, null);

    // An item whose service was deactivated can still be moved out of it.
    const inactiveService = await prisma.service.create({ data: { officeBranchId: branch, name: 'Deactivated service', type: 'TUBULAR', ...audit } });
    const orphan = await request('POST', '', { serviceId: inactiveService.id, name: 'Orphan item', uom: 'JOINT' }, 201);
    const stillLinked = await request('POST', '', { serviceId: inactiveService.id, name: 'Linked orphan', uom: 'JOINT' }, 201);
    await prisma.service.update({ where: { id: inactiveService.id }, data: { isActive: false, activeKey: null } });
    const rescued = await request('PATCH', `/${orphan.id}`, { version: orphan.version, serviceId: null });
    assert.equal(rescued.serviceId, null);
    // Without a service change the deactivated service still blocks the update.
    const blocked = await request('PATCH', `/${stillLinked.id}`, { version: stillLinked.version, name: 'Renamed orphan' }, 409);
    assert.equal(blocked.message, 'Service is inactive');

    console.log('PASS: item service change rules, maintenance guard, scope revocation, history and concurrency guards verified.');
  } finally {
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: { in: [branch, foreignBranch] } } });
    await prisma.item.deleteMany({ where: { officeBranchId: { in: [branch, foreignBranch] } } });
    await prisma.service.deleteMany({ where: { officeBranchId: { in: [branch, foreignBranch] } } });
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());