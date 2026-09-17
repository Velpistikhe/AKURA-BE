const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');

test('Marketing HTTP receiver saves new tax periods and ignores stale or duplicate events', async () => {
  let cache = [];
  const revisions = new Map();
  const tx = {
    $executeRaw: async () => {},
    taxCacheRevision: {
      findUnique: async ({ where }) => revisions.get(where.officeBranchId),
      upsert: async ({ where, create, update }) => revisions.set(where.officeBranchId,
        revisions.has(where.officeBranchId) ? update : create),
    },
    taxCache: {
      deleteMany: async ({ where }) => { cache = cache.filter(row => row.officeBranchId !== where.officeBranchId); },
      createMany: async ({ data }) => { cache.push(...data); },
    },
  };
  const mock = (module, exports) => {
    const id = require.resolve(module);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  mock('../dist/config/db.js', { prisma: { $transaction: async callback => callback(tx) } });
  mock('../dist/config/env.js', { env: { TAX_SYNC_SECRET: 'test-only-tax-sync-secret' } });
  const app = express();
  app.use(express.json());
  app.use(require('../dist/modules/taxes/tax-events.routes.js').default);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/internal/taxes/events`;
  const branch = randomUUID();
  const oldTax = { id: randomUUID(), officeBranchId: branch, percentage: '11', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveUntil: null, updatedAt: new Date().toISOString() };
  const oldEvent = { eventId: randomUUID(), officeBranchId: branch, version: 1, taxes: [oldTax] };
  const newTax = { ...oldTax, id: randomUUID(), percentage: '12', effectiveFrom: '2026-09-01T00:00:00.000Z' };
  const newEvent = { eventId: randomUUID(), officeBranchId: branch, version: 2,
    taxes: [{ ...oldTax, effectiveUntil: '2026-08-31T00:00:00.000Z' }, newTax] };
  async function send(body, secret = 'test-only-tax-sync-secret') {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tax-sync-secret': secret }, body: JSON.stringify(body) });
  }
  try {
    assert.equal((await send(newEvent, 'wrong')).status, 403);
    assert.equal(cache.length, 0);
    assert.equal((await send(oldEvent)).status, 200);
    const response = await send(newEvent);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, eventId: newEvent.eventId });
    assert.equal(cache.length, 2);
    assert.equal(cache.find(row => row.id === newTax.id).percentage, '12');
    assert.equal(cache.find(row => row.id === oldTax.id).effectiveUntil.toISOString(), '2026-08-31T00:00:00.000Z');
    await send(oldEvent);
    await send(newEvent);
    assert.equal(cache.length, 2);
    assert.equal(revisions.get(branch).version, 2);
    assert.equal((await send({ ...newEvent, version: 3, taxes: [{ ...newTax, officeBranchId: randomUUID() }] })).status, 400);
    assert.equal(revisions.get(branch).version, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
