const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prisma } = require('../dist/config/db.js');
const { serviceService } = require('../dist/modules/services/service.service.js');
const { serviceRepository } = require('../dist/modules/services/service.repository.js');
const { itemWriteRepository: items } = require('../dist/modules/items/item-write.repository.js');

const actor = { id: 'actor', name: 'Test' };
const conflict = error => error.statusCode === 409;

test('inactive service detail remains readable within its branch', async t => {
  const original = prisma.service.findFirst;
  t.after(() => { prisma.service.findFirst = original; });
  prisma.service.findFirst = async ({ where }) => {
    assert.equal(where.id, 'service');
    assert.equal(where.isActive, undefined);
    return where.officeBranchId === 'branch' ? { id: 'service', officeBranchId: 'branch', name: 'Inactive service', type: 'TUBULAR', hasMaintenance: false, version: 0, isActive: false, createdById: 'actor', createdByName: 'Test', updatedById: null, updatedByName: null, createdAt: new Date(), updatedAt: new Date(), scopes: [] } : null;
  };
  assert.equal((await serviceService.get('service', 'branch')).isActive, false);
  await assert.rejects(serviceService.get('service', 'other'), error => error.statusCode === 404);
});

// Database delegates intentionally expose reads only: any write before validation fails the test.
function transaction(t, inactive) {
  let locked = false;
  const service = { id: 'service', officeBranchId: 'branch', version: 0, isActive: inactive !== 'service', hasMaintenance: inactive !== 'price' && inactive !== 'service' };
  const item = { id: 'item', officeBranchId: 'branch', service, version: 0, isActive: inactive !== 'item' };
  const size = { id: 'size', itemId: 'item', version: 0, isActive: inactive !== 'size' };
  const price = { id: 'price', itemSizeId: 'size', contractId: 'contract', version: 0, isActive: false,
    priceServicePrimary: { toString: () => '100' }, priceServiceSisterCompany: { toString: () => '100' },
    priceMaintenancePrimary: null, priceMaintenanceSisterCompany: null,
    effectiveFrom: new Date('2026-01-01'), };
  const read = row => async () => { assert.equal(locked, true); return row; };
  const tx = {
    $executeRaw: async () => { locked = true; },
    service: { findFirst: read(service) },
    item: { findFirst: read(item) },
    itemSize: { findFirst: read(size) },
    itemPrice: { findUnique: read(price), update: async () => { assert.fail('inactive price must be rejected before update'); } },
    companyContractPrice: { findFirst: read(price), update: async () => { assert.fail('inactive contract price must be rejected before update'); } },
  };
  t.mock.method(prisma, '$transaction', async callback => callback(tx));
}

test('inactive service cannot be updated or deactivated again inside transaction', async t => {
  transaction(t, 'service');
  await assert.rejects(serviceRepository.update('service', 'branch', { version: 0, name: 'Changed' }, actor), conflict);
  await assert.rejects(serviceRepository.deactivate('service', 0, 'branch', actor), conflict);
});

test('scope writes recheck service activity after acquiring the transaction lock', async t => {
  transaction(t, 'service');
  assert.equal(await serviceRepository.createInspectionScope('service', 'scope', 'branch', actor), null);
  assert.equal(await serviceRepository.revokeInspectionScope('service', 'scope', 'branch', actor), null);
  assert.equal(await serviceRepository.createMaintenanceScope('service', 'scope', 'branch', actor), null);
  assert.equal(await serviceRepository.revokeMaintenanceScope('service', 'scope', 'branch', actor), null);
});

for (const inactive of ['service', 'item', 'size']) {
  test(`catalog mutations reject inactive ${inactive}`, async t => {
    transaction(t, inactive);
    if (inactive !== 'size') {
      await assert.rejects(items.updateItem('item', { version: 0, name: 'Changed' }, 'branch', actor), conflict);
      await assert.rejects(items.addSize({ itemId: 'item', itemVersion: 0, size: 'New' }, 'branch', actor), conflict);
      await assert.rejects(items.remove('item', 'branch', actor, 0), conflict);
    }
    await assert.rejects(items.removeSize('size', 'branch', actor, 0), conflict);
    await assert.rejects(items.savePrice('size', { version: 0 }, 'branch', actor), conflict);
    await assert.rejects(items.savePrice('size', {}, 'branch', actor, true), conflict);
    await assert.rejects(items.createContract('size', { contractId: 'contract' }, 'branch', actor), conflict);
    await assert.rejects(items.changeContract('price', { version: 0 }, 'branch', actor), conflict);
  });
}

test('inactive prices reject edits without explicit standard-price reactivation and contract prices cannot reactivate', async t => {
  transaction(t, 'price');
  for (const isActive of [undefined, false]) {
    await assert.rejects(items.savePrice('size', { version: 0, isActive }, 'branch', actor), conflict);
    await assert.rejects(items.changeContract('price', { version: 0, isActive }, 'branch', actor), conflict);
  }
  await assert.rejects(items.changeContract('price', { version: 0, isActive: true }, 'branch', actor), conflict);
  await assert.rejects(items.changeContract('price', { version: 0 }, 'branch', actor, true), conflict);
});
