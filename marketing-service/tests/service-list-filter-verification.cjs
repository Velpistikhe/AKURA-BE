const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/services/service.routes.js').default;

async function main() {
  const branch = randomUUID();
  const otherBranch = randomUUID();
  const actor = { id: randomUUID(), name: 'Service list filter test' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = {
      id: actor.id,
      firstName: 'Service list',
      lastName: 'filter test',
      role: req.headers['x-role'] || 'ADMIN',
      section: 'MARKETING',
      officeBranchId: req.headers['x-branch'] || branch,
    };
    next();
  });
  app.use('/services', routes);
  app.use((error, req, res, next) =>
    res.status(error.statusCode || 500).json({ message: error.message }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const get = async (query = '', { role = 'ADMIN', officeBranchId = branch } = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/services${query}`,
      { headers: { 'x-role': role, 'x-branch': officeBranchId } },
    );
    return { status: response.status, body: await response.json() };
  };
  const serviceIds = [];
  const create = async (name, hasMaintenance, isActive = true, officeBranchId = branch) => {
    const service = await prisma.service.create({
      data: { officeBranchId, name, type: 'TUBULAR', hasMaintenance, isActive, ...audit },
    });
    serviceIds.push(service.id);
    return service;
  };
  try {
    const withMaintenance = await create('With maintenance', true);
    const withMaintenanceInactive = await create('With maintenance inactive', true, false);
    const withoutMaintenance = await create('Without maintenance', false);
    const withoutMaintenanceInactive = await create('Without maintenance inactive', false, false);
    const foreign = await create('Foreign service', true, true, otherBranch);

    const maintenanceOnly = await get('?hasMaintenance=true');
    assert.equal(maintenanceOnly.status, 200, JSON.stringify(maintenanceOnly.body));
    assert.deepEqual(
      maintenanceOnly.body.data.services.map((row) => row.id).sort(),
      [withMaintenance.id, withMaintenanceInactive.id].sort(),
    );
    assert.equal(maintenanceOnly.body.data.pagination.total, 2);
    assert.ok(maintenanceOnly.body.data.services.every((row) => row.hasMaintenance === true));

    const plainOnly = await get('?hasMaintenance=false');
    assert.equal(plainOnly.status, 200, JSON.stringify(plainOnly.body));
    assert.deepEqual(
      plainOnly.body.data.services.map((row) => row.id).sort(),
      [withoutMaintenance.id, withoutMaintenanceInactive.id].sort(),
    );
    assert.equal(plainOnly.body.data.pagination.total, 2);
    assert.ok(plainOnly.body.data.services.every((row) => row.hasMaintenance === false));

    const activeMaintenance = await get('?hasMaintenance=true&isActive=true');
    assert.equal(activeMaintenance.status, 200, JSON.stringify(activeMaintenance.body));
    assert.deepEqual(activeMaintenance.body.data.services.map((row) => row.id), [withMaintenance.id]);
    assert.equal(activeMaintenance.body.data.pagination.total, 1);

    const inactivePlain = await get('?hasMaintenance=false&isActive=false');
    assert.equal(inactivePlain.status, 200, JSON.stringify(inactivePlain.body));
    assert.deepEqual(inactivePlain.body.data.services.map((row) => row.id), [withoutMaintenanceInactive.id]);
    assert.equal(inactivePlain.body.data.pagination.total, 1);

    const combined = await get('?hasMaintenance=true&type=TUBULAR');
    assert.equal(combined.status, 200, JSON.stringify(combined.body));
    assert.equal(combined.body.data.pagination.total, 2);

    const paged = await get('?hasMaintenance=true&sortBy=name&sortOrder=asc&limit=1&page=2');
    assert.equal(paged.status, 200, JSON.stringify(paged.body));
    assert.deepEqual(paged.body.data.services.map((row) => row.id), [withMaintenanceInactive.id]);
    assert.deepEqual(paged.body.data.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });

    // Non-ADMIN roles always list active services only.
    const userMaintenance = await get('?hasMaintenance=true', { role: 'USER' });
    assert.equal(userMaintenance.status, 200, JSON.stringify(userMaintenance.body));
    assert.deepEqual(userMaintenance.body.data.services.map((row) => row.id), [withMaintenance.id]);
    assert.equal(userMaintenance.body.data.pagination.total, 1);

    // Branch isolation keeps foreign services out of every result.
    assert.equal(maintenanceOnly.body.data.services.some((row) => row.id === foreign.id), false);
    assert.equal((await get(`?hasMaintenance=true`, { officeBranchId: otherBranch })).body.data.pagination.total, 1);
    assert.equal((await get(`?hasMaintenance=true`, { officeBranchId: randomUUID() })).body.data.pagination.total, 0);

    for (const value of ['maybe', 'TRUE', '1', '']) {
      const invalid = await get(`?hasMaintenance=${value}`);
      assert.equal(invalid.status, 400, `hasMaintenance=${value} should be rejected: ${JSON.stringify(invalid.body)}`);
    }

    console.log('PASS: hasMaintenance filter isolates services by maintenance flag, combines with other filters, respects pagination totals, branch isolation, role visibility, and rejects invalid values.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (serviceIds.length) await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: { in: [branch, otherBranch] } } });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
