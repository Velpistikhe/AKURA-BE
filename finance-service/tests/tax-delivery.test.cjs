const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config();
// The env module parses these at require time, so they must be set before the
// service modules are loaded.
process.env.TAX_DELIVERY_TARGETS = JSON.stringify([{ name: 'marketing-service', url: 'http://localhost:5000/api/v1/marketing/internal/taxes/events' }]);
process.env.TAX_SYNC_SECRET = 'test-secret-with-at-least-32-characters';
const { prisma } = require('../dist/config/db.js');
const { taxRepository } = require('../dist/modules/taxes/tax.repository.js');
const { deliverTax, startTaxDelivery, retryDelay } = require('../dist/modules/taxes/tax-delivery.js');
require('../dist/utils/logger.js').logger.silent=true;

test('master/outbox atomicity, HTTP retry, and restart recovery', async () => {
  const branch=randomUUID(), user=randomUUID();
  const actor = { id: user, officeBranchId: branch, name: 'Finance test' };
  const old = await taxRepository.create({ percentage: '11', effectiveFrom: '2026-01-01' }, branch, actor);
  const newest = await taxRepository.create({ percentage: '12', effectiveFrom: '2026-09-01' }, branch, actor);
  assert.equal((await prisma.tax.findUnique({ where: { id: old.id } })).effectiveUntil.toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(await prisma.taxEvent.count({ where: { officeBranchId: branch } }), 2);
  assert.equal(await prisma.taxDelivery.count({ where: { event: { officeBranchId: branch } } }), 2);
  await assert.rejects(taxRepository.create({ percentage: '13', effectiveFrom: '2026-09-01' }, branch, actor), e => e.statusCode === 409);
  // The outbox is capped so the same master write cannot enqueue an unbounded
  // event: the cap must roll the whole write back. The unique index is swapped
  // for a global check so the third event of any branch is refused.
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events DROP CONSTRAINT IF EXISTS tax_events_office_branch_id_version_key');
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS tax_events_office_branch_id_version_key');
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events DROP CONSTRAINT IF EXISTS test_version_limit');
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events ADD CONSTRAINT test_version_limit CHECK (version <= 2)');
  await assert.rejects(taxRepository.create({ percentage: '13', effectiveFrom: '2026-10-01' }, branch, actor));
  assert.equal(await prisma.tax.count({ where: { officeBranchId: branch } }), 2);
  assert.equal((await prisma.tax.findUnique({ where: { id: newest.id } })).effectiveUntil, null);
  await prisma.$executeRawUnsafe('ALTER TABLE tax_events DROP CONSTRAINT test_version_limit');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS tax_events_office_branch_id_version_key ON tax_events("officeBranchId", version)');

  const job = await prisma.taxDelivery.findFirst({ where: { event: { officeBranchId: branch } } });
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => { calls++; throw Error('offline'); };
    await deliverTax(job.id);
    let state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
    assert.equal(state.attempts, 1); assert.equal(state.deliveredAt, null); assert.ok(state.nextRetryAt > new Date());
    // The backoff keeps the next attempt from running before it is due.
    await deliverTax(job.id); assert.equal(calls, 1);
    await prisma.taxDelivery.update({ where: { id: job.id }, data: { nextRetryAt: new Date(0) } });
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true, eventId: randomUUID() }) });
    await deliverTax(job.id);
    state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
    assert.equal(state.deliveredAt, null); assert.equal(state.attempts, 2);
    await prisma.taxDelivery.updateMany({ where: { event: { officeBranchId: branch } }, data: { nextRetryAt: new Date(0) } });
    global.fetch = async (_url, options) => { calls++; return { ok: true, json: async () => ({ success: true, eventId: JSON.parse(options.body).eventId }) }; };
    await Promise.all([deliverTax(job.id), deliverTax(job.id)]);
    assert.equal(calls, 2);
    state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
    assert.ok(state.deliveredAt);
    await deliverTax(job.id); assert.equal(calls, 2);
    const stop = startTaxDelivery();
    try {
      const deadline = Date.now() + 10000;
      while (await prisma.taxDelivery.count({ where: { deliveredAt: null, event: { officeBranchId: branch } } })) {
        assert.ok(Date.now() < deadline, 'startup recovers pending jobs');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } finally { stop(); }
    assert.equal(retryDelay(1), 10000); assert.equal(retryDelay(100), 300000);
  } finally { global.fetch = originalFetch; }
  const where = { officeBranchId: branch };
  await prisma.taxDelivery.deleteMany({ where: { event: { officeBranchId: branch } } });
  await prisma.taxEvent.deleteMany({ where: { officeBranchId: branch } });
  await prisma.taxRevision.deleteMany({ where: { officeBranchId: branch } });
  await prisma.tax.deleteMany({ where: { officeBranchId: branch } });
  await prisma.$disconnect();
});
