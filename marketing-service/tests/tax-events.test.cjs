const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { withTaxDatabase } = require('../../finance-service/tests/tax-fixture.cjs');

test('receiver authenticates, applies atomically, isolates branches and ignores reordered retries', async () => {
  process.env.TAX_SYNC_SECRET = 'test-secret-with-at-least-32-characters';
  await withTaxDatabase(path.resolve(__dirname, '..'), async prisma => {
    const { applyTaxEvent } = require('../dist/modules/taxes/tax-events.routes.js');
    const branch = randomUUID();
    const tax = { id: randomUUID(), officeBranchId: branch, percentage: '11', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveUntil: null, updatedAt: new Date().toISOString() };
    const first = { eventId: randomUUID(), officeBranchId: branch, version: 1, taxes: [tax] };
    await applyTaxEvent(first);
    const second = { ...first, eventId: randomUUID(), version: 2, taxes: [{ ...tax, percentage: '12' }] };
    await applyTaxEvent(second); await applyTaxEvent(first); await applyTaxEvent(second);
    assert.equal((await prisma.taxCache.findUnique({ where: { id: tax.id } })).percentage.toString(), '12');
    assert.equal(await prisma.taxCache.count(), 1);
    const otherBranch = randomUUID();
    await applyTaxEvent({ ...first, eventId: randomUUID(), officeBranchId: otherBranch, taxes: [{ ...tax, id: randomUUID(), officeBranchId: otherBranch }] });
    await assert.rejects(applyTaxEvent({ ...second, version: 3, taxes: [tax, tax] }));
    await assert.rejects(applyTaxEvent({ ...second, version: 3, taxes: [{ ...tax, officeBranchId: otherBranch }] }));
    // A conflict after deletion must roll back both cache and revision.
    const other = await prisma.taxCache.findFirst({ where: { officeBranchId: otherBranch } });
    await assert.rejects(applyTaxEvent({ ...second, version: 3, taxes: [{ ...tax, id: other.id }] }));
    assert.equal((await prisma.taxCache.findUnique({ where: { id: tax.id } })).percentage.toString(), '12');
    assert.equal((await prisma.taxCacheRevision.findUnique({ where: { officeBranchId: branch } })).version, 2);
    assert.equal(await prisma.taxCache.count(), 2);
    const app = require('../dist/app.js').default;
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/internal/taxes/events`;
      const headers = { 'content-type': 'application/json' };
      assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(second) })).status, 403);
      assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'x-tax-sync-secret': process.env.TAX_SYNC_SECRET }, body: '{}' })).status, 400);
      const response = await fetch(url, { method: 'POST', headers: { ...headers, 'x-tax-sync-secret': process.env.TAX_SYNC_SECRET }, body: JSON.stringify(second) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, eventId: second.eventId });
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
