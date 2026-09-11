const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../dist/config/db.js');
const { itemRepository } = require('../dist/modules/items/item.repository.js');

async function main() {
  const branch = randomUUID();
  const actor = { id: randomUUID(), name: 'Size reuse test' };
  let service;
  try {
    service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Size reuse test', type: 'TUBULAR' } });
    const item = await itemRepository.create({
      serviceId: service.id, name: 'Pipe',
      sizes: [{ size: 'Large', priceServicePrimary: 100, priceServiceSisterCompany: 90 }],
    }, branch, actor);
    const input = { itemVersion: 0, itemId: item.id, size: 'Large', priceServicePrimary: 120, priceServiceSisterCompany: 110 };
    assert(item.sizes[0].effectiveFrom instanceof Date);
    assert.equal(item.sizes[0].version, 0);
    assert.equal(item.sizes[0].effectiveUntil, null);
    await assert.rejects(itemRepository.addSize(input, branch, actor), e => e.statusCode === 409);
    await itemRepository.removeSize(item.sizes[0].id, branch, actor, 0);
    const historical = await prisma.itemSize.findUniqueOrThrow({ where: { id: item.sizes[0].id }, include: { price: true } });
    assert.equal(historical.isActive, false);
    assert(historical.effectiveUntil >= historical.effectiveFrom);
    assert.deepEqual(historical.effectiveUntil, historical.price.effectiveUntil);
    assert.equal(historical.price.isActive, false);
    assert(historical.price.effectiveUntil);
    input.itemVersion = (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).version;
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => itemRepository.addSize(input, branch, actor)));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    for (const result of attempts.filter(r => r.status === 'rejected')) assert.equal(result.reason.statusCode, 409);
    const replacement = attempts.find(r => r.status === 'fulfilled').value;
    assert.notEqual(replacement.id, historical.id);
    assert(replacement.effectiveFrom > historical.effectiveFrom);
    assert.equal(replacement.effectiveUntil, null);
    assert.equal(replacement.priceServicePrimary.toString(), '120');
    assert.equal(replacement.createdById, actor.id);
    assert.equal(replacement.updatedById, null);
    assert.deepEqual(await prisma.itemSize.findUniqueOrThrow({ where: { id: historical.id }, include: { price: true } }), historical);
    // The database rejects a repeated start time, regardless of active status.
    await assert.rejects(prisma.itemSize.create({ data: {
      itemId: item.id, size: 'Large', createdById: actor.id, createdByName: actor.name,
      effectiveFrom: historical.effectiveFrom, isActive: false,
    } }), e => e.code === 'P2002');
    await itemRepository.removeSize(replacement.id, branch, actor, replacement.version);
    input.itemVersion = (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).version;
    const third = await itemRepository.addSize(input, branch, actor);
    assert.notEqual(third.id, replacement.id);
    assert.equal(await prisma.itemSize.count({ where: { itemId: item.id, size: 'Large', isActive: true } }), 1);
    assert.equal(await prisma.itemSize.count({ where: { itemId: item.id, size: 'Large', isActive: false } }), 2);
    const listed = await itemRepository.listSizes({ itemId: item.id, page: 1, limit: 20, sortOrder: 'asc' }, branch);
    assert.deepEqual(listed.sizes.map(s => s.id), [third.id]);
    const inactiveHistory = await prisma.itemSize.findMany({ where: { itemId: item.id, isActive: false }, include: { price: true } });
    await itemRepository.remove(item.id, branch, actor, (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).version);
    const closed = await prisma.itemSize.findUniqueOrThrow({ where: { id: third.id }, include: { price: true } });
    assert.equal(closed.isActive, false);
    assert(closed.effectiveUntil >= closed.effectiveFrom);
    assert.deepEqual(closed.effectiveUntil, closed.price.effectiveUntil);
    for (const old of inactiveHistory) {
      assert.deepEqual(await prisma.itemSize.findUniqueOrThrow({ where: { id: old.id }, include: { price: true } }), old);
    }
    console.log('PASS: active duplicate rejection, concurrent reuse, effective periods, start-time uniqueness, multiple inactive sizes, active listing, parent deactivation preserves history.');
  } finally {
    if (service) await prisma.service.delete({ where: { id: service.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
