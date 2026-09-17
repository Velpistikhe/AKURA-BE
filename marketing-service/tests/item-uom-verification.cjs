const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../dist/config/db.js');
const { createItemSchema, updateItemSchema } = require('../dist/modules/items/item.schemas.js');
const { itemRepository } = require('../dist/modules/items/item.repository.js');
const { itemWriteRepository } = require('../dist/modules/items/item-write.repository.js');
const { itemHistoryRepository } = require('../dist/modules/items/item-history.repository.js');

async function main() {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'UOM test' };
  const input = { serviceId: randomUUID(), name: 'Pipe' };
  for (const uom of [undefined, null, '', '   ', 123, false, 'x'.repeat(51)]) {
    assert.equal(createItemSchema.safeParse({ ...input, uom }).success, false);
    if (uom !== undefined) assert.equal(updateItemSchema.safeParse({ version: 0, uom }).success, false);
  }
  assert.equal(updateItemSchema.safeParse({ version: 0 }).success, false);
  assert.equal(updateItemSchema.safeParse({ uom: 'JOINT' }).success, false);
  assert.equal(createItemSchema.parse({ ...input, uom: '  JOINT  ' }).uom, 'JOINT');
  let service;
  try {
    const [column] = await prisma.$queryRaw`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'uom'`;
    assert.equal(column.is_nullable, 'NO');
    assert.equal(column.column_default, null);
    service = await prisma.service.create({ data: { officeBranchId: branch, name: 'UOM verification', type: 'TUBULAR', createdById: actor.id, createdByName: actor.name } });
    const item = await itemRepository.create(createItemSchema.parse({ ...input, serviceId: service.id, uom: 'JOINT' }), branch, actor);
    assert.equal(item.uom, 'JOINT');
    const updated = await itemWriteRepository.updateItem(item.id, updateItemSchema.parse({ version: item.version, uom: '  PCS  ' }), branch, actor);
    assert.equal(updated.uom, 'PCS');
    assert.equal(updated.name, item.name);
    assert.equal(updated.version, item.version + 1);
    await assert.rejects(itemWriteRepository.updateItem(item.id, { version: item.version, uom: 'M' }, branch, actor), error => error.statusCode === 409);
    const renamed = await itemWriteRepository.updateItem(item.id, { version: updated.version, name: 'Renamed' }, branch, actor);
    assert.equal(renamed.uom, 'PCS');
    assert.equal((await itemRepository.findActive(item.id, branch)).uom, 'PCS');
    const history = await itemHistoryRepository.read('ITEM', item.id, branch, { page: 1, limit: 20 });
    const change = history.history.find(row => row.version === updated.version).changes.find(row => row.field === 'uom');
    assert.deepEqual(change, { field: 'uom', label: 'Unit of measure', before: 'JOINT', after: 'PCS' });
    const created = history.history.find(row => row.action === 'CREATE').changes.find(row => row.field === 'uom');
    assert.equal(created.before, null);
    assert.equal(created.after, 'JOINT');
    console.log('PASS: required UOM, normalization, persistence, partial updates, stale versions, history, and database column without default.');
  } finally {
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: branch } });
    if (service) await prisma.service.delete({ where: { id: service.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
