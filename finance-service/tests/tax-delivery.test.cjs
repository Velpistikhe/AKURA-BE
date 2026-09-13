const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { withTaxDatabase } = require('./tax-fixture.cjs');

test('master/outbox atomicity, HTTP retry, restart recovery, and invoice tax authority', async () => {
  process.env.TAX_DELIVERY_TARGETS = JSON.stringify([{ name: 'marketing-service', url: 'http://localhost:5003/internal/taxes/events' }]);
  process.env.TAX_SYNC_SECRET = 'test-secret-with-at-least-32-characters';
  await withTaxDatabase(path.resolve(__dirname, '..'), async prisma => {
    const { taxRepository } = require('../dist/modules/taxes/tax.repository.js');
    const { deliverTax, startTaxDelivery, retryDelay } = require('../dist/modules/taxes/tax-delivery.js');
    const { documentRepository } = require('../dist/modules/documents/document.repository.js');
    const { createSchema } = require('../dist/modules/documents/document.schemas.js');
    const actor = { id: randomUUID(), officeBranchId: randomUUID(), name: 'Finance test' };
    const old = await taxRepository.create({ percentage: '11', effectiveFrom: '2026-01-01' }, actor.officeBranchId, actor);
    const newest = await taxRepository.create({ percentage: '12', effectiveFrom: '2026-09-01' }, actor.officeBranchId, actor);
    assert.equal((await prisma.tax.findUnique({ where: { id: old.id } })).effectiveUntil.toISOString(), '2026-08-31T00:00:00.000Z');
    assert.equal(await prisma.taxEvent.count(), 2);
    assert.equal(await prisma.taxDelivery.count(), 2);
    await assert.rejects(taxRepository.create({ percentage: '13', effectiveFrom: '2026-09-01' }, actor.officeBranchId, actor), e => e.statusCode === 409);
    assert.equal(await prisma.taxEvent.count(), 2);
    // Failure writing the outbox must roll back the master write and closed period.
    await prisma.$executeRawUnsafe('ALTER TABLE tax_events ADD CONSTRAINT test_version_limit CHECK (version <= 2)');
    await assert.rejects(taxRepository.create({ percentage: '13', effectiveFrom: '2026-10-01' }, actor.officeBranchId, actor));
    assert.equal(await prisma.tax.count(), 2);
    assert.equal((await prisma.tax.findUnique({ where: { id: newest.id } })).effectiveUntil, null);
    await prisma.$executeRawUnsafe('ALTER TABLE tax_events DROP CONSTRAINT test_version_limit');

    const quote = { id: randomUUID(), officeBranchId: actor.officeBranchId, version: 1, isActive: true, subTotal: '100.25', taxAmount: '11.03', total: '111.28', items: [] };
    const input = createSchema.parse({ number: 'tax-test', title: 'Test', quotationId: quote.id, quotationVersion: 1, date: '2026-09-13' });
    const invoice = await documentRepository.create('INVOICE', input, quote, actor);
    assert.equal(invoice.taxSourceId, newest.id);
    assert.equal(invoice.tax.toString(), '12');
    assert.equal(invoice.taxAmount.toString(), '12.03');
    assert.equal(invoice.total.toString(), '112.28');
    assert.equal(invoice.quotationSnapshot.taxAmount, '11.03');
    await assert.rejects(documentRepository.create('INVOICE', { ...input, number: 'missing', date: new Date('2025-01-01') }, quote, actor), e => e.statusCode === 409);
    const revised = await documentRepository.mutate('INVOICE', invoice.id, { version: 0, date: new Date('2026-08-01') }, actor);
    assert.equal(revised.tax.toString(), '11');
    const final = await documentRepository.mutate('INVOICE', invoice.id, { version: 1, status: 'FINAL' }, actor);
    assert.equal(final.tax.toString(), '11');
    await assert.rejects(documentRepository.mutate('INVOICE', invoice.id, { version: 2, title: 'Changed' }, actor), e => e.statusCode === 409);

    const job = await prisma.taxDelivery.findFirst();
    const originalFetch = global.fetch;
    let calls = 0;
    try {
      global.fetch = async () => { calls++; throw Error('offline'); };
      await deliverTax(job.id);
      let state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
      assert.equal(state.attempts, 1); assert.equal(state.deliveredAt, null); assert.ok(state.nextRetryAt > new Date());
      await deliverTax(job.id); assert.equal(calls, 1);
      await prisma.taxDelivery.update({ where: { id: job.id }, data: { nextRetryAt: new Date(0) } });
      global.fetch = async () => ({ ok: true, json: async () => ({ success: true, eventId: randomUUID() }) });
      await deliverTax(job.id);
      state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
      assert.equal(state.deliveredAt, null); assert.equal(state.attempts, 2);
      await prisma.taxDelivery.updateMany({ data: { nextRetryAt: new Date(0) } });
      global.fetch = async (_url, options) => { calls++; return { ok: true, json: async () => ({ success: true, eventId: JSON.parse(options.body).eventId }) }; };
      await Promise.all([deliverTax(job.id), deliverTax(job.id)]);
      assert.equal(calls, 2);
      state = await prisma.taxDelivery.findUnique({ where: { id: job.id } });
      assert.ok(state.deliveredAt);
      await deliverTax(job.id); assert.equal(calls, 2);
      const stop = startTaxDelivery();
      try {
        const deadline = Date.now() + 10000;
        while (await prisma.taxDelivery.count({ where: { deliveredAt: null } })) {
          assert.ok(Date.now() < deadline, 'startup recovers pending jobs');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } finally { stop(); }
      assert.equal(retryDelay(1), 10000); assert.equal(retryDelay(100), 300000);
    } finally { global.fetch = originalFetch; }
  });
});
