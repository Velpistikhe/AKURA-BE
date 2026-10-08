const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.DIRECT_MFE_ACCESS = 'false';
process.env.DATABASE_URL ??= 'postgresql://postgres:password@localhost:5432/akura_fieldservice?schema=public';
process.env.GATEWAY_SECRET ??= 'test-service-secret';
process.env.API_GATEWAY_URL ??= 'http://127.0.0.1:1';
process.env.QUOTATION_SYNC_SECRET = 'test-quotation-sync-secret-with-32-chars!!';

test('Quotation snapshot receiver authenticates, applies atomically and ignores stale events', async () => {
  const { prisma } = require('../dist/config/db.js');
  const { applyQuotationSyncEvent, loadStoredQuotation } = require('../dist/modules/quotation-snapshots/quotation-snapshot.repository.js');
  const routes = require('../dist/modules/quotation-snapshots/quotation-snapshot.routes.js').default;
  const app = express();
  app.use(express.json());
  app.use(routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/internal/quotation-snapshots/events`;
  const branch = randomUUID(), otherBranch = randomUUID(), quotationId = randomUUID();
  const secret = 'test-quotation-sync-secret-with-32-chars!!';
  const quotation = { id: quotationId, officeBranchId: branch, version: 1, status: 'APPROVED', isActive: true,
    no: 1, numberYear: 2026, subject: 'Snapshot test', companySnapshot: { name: 'Customer' },
    customerSnapshot: 'Buyer', subTotal: '100', taxAmount: '11', total: '111', items: [] };
  const event = (changes = {}) => ({ eventId: randomUUID(), officeBranchId: branch, quotationId,
    quotationVersion: 1, version: 1, revision: 0, approvedAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
    quotation, ...changes });
  const send = async (body, supplied = secret) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-quotation-sync-secret': supplied }, body: JSON.stringify(body) });
    return { status: response.status, payload: await response.json() };
  };
  try {
    assert.equal((await send(event(), 'wrong')).status, 403, 'shared secret is required');
    assert.equal(await prisma.quotationSnapshot.count({ where: { officeBranchId: branch } }), 0);
    assert.equal((await send({ ...event({ eventId: randomUUID() }), quotation: { ...quotation, id: randomUUID() } })).status, 400, 'payload identity must match the event');
    const accepted = await send(event());
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.payload, { success: true, eventId: accepted.payload.eventId });
    const stored = await loadStoredQuotation(quotationId, branch);
    assert.equal(stored.id, quotationId);
    assert.equal(stored.status, 'APPROVED');
    // Stale/reordered deliveries must not roll back the stored snapshot.
    await send(event({ version: 2, quotationVersion: 1, quotation: { ...quotation, subject: 'Older retry' } }));
    assert.equal((await loadStoredQuotation(quotationId, branch)).subject, 'Snapshot test');
    // Newer versions replace atomically.
    const newer = event({ eventId: randomUUID(), version: 3, quotationVersion: 2, quotation: { ...quotation, version: 2, subject: 'Revised approval' } });
    assert.equal((await send(newer)).status, 200);
    assert.equal((await loadStoredQuotation(quotationId, branch)).subject, 'Revised approval');
    // Lifecycle state (revise/deactivate) can also be stored so Field Service stops offering it as a basis.
    const lifecycle = event({ eventId: randomUUID(), version: 4, quotationVersion: 3,
      quotation: { ...quotation, version: 3, status: 'REVISED', isActive: false } });
    assert.equal((await send(lifecycle)).status, 200);
    assert.equal((await loadStoredQuotation(quotationId, branch)).status, 'REVISED');
    // Branch isolation: unknown quotations in another branch are rejected.
    await assert.rejects(() => loadStoredQuotation(quotationId, otherBranch), error => error.statusCode === 404);
    await assert.rejects(() => loadStoredQuotation(randomUUID(), branch), error => error.statusCode === 404);
    console.log('PASS: quotation snapshot receiver authenticates, applies atomically, ignores stale events and isolates branches.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.quotationSnapshot.deleteMany({ where: { officeBranchId: { in: [branch, otherBranch] } } });
    await prisma.$disconnect();
  }
});
