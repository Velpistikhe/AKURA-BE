const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/items/item.routes.js').default;

async function main() {
  const branch = randomUUID(),
    actor = { id: randomUUID(), name: 'Item price test' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = {
      id: actor.id,
      firstName: 'Item price',
      lastName: 'test',
      role: 'ADMIN',
      section: 'MARKETING',
      officeBranchId: req.headers['x-branch'] || branch,
    };
    next();
  });
  app.use('/items', routes);
  app.use((error, req, res, next) =>
    res.status(error.statusCode || 500).json({ message: error.message }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  async function request(method, path, body, status = 200) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/items${path}`,
      {
        method,
        headers: { 'content-type': 'application/json', 'x-branch': branch },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const result = await response.json();
    if (status !== null) assert.equal(response.status, status, JSON.stringify(result));
    return status === null ? response.status : status >= 400 ? result : result.data;
  }
  try {
    const maintenanceService = await prisma.service.create({
      data: { officeBranchId: branch, name: 'With maintenance', type: 'TUBULAR', hasMaintenance: true, ...audit },
    });
    const plainService = await prisma.service.create({
      data: { officeBranchId: branch, name: 'Without maintenance', type: 'TUBULAR', hasMaintenance: false, ...audit },
    });
    const priced = await request('POST', '', {
      serviceId: maintenanceService.id, name: 'Priced item', uom: 'JOINT',
      sizes: [{ size: 'Large', priceServicePrimary: 120, priceServiceSisterCompany: 90, priceMaintenancePrimary: 50, priceMaintenanceSisterCompany: 40 }],
    }, 201);
    assert.equal(priced.sizes[0].priceStatus, 'AVAILABLE');
    assert.deepEqual(
      [priced.sizes[0].priceServicePrimary, priced.sizes[0].priceServiceSisterCompany, priced.sizes[0].priceMaintenancePrimary, priced.sizes[0].priceMaintenanceSisterCompany].map(Number),
      [120, 90, 50, 40],
    );
    const stored = await prisma.itemPrice.findFirst({ where: { itemSizeId: priced.sizes[0].id } });
    assert.equal(stored.createdById, actor.id);
    assert.equal(stored.createdByName, actor.name);
    assert.equal(stored.isActive, true);

    const multi = await request('POST', '', {
      serviceId: plainService.id, name: 'Multi price item', uom: 'PCS',
      sizes: [{ size: 'Small', priceServicePrimary: 10 }, { size: 'Medium', priceServicePrimary: 20, priceServiceSisterCompany: 15 }],
    }, 201);
    assert.equal(multi.sizes.length, 2);
    assert.deepEqual(multi.sizes.map(size => Number(size.priceServicePrimary)), [10, 20]);
    assert.equal(Number(multi.sizes[1].priceServiceSisterCompany), 15);
    assert.equal(multi.sizes[1].priceMaintenancePrimary, null);

    // Adding a single size to an existing item accepts the same price fields.
    const parent = await request('POST', '', {
      serviceId: maintenanceService.id, name: 'Parent item', uom: 'JOINT',
      sizes: [{ size: 'Base', priceServicePrimary: 100, priceMaintenancePrimary: 20, priceMaintenanceSisterCompany: 10 }],
    }, 201);
    const added = await request('POST', '/sizes', {
      itemId: parent.id,
      itemVersion: parent.version,
      size: 'Extra',
      priceServicePrimary: 120, priceServiceSisterCompany: 90,
      priceMaintenancePrimary: 50, priceMaintenanceSisterCompany: 40,
    }, 201);
    assert.equal(added.size, 'Extra');
    assert.equal(added.priceStatus, 'AVAILABLE');
    assert.deepEqual(
      [added.priceServicePrimary, added.priceServiceSisterCompany, added.priceMaintenancePrimary, added.priceMaintenanceSisterCompany].map(Number),
      [120, 90, 50, 40],
    );
    const addedStored = await prisma.itemPrice.findFirst({ where: { itemSizeId: added.id } });
    assert.equal(Number(addedStored.priceServicePrimary), 120);
    assert.equal(Number(addedStored.priceMaintenanceSisterCompany), 40);
    assert.equal(addedStored.createdById, actor.id);
    // A size added without prices keeps the previous behaviour and creates no price.
    const plainParent = await request('POST', '', {
      serviceId: plainService.id, name: 'Plain parent', uom: 'PCS',
      sizes: [{ size: 'Base' }],
    }, 201);
    const plainAdded = await request('POST', '/sizes', {
      itemId: plainParent.id, itemVersion: plainParent.version, size: 'Extra',
    }, 201);
    assert.equal(plainAdded.priceStatus, 'UNAVAILABLE');
    assert.equal(await prisma.itemPrice.count({ where: { itemSizeId: plainAdded.id } }), 0);
    // Prices follow the same validation as the size price endpoint.
    const invalidPrimary = await request('POST', '/sizes', {
      itemId: plainParent.id, itemVersion: plainAdded.itemVersion,
      size: 'Bad', priceServiceSisterCompany: 10,
    }, 400);
    assert.match(invalidPrimary.message, /Primary service price is required/);
    const invalidMaintenance = await request('POST', '/sizes', {
      itemId: parent.id, itemVersion: added.itemVersion,
      size: 'Bad', priceServicePrimary: 100,
    }, 400);
    assert.match(invalidMaintenance.message, /maintenance prices are required/);
    const legacy = await request('POST', '', {
      serviceId: plainService.id, name: 'Legacy item', uom: 'PCS', sizes: [{ size: 'Large' }],
    }, 201);
    assert.equal(legacy.sizes[0].priceStatus, 'UNAVAILABLE');
    assert.equal(await prisma.itemPrice.count({ where: { itemSizeId: legacy.sizes[0].id } }), 0);
    const missingPrimary = await request('POST', '', {
      serviceId: plainService.id, name: 'Missing primary', uom: 'PCS',
      sizes: [{ size: 'Large', priceServiceSisterCompany: 10 }],
    }, 400);
    assert.match(missingPrimary.message, /Primary service price is required/);
    const missingMaintenance = await request('POST', '', {
      serviceId: maintenanceService.id, name: 'Missing maintenance', uom: 'PCS',
      sizes: [{ size: 'Large', priceServicePrimary: 100 }],
    }, 400);
    assert.match(missingMaintenance.message, /maintenance prices are required/);
    const negative = await request('POST', '', {
      serviceId: plainService.id, name: 'Negative price', uom: 'PCS',
      sizes: [{ size: 'Large', priceServicePrimary: -5 }],
    }, 400);
    assert.equal(negative.message, 'Validation failed');
    assert.equal(await prisma.item.count({ where: { officeBranchId: branch, name: 'Missing maintenance' } }), 0);
    console.log('PASS: item sizes accept service, sister-company and maintenance prices with endpoint-equivalent validation.');

} finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: branch } });
    await prisma.itemPrice.deleteMany({ where: { itemSize: { item: { officeBranchId: branch } } } });
    await prisma.itemSize.deleteMany({ where: { item: { officeBranchId: branch } } });
    await prisma.item.deleteMany({ where: { officeBranchId: branch } });
    await prisma.service.deleteMany({ where: { officeBranchId: branch } });
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
